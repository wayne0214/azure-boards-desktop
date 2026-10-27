//! Project and code wikis: Azure DevOps Wiki REST API. Pages are markdown kept in a git repository;
//! a page's ETag is its version, sent back when saving so an edit never overwrites someone else's.
use super::client::{enc, AdoClient};
use crate::error::{AppError, AppResult, ErrorKind};
use base64::Engine;
use serde_json::{json, Value};

/// Largest image shown or uploaded, as for work item attachments.
const MAX_ATTACHMENT: usize = 25 * 1024 * 1024;

fn wikis_base(project: &str) -> String {
    format!("/{}/_apis/wiki/wikis", enc(project))
}

/// Code wikis live on a branch, which every page request names; project wikis have just one.
fn version_query(version: Option<&str>) -> String {
    version.filter(|v| !v.is_empty()).map(|v| format!("&versionDescriptor.version={}&versionDescriptor.versionType=branch", enc(v))).unwrap_or_default()
}

pub async fn list_wikis(client: &AdoClient, project: &str) -> AppResult<Vec<Value>> {
    let v: Value = client.get(&client.url(&wikis_base(project))).await?;
    let mut list = v.get("value").and_then(Value::as_array).cloned().unwrap_or_default();
    // The project wiki first: it is the one teams write in.
    list.sort_by_key(|w| (w.get("type").and_then(Value::as_str) != Some("projectWiki"), w.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase()));
    Ok(list)
}

/// Creates the project's own wiki, for a project that has none yet.
pub async fn create_project_wiki(client: &AdoClient, project: &str, project_id: &str) -> AppResult<Value> {
    client.post_json(&client.url(&wikis_base(project)), &json!({ "name": format!("{project}.wiki"), "projectId": project_id, "type": "projectWiki" })).await
}

/// Every page, as a tree from the root page "/" (`subPages` under each).
pub async fn page_tree(client: &AdoClient, project: &str, wiki_id: &str, version: Option<&str>) -> AppResult<Value> {
    let url = client.url(&format!("{}/{}/pages?path=%2F&recursionLevel=full{}", wikis_base(project), enc(wiki_id), version_query(version)));
    client.get(&url).await
}

/// A page's markdown and version: `{ path, content, version, remoteUrl }`.
pub async fn get_page(client: &AdoClient, project: &str, wiki_id: &str, path: &str, version: Option<&str>) -> AppResult<Value> {
    let url = client.url(&format!("{}/{}/pages?path={}&includeContent=true{}", wikis_base(project), enc(wiki_id), enc(path), version_query(version)));
    let (page, etag) = client.get_with_etag(&url).await?;
    Ok(json!({
        "path": page.get("path").cloned().unwrap_or_else(|| json!(path)),
        "content": page.get("content").and_then(Value::as_str).unwrap_or(""),
        "version": etag,
        "remoteUrl": page.get("remoteUrl"),
    }))
}

/// Saves a page. With `page_version` (from get_page) it updates that page and fails if someone saved
/// it since; without, it creates a new page and fails if one is already there.
pub async fn save_page(client: &AdoClient, project: &str, wiki_id: &str, path: &str, content: &str, page_version: Option<&str>, version: Option<&str>) -> AppResult<Value> {
    let url = client.url(&format!("{}/{}/pages?path={}{}", wikis_base(project), enc(wiki_id), enc(path), version_query(version)));
    let body = json!({ "content": content }).to_string();
    match client.put_with_etag(&url, "application/json", body, page_version).await {
        Ok((page, etag)) => Ok(json!({ "path": page.get("path").cloned().unwrap_or_else(|| json!(path)), "version": etag, "remoteUrl": page.get("remoteUrl") })),
        Err(e) if e.status == Some(412) || (page_version.is_some() && e.kind == ErrorKind::Conflict) => {
            Err(AppError::new(ErrorKind::Conflict, "Someone else saved this page while you were editing it. Copy your text, reload the page, and add your changes again.").with_status(412))
        }
        Err(e) if page_version.is_none() && (e.kind == ErrorKind::Conflict || e.message.to_lowercase().contains("already exists")) => {
            Err(AppError::new(ErrorKind::Conflict, "A page with that name is already there. Pick another name.").with_status(409))
        }
        Err(e) => Err(e),
    }
}

/// Uploads an image to the wiki's `.attachments` folder; returns `{ name, path }` for markdown.
pub async fn upload_attachment(client: &AdoClient, project: &str, wiki_id: &str, name: &str, data_base64: &str, version: Option<&str>) -> AppResult<Value> {
    let size = data_base64.len() / 4 * 3;
    if size == 0 {
        return Err(AppError::validation("The file is empty."));
    }
    if size > MAX_ATTACHMENT {
        return Err(AppError::validation("Images up to 25 MB can be attached."));
    }
    let name: String = name.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | '#' | '?')).collect();
    let name = if name.trim().is_empty() { "image.png".to_string() } else { name.trim().to_string() };
    let url = client.url(&format!("{}/{}/attachments?name={}{}", wikis_base(project), enc(wiki_id), enc(&name), version_query(version)));
    let (v, _) = client.put_with_etag(&url, "application/octet-stream", data_base64.to_string(), None).await?;
    Ok(json!({ "name": v.get("name"), "path": v.get("path") }))
}

/// An image in the wiki's `.attachments` folder as a data URL, read from the wiki's git repository.
/// `root` is a code wiki's folder in its repository (its `mappedPath`); a project wiki's is the repository root.
pub async fn attachment(client: &AdoClient, project: &str, repo_id: &str, branch: &str, path: &str, root: Option<&str>) -> AppResult<String> {
    let path = attachment_path(path).ok_or_else(|| AppError::validation("Only images in the wiki's .attachments folder can be shown."))?;
    let path = format!("{}{path}", repo_root(root));
    let url = client.url(&format!(
        "/{}/_apis/git/repositories/{}/items?path={}&versionDescriptor.version={}&versionDescriptor.versionType=branch&$format=octetStream&download=true",
        enc(project),
        enc(repo_id),
        enc(&path),
        enc(branch)
    ));
    let (ct, bytes) = client.get_bytes(&url).await?;
    if bytes.len() > MAX_ATTACHMENT {
        return Err(AppError::validation("The image is too large to show."));
    }
    let ct = if ct.starts_with("image/") { ct } else { image_type(&path).to_string() };
    Ok(format!("data:{ct};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// `/.attachments/x.png` from how markdown may write it (`.attachments/x.png`, with a title, encoded spaces).
/// A code wiki's folder as "/docs" (no trailing slash); "" for the repository root.
fn repo_root(root: Option<&str>) -> String {
    let r = root.map(|r| r.trim().trim_matches('/')).filter(|r| !r.is_empty() && !r.contains("..")).unwrap_or("");
    if r.is_empty() { String::new() } else { format!("/{r}") }
}

/// Most commits read when listing recent changes; a busy wiki shows its latest ones.
const MAX_COMMITS: usize = 30;

/// Pages changed on the wiki's branch since `since` (an ISO time), newest first, each once:
/// when it last changed and by whom. Deleted pages are left out.
pub async fn changes(client: &AdoClient, project: &str, repo_id: &str, branch: &str, root: Option<&str>, since: &str) -> AppResult<Vec<Value>> {
    let repo = format!("/{}/_apis/git/repositories/{}", enc(project), enc(repo_id));
    let url = client.url(&format!(
        "{repo}/commits?searchCriteria.itemVersion.version={}&searchCriteria.itemVersion.versionType=branch&searchCriteria.fromDate={}&searchCriteria.$top={MAX_COMMITS}",
        enc(branch),
        enc(since)
    ));
    let list: Value = client.get(&url).await?;
    let commits = list["value"].as_array().cloned().unwrap_or_default();
    let changed = futures::future::join_all(commits.iter().map(|c| {
        let url = client.url(&format!("{repo}/commits/{}/changes?top=200", enc(c["commitId"].as_str().unwrap_or_default())));
        async move { client.get::<Value>(&url).await.unwrap_or(Value::Null) }
    }))
    .await;
    let root = repo_root(root);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (c, ch) in commits.iter().zip(changed) {
        for path in changed_pages(&ch, &root) {
            if seen.insert(path.clone()) {
                out.push(json!({ "path": path, "date": c.pointer("/author/date"), "author": c.pointer("/author/name"), "authorEmail": c.pointer("/author/email") }));
            }
        }
    }
    Ok(out)
}

/// Page paths a commit's changes touch: markdown files under the wiki's folder, not attachments, not deleted.
fn changed_pages(changes: &Value, root: &str) -> Vec<String> {
    changes["changes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| !c["changeType"].as_str().is_some_and(|t| t.contains("delete")) && !c.pointer("/item/isFolder").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|c| c.pointer("/item/path").and_then(Value::as_str))
        .filter_map(|p| if root.is_empty() { Some(p) } else { p.strip_prefix(root).filter(|r| r.starts_with('/')) })
        .filter(|p| p.ends_with(".md") && !p.starts_with("/.attachments/"))
        .map(page_path_from_git)
        .collect()
}

fn attachment_path(src: &str) -> Option<String> {
    let s = src.trim().split(['?', '#']).next().unwrap_or("");
    let s = urlencoding::decode(s).map(|c| c.into_owned()).unwrap_or_else(|_| s.to_string());
    let s = if s.starts_with('/') { s } else { format!("/{s}") };
    (s.starts_with("/.attachments/") && !s.contains("..")).then_some(s)
}

fn image_type(path: &str) -> &'static str {
    match path.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Full-text search in the project's wikis (Azure DevOps Search). Falls back to matching page titles
/// when search is not available, e.g. on a server without the Search service.
pub async fn search(client: &AdoClient, project: &str, text: &str, top: usize) -> AppResult<Value> {
    let url = format!("https://almsearch.dev.azure.com/{}/{}/_apis/search/wikisearchresults?api-version=7.1", enc(client.org()), enc(project));
    let body = json!({ "searchText": text, "$skip": 0, "$top": top, "filters": { "Project": [project] }, "includeFacets": false });
    match client.post_json::<Value>(&url, &body).await {
        Ok(v) => Ok(json!({ "fullText": true, "results": v.get("results").and_then(Value::as_array).into_iter().flatten().map(search_hit).collect::<Vec<_>>() })),
        Err(e) if matches!(e.kind, ErrorKind::Unauthorized) => Err(e),
        Err(_) => {
            let mut results = Vec::new();
            for w in list_wikis(client, project).await? {
                let id = w.get("id").and_then(Value::as_str).unwrap_or_default();
                let version = (w.get("type").and_then(Value::as_str) == Some("codeWiki")).then(|| w.pointer("/versions/0/version").and_then(Value::as_str)).flatten();
                let tree = page_tree(client, project, id, version).await?;
                for path in title_matches(&flatten(&tree), text).into_iter().take(top.saturating_sub(results.len())) {
                    results.push(json!({ "wikiId": id, "wikiName": w.get("name"), "path": path, "title": page_title(&path), "snippet": "" }));
                }
            }
            Ok(json!({ "fullText": false, "results": results }))
        }
    }
}

fn search_hit(r: &Value) -> Value {
    let path = page_path_from_git(r.get("path").and_then(Value::as_str).unwrap_or(""));
    let snippet = r
        .get("hits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|h| h.get("highlights").and_then(Value::as_array).cloned().unwrap_or_default())
        .filter_map(|h| h.as_str().map(strip_highlight))
        .take(2)
        .collect::<Vec<_>>()
        .join(" … ");
    json!({ "wikiId": r.pointer("/wiki/id"), "wikiName": r.pointer("/wiki/name"), "title": page_title(&path), "path": path, "snippet": snippet })
}

fn strip_highlight(s: &str) -> String {
    s.replace("<highlighthit>", "").replace("</highlighthit>", "")
}

/// A page path from the git path search returns: `/Meeting-notes/Q4%2Dplan.md` → `/Meeting notes/Q4-plan`.
/// The wiki writes spaces as "-" and a real "-" as "%2D" in file names.
pub fn page_path_from_git(git: &str) -> String {
    let p = git.strip_suffix(".md").unwrap_or(git);
    let segs: Vec<String> = p
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            let spaced = s.replace('-', " ");
            urlencoding::decode(&spaced).map(|c| c.into_owned()).unwrap_or(spaced)
        })
        .collect();
    format!("/{}", segs.join("/"))
}

/// The last part of a page path, as the page's title.
pub fn page_title(path: &str) -> String {
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or("Home").to_string()
}

/// Every page path in a tree from page_tree, parents before their children.
pub fn flatten(tree: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(n: &Value, out: &mut Vec<String>) {
        if let Some(p) = n.get("path").and_then(Value::as_str).filter(|p| *p != "/") {
            out.push(p.to_string());
        }
        let mut subs: Vec<&Value> = n.get("subPages").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
        subs.sort_by_key(|s| s.get("order").and_then(Value::as_i64).unwrap_or(0));
        for s in subs {
            walk(s, out);
        }
    }
    walk(tree, &mut out);
    out
}

/// Pages whose path has every word of `text`, case-insensitive.
fn title_matches(paths: &[String], text: &str) -> Vec<String> {
    let words: Vec<String> = text.split_whitespace().map(str::to_lowercase).collect();
    paths.iter().filter(|p| { let l = p.to_lowercase(); words.iter().all(|w| l.contains(w)) }).cloned().collect()
}

/// A page name as Azure DevOps allows it: no "/", "\" or "#", not starting with ".".
pub fn check_page_name(name: &str) -> Result<String, AppError> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::validation("Give the page a name."));
    }
    if n.chars().any(|c| matches!(c, '/' | '\\' | '#') || c.is_control()) || n.starts_with('.') {
        return Err(AppError::validation("A page name cannot contain / \\ or #, or start with a dot."));
    }
    if n.len() > 235 {
        return Err(AppError::validation("That page name is too long."));
    }
    Ok(n.to_string())
}

/// A child page's path: `/` + name at the top, else under the parent.
pub fn child_path(parent: &str, name: &str) -> String {
    let parent = parent.trim_end_matches('/');
    format!("{parent}/{name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commits_list_the_pages_they_change() {
        let ch = json!({ "changes": [
            { "item": { "path": "/docs/Meeting-notes/2026%2D10%2D27-Standup.md" }, "changeType": "add" },
            { "item": { "path": "/docs/.attachments/a.png" }, "changeType": "add" },
            { "item": { "path": "/docs/Old.md" }, "changeType": "delete" },
            { "item": { "path": "/docs", "isFolder": true }, "changeType": "edit" },
            { "item": { "path": "/src/main.md" }, "changeType": "edit" },
        ] });
        assert_eq!(changed_pages(&ch, "/docs"), vec!["/Meeting notes/2026-10-27 Standup"]);
        assert_eq!(repo_root(Some("docs/")), "/docs");
        assert_eq!(repo_root(Some("/")), "");
        assert_eq!(repo_root(Some("../x")), "");
    }

    #[test]
    fn search_paths_become_page_paths() {
        assert_eq!(page_path_from_git("/Meeting-notes/Q4%2Dplan.md"), "/Meeting notes/Q4-plan");
        assert_eq!(page_path_from_git("/Home.md"), "/Home");
        assert_eq!(page_title("/Meeting notes/Q4-plan"), "Q4-plan");
        assert_eq!(page_title("/"), "Home");
    }

    #[test]
    fn trees_flatten_in_page_order() {
        let tree = json!({ "path": "/", "subPages": [
            { "path": "/B", "order": 1, "subPages": [{ "path": "/B/Child", "order": 0 }] },
            { "path": "/A", "order": 0 },
        ] });
        assert_eq!(flatten(&tree), vec!["/A", "/B", "/B/Child"]);
        assert_eq!(title_matches(&flatten(&tree), "b child"), vec!["/B/Child"]);
    }

    #[test]
    fn page_names_and_paths() {
        assert_eq!(check_page_name("  Sprint 42 review ").unwrap(), "Sprint 42 review");
        assert!(check_page_name("a/b").is_err());
        assert!(check_page_name("#1").is_err());
        assert!(check_page_name(".hidden").is_err());
        assert!(check_page_name("").is_err());
        assert_eq!(child_path("/", "Home"), "/Home");
        assert_eq!(child_path("/Meetings", "2026-10-26"), "/Meetings/2026-10-26");
    }

    #[test]
    fn only_attachments_are_read() {
        assert_eq!(attachment_path(".attachments/shot%20one.png").as_deref(), Some("/.attachments/shot one.png"));
        assert_eq!(attachment_path("/.attachments/a.png?x=1").as_deref(), Some("/.attachments/a.png"));
        assert_eq!(attachment_path("/Home.md"), None);
        assert_eq!(attachment_path("/.attachments/../secret"), None);
        assert_eq!(image_type("/.attachments/a.JPG"), "image/jpeg");
    }

    #[test]
    fn code_wikis_name_their_branch() {
        assert_eq!(version_query(None), "");
        assert_eq!(version_query(Some("main")), "&versionDescriptor.version=main&versionDescriptor.versionType=branch");
        assert_eq!(strip_highlight("a <highlighthit>b</highlighthit>"), "a b");
    }
}
