//! Screenshots for bugs: images named by file path, or the one on the clipboard, uploaded as work item
//! attachments and added to a rich-text field (Symptom, else Repro Steps, else Description).
//!
//! The AI tool sees a pasted image but not its bytes, so it names a path or "clipboard" and Boards reads it here.

use super::tools::text_to_html;
use crate::ado::api::FieldMap;
use crate::ado::client::{enc, AdoClient};
use crate::error::AppError;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const CLIPBOARD: &str = "clipboard";
const MAX_BYTES: u64 = 25 * 1024 * 1024;
const MAX_IMAGES: usize = 10;
const SYMPTOM: &str = "Microsoft.VSTS.CMMI.Symptom";
const REPRO_STEPS: &str = "Microsoft.VSTS.TCM.ReproSteps";

pub struct Image {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// The `images` argument: a list of paths or "clipboard" (a single string is taken as a list of one).
pub fn specs(args: &Value) -> Result<Vec<String>, AppError> {
    let list = match args.get("images") {
        None | Some(Value::Null) => vec![],
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .map(|v| v.as_str().map(str::to_string).ok_or_else(|| AppError::validation("`images` must be a list of file paths or \"clipboard\".")))
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(AppError::validation("`images` must be a list of file paths or \"clipboard\".")),
    };
    let list: Vec<String> = list.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if list.len() > MAX_IMAGES {
        return Err(AppError::validation(format!("Attach at most {MAX_IMAGES} images at a time.")));
    }
    Ok(list)
}

/// Read every image the call names before anything is written, so one bad path fails the whole call.
pub async fn read_all(specs: Vec<String>) -> Result<Vec<Image>, AppError> {
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for s in &specs {
            out.extend(load(s)?);
        }
        // A clipboard can hold several copied files, and a screenshot is only measured once encoded.
        if out.len() > MAX_IMAGES {
            return Err(AppError::validation(format!("Attach at most {MAX_IMAGES} images at a time.")));
        }
        if out.iter().any(|i| i.bytes.len() as u64 > MAX_BYTES) {
            return Err(AppError::validation("Images up to 25 MB can be attached."));
        }
        Ok(out)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

fn load(spec: &str) -> Result<Vec<Image>, AppError> {
    if spec.eq_ignore_ascii_case(CLIPBOARD) {
        return clipboard();
    }
    Ok(vec![from_file(&path_of(spec))?])
}

/// A path as an AI tool may write it: plain, `file://` URL, or starting with `~/`.
fn path_of(s: &str) -> PathBuf {
    let s = match s.strip_prefix("file://") {
        Some(p) => {
            let p = urlencoding::decode(p).map(|c| c.into_owned()).unwrap_or_else(|_| p.to_string());
            // file:///C:/Users/me/a.png → C:/Users/me/a.png
            match p.as_bytes() {
                [b'/', d, b':', ..] if d.is_ascii_alphabetic() => p[1..].to_string(),
                _ => p,
            }
        }
        None => s.to_string(),
    };
    match (s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")), home()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(s),
    }
}

fn home() -> Option<PathBuf> {
    // On Windows, Git Bash sets HOME to a /c/Users/... path that Windows cannot open.
    let order = if cfg!(windows) { ["USERPROFILE", "HOME"] } else { ["HOME", "USERPROFILE"] };
    order.iter().find_map(std::env::var_os).map(PathBuf::from)
}

fn from_file(path: &Path) -> Result<Image, AppError> {
    if !path.is_absolute() {
        return Err(AppError::validation(format!(
            "Give the image's full path (e.g. /Users/me/Desktop/bug.png), not \"{}\": Boards cannot tell which folder it is relative to.",
            path.display()
        )));
    }
    let meta = std::fs::metadata(path).map_err(|_| AppError::validation(format!("Could not find the image {}.", path.display())))?;
    if !meta.is_file() {
        return Err(AppError::validation(format!("{} is not a file.", path.display())));
    }
    if meta.len() > MAX_BYTES {
        return Err(AppError::validation("Images up to 25 MB can be attached."));
    }
    let bytes = std::fs::read(path).map_err(|_| AppError::validation(format!("Could not read the image {}.", path.display())))?;
    let ext = kind(&bytes).ok_or_else(|| AppError::validation(format!("{} is not a PNG, JPEG, GIF or WebP image.", path.display())))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Image { name: clean_name(&name, ext), bytes })
}

fn clipboard() -> Result<Vec<Image>, AppError> {
    let mut cb = arboard::Clipboard::new().map_err(|_| AppError::validation("Could not read the clipboard."))?;
    // A file copied in Finder or Explorer: attach the file itself.
    if let Ok(files) = cb.get().file_list() {
        let images: Vec<Image> = files.iter().filter_map(|p| from_file(p).ok()).collect();
        if !images.is_empty() {
            return Ok(images);
        }
    }
    let img = cb
        .get_image()
        .map_err(|_| AppError::validation("There is no image on the clipboard. Ask the user to copy the screenshot again, or give its file path."))?;
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let name = format!("screenshot-{ms}.png");
    Ok(vec![Image { name, bytes: encode_png(img.width, img.height, &img.bytes)? }])
}

/// The image kind from its first bytes, as a file extension; None for anything else.
fn kind(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("gif")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn clean_name(name: &str, ext: &str) -> String {
    let name: String = name.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\')).collect();
    let name = name.trim();
    if name.is_empty() {
        format!("screenshot.{ext}")
    } else if Path::new(name).extension().is_none() {
        format!("{name}.{ext}")
    } else {
        name.to_string()
    }
}

fn encode_png(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, AppError> {
    let fail = |e: png::EncodingError| AppError::internal(format!("Could not encode the clipboard image: {e}"));
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(fail)?;
        writer.write_image_data(rgba).map_err(fail)?;
        writer.finish().map_err(fail)?;
    }
    Ok(out)
}

/// Upload the images and return the HTML that shows them, one paragraph each.
pub async fn upload_html(client: &AdoClient, project: &str, images: Vec<Image>) -> Result<String, AppError> {
    let esc = |s: &str| s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    let mut html = String::new();
    for img in images {
        let url = client.url(&format!("/{}/_apis/wit/attachments?fileName={}", enc(project), urlencoding::encode(&img.name)));
        let res: Value = client.post_bytes(&url, img.bytes).await?;
        let src = res
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::internal("Azure DevOps did not return the attachment's address."))?;
        html.push_str(&format!("<p><img src=\"{}\" alt=\"{}\" style=\"max-width:100%\"></p>", esc(src), esc(&img.name)));
    }
    Ok(html)
}

/// The field the images go in: `imageField` if given (reference or display name), else the type's
/// Symptom when it is rich text, else Repro Steps, else Description. `type_def` is the type from
/// work_item_types_with_fields; `field_types` maps reference names to types ("html" for rich text).
pub fn target_field(type_def: Option<&Value>, field_types: &FieldMap, explicit: Option<&str>) -> Result<String, AppError> {
    let html = |r: &str| field_types.get(r).map(String::as_str) == Some("html");
    let defs: Vec<&Value> = type_def.and_then(|t| t.get("fieldDefs")).and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
    let ref_name = |d: &Value| d.get("referenceName").and_then(Value::as_str).unwrap_or("").to_string();
    let name = |d: &Value| d.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if let Some(want) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        let found = defs
            .iter()
            .find(|d| ref_name(d).eq_ignore_ascii_case(want) || name(d).eq_ignore_ascii_case(want))
            .map(|d| ref_name(d))
            .unwrap_or_else(|| want.to_string());
        if !html(&found) {
            return Err(AppError::validation(format!("{want} is not a rich-text field, so it cannot show images.")));
        }
        return Ok(found);
    }
    let symptom = defs.iter().map(|d| ref_name(d)).zip(defs.iter().map(|d| name(d).to_lowercase())).find(|(r, n)| (r == SYMPTOM || n == "symptom" || n == "symptoms") && html(r));
    if let Some((r, _)) = symptom {
        return Ok(r);
    }
    if defs.iter().any(|d| ref_name(d) == REPRO_STEPS) {
        return Ok(REPRO_STEPS.to_string());
    }
    Ok("System.Description".to_string())
}

/// The field's text with the images after it; plain text becomes HTML so its line breaks survive.
pub fn append(existing: Option<&Value>, images_html: &str) -> String {
    let text = existing.and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(text_to_html).unwrap_or_default();
    format!("{text}{images_html}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn images_are_told_apart_from_other_files_by_their_bytes() {
        assert_eq!(kind(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(kind(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(kind(b"GIF89a.."), Some("gif"));
        assert_eq!(kind(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(kind(b"#!/bin/sh\n"), None);
        assert_eq!(kind(b""), None);
    }

    #[test]
    fn paths_may_be_file_urls_or_start_at_home() {
        assert_eq!(path_of("file:///Users/me/My%20Shot.png"), PathBuf::from("/Users/me/My Shot.png"));
        assert_eq!(path_of("/tmp/a.png"), PathBuf::from("/tmp/a.png"));
        assert_eq!(path_of("file:///C:/Users/me/a.png"), PathBuf::from("C:/Users/me/a.png"));
        if let Some(home) = std::env::var_os("HOME") {
            assert_eq!(path_of("~/Desktop/a.png"), PathBuf::from(home).join("Desktop/a.png"));
        }
        let err = from_file(Path::new("shot.png")).err().unwrap();
        assert!(err.message.contains("full path"));
    }

    #[test]
    fn only_image_files_are_read() {
        let dir = std::env::temp_dir().join(format!("boards-mcp-images-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("shot.png");
        std::fs::write(&png, encode_png(1, 1, &[255, 0, 0, 255]).unwrap()).unwrap();
        let text = dir.join("notes.png");
        std::fs::write(&text, "not an image").unwrap();
        let img = from_file(&png).unwrap();
        assert_eq!(img.name, "shot.png");
        assert_eq!(kind(&img.bytes), Some("png"));
        assert!(from_file(&text).err().unwrap().message.contains("is not a PNG"));
        assert!(from_file(&dir.join("missing.png")).err().unwrap().message.contains("Could not find"));
        assert!(from_file(&dir).err().unwrap().message.contains("not a file"));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Needs an image on the clipboard: `screencapture -c -x`, then `cargo test -- --ignored clipboard`.
    #[test]
    #[ignore]
    fn reads_the_clipboard_image() {
        let imgs = clipboard().unwrap();
        assert!(!imgs.is_empty());
        assert!(imgs.iter().all(|i| kind(&i.bytes).is_some()), "not an image");
    }

    #[test]
    fn names_are_cleaned_and_get_an_extension() {
        assert_eq!(clean_name("a/b\\c\n.png", "png"), "abc.png");
        assert_eq!(clean_name("  ", "jpg"), "screenshot.jpg");
        assert_eq!(clean_name("capture", "gif"), "capture.gif");
    }

    #[test]
    fn images_argument_is_a_short_list() {
        assert!(specs(&json!({})).unwrap().is_empty());
        assert_eq!(specs(&json!({ "images": "clipboard" })).unwrap(), vec!["clipboard"]);
        assert_eq!(specs(&json!({ "images": [" /a.png ", ""] })).unwrap(), vec!["/a.png"]);
        assert!(specs(&json!({ "images": [1] })).is_err());
        assert!(specs(&json!({ "images": vec!["/a.png"; 11] })).is_err());
    }

    #[test]
    fn images_go_in_symptom_then_repro_steps_then_description() {
        let cmmi = json!({ "fieldDefs": [{ "referenceName": REPRO_STEPS, "name": "Repro Steps" }, { "referenceName": SYMPTOM, "name": "Symptom" }] });
        let custom = json!({ "fieldDefs": [{ "referenceName": REPRO_STEPS, "name": "Repro Steps" }, { "referenceName": "Custom.Symptoms", "name": "Symptoms " }] });
        let agile = json!({ "fieldDefs": [{ "referenceName": REPRO_STEPS, "name": "Repro Steps" }] });
        let task = json!({ "fieldDefs": [{ "referenceName": "System.Description", "name": "Description" }] });
        let plain = json!({ "fieldDefs": [{ "referenceName": REPRO_STEPS, "name": "Repro Steps" }, { "referenceName": "Custom.Symptom", "name": "Symptom" }] });
        let types: FieldMap = [SYMPTOM, REPRO_STEPS, "Custom.Symptoms", "System.Description", "Custom.Other"]
            .iter()
            .map(|r| (r.to_string(), "html".to_string()))
            .chain([("Custom.Symptom".to_string(), "string".to_string())])
            .collect();
        let pick = |t: Option<&Value>, f: Option<&str>| target_field(t, &types, f);
        assert_eq!(pick(Some(&cmmi), None).unwrap(), SYMPTOM);
        assert_eq!(pick(Some(&custom), None).unwrap(), "Custom.Symptoms");
        assert_eq!(pick(Some(&agile), None).unwrap(), REPRO_STEPS);
        assert_eq!(pick(Some(&task), None).unwrap(), "System.Description");
        assert_eq!(pick(None, None).unwrap(), "System.Description");
        assert_eq!(pick(Some(&plain), None).unwrap(), REPRO_STEPS, "a plain-text Symptom cannot show images");
        assert_eq!(pick(Some(&cmmi), Some("repro steps")).unwrap(), REPRO_STEPS);
        assert_eq!(pick(Some(&cmmi), Some("Custom.Other")).unwrap(), "Custom.Other");
        assert!(pick(Some(&plain), Some("Symptom")).is_err());
    }

    #[test]
    fn images_go_after_the_fields_text() {
        let img = "<p><img src=\"u\"></p>";
        assert_eq!(append(Some(&json!("Save fails\nwith 500")), img), format!("<p>Save fails<br>with 500</p>{img}"));
        assert_eq!(append(Some(&json!("<div>x</div>")), img), format!("<div>x</div>{img}"));
        assert_eq!(append(None, img), img);
        assert_eq!(append(Some(&Value::Null), img), img);
    }
}
