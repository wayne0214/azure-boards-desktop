//! A second, normally hidden, webview that holds the TimeSheet website.
//! The UI drives it by injecting scripts; the page reports back through `timesheet_report`.

use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::sync::Mutex;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "timesheet";

/// The site the timesheet window was last opened on; navigation and the bridge are limited to it.
static SITE: Mutex<Option<Url>> = Mutex::new(None);

/// Microsoft sign-in hosts the timesheet site's login flow passes through.
const SIGN_IN_HOSTS: &[&str] = &[
    "login.microsoftonline.com",
    "login.microsoft.com",
    "login.live.com",
    "account.live.com",
    "account.microsoft.com",
];
const SIGN_IN_SUFFIXES: &[&str] = &[".microsoftonline.com", ".msauth.net", ".msftauth.net", ".live.com"];

fn set_site(url: &Url) {
    if let Ok(mut site) = SITE.lock() {
        *site = Some(url.clone());
    }
}

fn site() -> Option<Url> {
    SITE.lock().ok().and_then(|s| s.clone())
}

/// Origins the timesheet window's page may call the app's IPC from (`timesheet_report`).
static IPC_ORIGINS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The site is a setting, so its remote capability is granted at runtime, once per origin.
/// Without it the page still reports back through the URL-scheme and navigation channels.
fn allow_ipc(app: &AppHandle, site: &Url) {
    let origin = site.origin().ascii_serialization();
    let Ok(mut granted) = IPC_ORIGINS.lock() else { return };
    if granted.contains(&origin) {
        return;
    }
    let capability = CapabilityBuilder::new(format!("timesheet-remote-{}", granted.len()))
        .remote(format!("{origin}/*"))
        .window(LABEL)
        .permission("core:event:default");
    if app.add_capability(capability).is_ok() {
        granted.push(origin);
    }
}

fn is_sign_in_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    SIGN_IN_HOSTS.contains(&h.as_str()) || SIGN_IN_SUFFIXES.iter().any(|s| h.ends_with(s))
}

/// Pages the timesheet window may show: the timesheet site itself, Microsoft sign-in, and about:blank.
pub fn navigation_allowed(url: &Url, site: Option<&Url>) -> bool {
    if url.scheme() == "about" {
        return url.path() == "blank";
    }
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    site.and_then(|s| s.host_str()).is_some_and(|h| h.eq_ignore_ascii_case(host)) || is_sign_in_host(host)
}

fn parse_url(url: &str) -> AppResult<tauri::Url> {
    let parsed: tauri::Url = url.parse().map_err(|_| AppError::validation("The timesheet address is not a valid URL."))?;
    if parsed.scheme() != "https" {
        return Err(AppError::validation("The timesheet address must start with https://"));
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn timesheet_open(app: AppHandle, url: String, show: bool) -> AppResult<()> {
    let parsed = parse_url(&url)?;
    let show = show || std::env::var("BOARDS_TS_VISIBLE").is_ok();
    set_site(&parsed);
    allow_ipc(&app, &parsed);
    if let Some(win) = app.get_webview_window(LABEL) {
        win.navigate(parsed).map_err(|e| AppError::internal(e.to_string()))?;
        if show {
            let _ = win.show();
            let _ = win.set_focus();
        }
        return Ok(());
    }
    let app_for_load = app.clone();
    let win = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
        .title("Timesheet")
        .inner_size(1120.0, 820.0)
        .min_inner_size(720.0, 520.0)
        .visible(show)
        .on_navigation({
            let app_nav = app.clone();
            move |url| {
                // Channel 3: the page "navigates" to tsreport://... ; we read the payload and cancel the navigation.
                if url.scheme() == "tsreport" {
                    let payload = url.query_pairs().find(|(k, _)| k == "p").map(|(_, v)| v.into_owned()).and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
                    if let Some(p) = payload {
                        #[cfg(debug_assertions)]
                        eprintln!("[timesheet-nav] {}", p);
                        let _ = app_nav.emit_to("main", "timesheet-report", p);
                    }
                    return false;
                }
                let allowed = navigation_allowed(url, site().as_ref());
                #[cfg(debug_assertions)]
                if !allowed {
                    eprintln!("[timesheet-nav] blocked {}", url);
                }
                allowed
            }
        })
        .on_page_load(move |_webview, payload| {
            let phase = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            let _ = app_for_load.emit_to("main", "timesheet-page", serde_json::json!({ "phase": phase, "url": payload.url().to_string() }));
        })
        .build()
        .map_err(|e| AppError::internal(format!("Could not open the timesheet window: {e}")))?;
    // Closing the window would drop the signed-in session's page; hide it instead.
    let handle = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
            let _ = handle.emit_to("main", "timesheet-hidden", ());
        }
    });
    if show {
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn timesheet_show(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.show().map_err(|e| AppError::internal(e.to_string()))?;
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn timesheet_hide(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.hide().map_err(|e| AppError::internal(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn timesheet_is_open(app: AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

#[tauri::command]
pub fn timesheet_eval(app: AppHandle, script: String) -> AppResult<()> {
    let win = app
        .get_webview_window(LABEL)
        .ok_or_else(|| AppError::internal("The timesheet window is not open."))?;
    win.eval(&script).map_err(|e| AppError::internal(e.to_string()))
}

/// Called from the script running inside the timesheet page.
#[tauri::command]
pub fn timesheet_report(app: AppHandle, payload: Value) -> AppResult<()> {
    #[cfg(debug_assertions)]
    eprintln!("[timesheet-report] {}", payload);
    app.emit_to("main", "timesheet-report", payload).map_err(|e| AppError::internal(e.to_string()))
}

/// Second report channel: the page calls `tsbridge://localhost/r?p=<json>` (or
/// `http://tsbridge.localhost/r?p=` on Windows). Works even where the Tauri IPC is unavailable.
/// Only the timesheet window, on the timesheet site, may report through it.
pub fn handle_bridge(app: &AppHandle, webview_label: &str, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let site_origin = site().map(|u| u.origin().ascii_serialization());
    let origin = request.headers().get("origin").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let origin_ok = match (&origin, &site_origin) {
        // no-cors requests carry no Origin; the webview label still identifies the caller.
        (None, _) => true,
        (Some(o), Some(s)) => o == s,
        (Some(_), None) => false,
    };
    if webview_label != LABEL || !origin_ok {
        return tauri::http::Response::builder()
            .status(403)
            .body(Vec::new())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
    }
    let uri = request.uri().to_string();
    let payload = tauri::Url::parse(&uri)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "p").map(|(_, v)| v.into_owned()))
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    if let Some(p) = payload {
        #[cfg(debug_assertions)]
        eprintln!("[timesheet-bridge] {}", p);
        let _ = app.emit_to("main", "timesheet-report", p);
    }
    let mut res = tauri::http::Response::builder().status(204).header("Vary", "Origin");
    if let Some(o) = origin {
        res = res
            .header("Access-Control-Allow-Origin", o)
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type");
    }
    res.body(Vec::new())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

#[tauri::command]
pub fn timesheet_reload(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.eval("location.reload()").map_err(|e| AppError::internal(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn timesheet_close(app: AppHandle) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.destroy().map_err(|e| AppError::internal(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str) -> bool {
        let site = Url::parse("https://timesheet.example.com/").unwrap();
        navigation_allowed(&Url::parse(url).unwrap(), Some(&site))
    }

    #[test]
    fn timesheet_site_and_sign_in_are_allowed() {
        assert!(allowed("https://timesheet.example.com/timesheet"));
        assert!(allowed("https://login.microsoftonline.com/common/oauth2/v2.0/authorize"));
        assert!(allowed("https://aadcdn.msauth.net/x.js"));
        assert!(allowed("https://login.live.com/"));
        assert!(allowed("about:blank"));
    }

    #[test]
    fn other_sites_are_blocked() {
        assert!(!allowed("https://evil.example.net/"));
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("http://timesheet.example.com/"));
        assert!(!allowed("https://login.microsoftonline.com.evil.com/"));
        assert!(!allowed("file:///etc/passwd"));
        assert!(!navigation_allowed(&Url::parse("https://example.com/").unwrap(), None));
    }
}
