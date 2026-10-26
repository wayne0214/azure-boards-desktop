//! Wiki tools: AI tools search and read the project wiki (team conventions, decisions, meeting notes)
//! and add to pages. Adding only appends, against the page's version, so nobody's text is overwritten.

use super::tools::str_arg;
use crate::ado::client::AdoClient;
use crate::ado::wiki;
use crate::error::{AppError, ErrorKind};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

pub fn definitions(read_only: bool) -> Vec<Value> {
    let project = json!({ "type": "string", "description": "Project name; omit for the current project" });
    let which = json!({ "type": "string", "description": "Wiki name or ID; omit for the project wiki" });
    let path = json!({ "type": "string", "description": "Page path, e.g. \"/Decision log/0002 Resumable uploads\" (from search_wiki or list_wiki_pages)" });
    let mut tools = vec![
        super::tools::tool("search_wiki", "Search the text of the project's wiki pages: team conventions, decisions, meeting notes, onboarding. Returns page paths with a snippet; read one with get_wiki_page.", json!({
            "text": { "type": "string" },
            "project": project,
        }), &["text"], true),
        super::tools::tool("list_wiki_pages", "Every page path in a wiki, parents first.", json!({ "project": project, "wiki": which }), &[], true),
        super::tools::tool("get_wiki_page", "A wiki page's markdown. \"#123\" in it is a work item.", json!({ "path": path, "project": project, "wiki": which }), &["path"], true),
    ];
    if !read_only {
        tools.push(super::tools::tool("append_to_wiki", "Add markdown to the end of a wiki page (e.g. a decision, meeting notes, an answer the team should keep). Never replaces what is there. Creates the page when `create` is true and it does not exist; a new page's parent must exist. Tell the user what you added.", json!({
            "path": path,
            "text": { "type": "string", "description": "Markdown to add; \"#123\" links a work item" },
            "create": { "type": "boolean", "description": "Create the page if it does not exist" },
            "project": project,
            "wiki": which,
        }), &["path", "text"], false));
    }
    tools
}

pub fn handles(name: &str) -> bool {
    matches!(name, "search_wiki" | "list_wiki_pages" | "get_wiki_page" | "append_to_wiki")
}

pub async fn call(app: &AppHandle, client: &AdoClient, current_project: Option<String>, name: &str, args: &Value) -> Result<Value, AppError> {
    let project = str_arg(args, "project").filter(|p| !p.trim().is_empty()).or(current_project).ok_or_else(|| AppError::validation("No project is open in Boards; pass `project`."))?;
    if name == "search_wiki" {
        let text = str_arg(args, "text").filter(|t| !t.trim().is_empty()).ok_or_else(|| AppError::validation("Give some text to search for."))?;
        return wiki::search(client, &project, text.trim(), 25).await;
    }
    let (id, version, wiki_name) = pick_wiki(client, &project, str_arg(args, "wiki").as_deref()).await?;
    match name {
        "list_wiki_pages" => {
            let tree = wiki::page_tree(client, &project, &id, version.as_deref()).await?;
            Ok(json!({ "wiki": wiki_name, "pages": wiki::flatten(&tree) }))
        }
        "get_wiki_page" => {
            let path = page_path(args)?;
            let page = wiki::get_page(client, &project, &id, &path, version.as_deref()).await.map_err(|e| not_found(e, &path))?;
            Ok(json!({ "wiki": wiki_name, "path": page["path"], "content": page["content"], "url": page["remoteUrl"] }))
        }
        _ => {
            let path = page_path(args)?;
            let text = str_arg(args, "text").filter(|t| !t.trim().is_empty()).ok_or_else(|| AppError::validation("Give the text to add."))?;
            let create = args.get("create").and_then(Value::as_bool).unwrap_or(false);
            let created = append(client, &project, &id, version.as_deref(), &path, &text, create).await?;
            let _ = app.emit_to("main", "mcp-wiki-changed", json!({ "path": path }));
            Ok(json!({ "wiki": wiki_name, "path": path, "created": created, "next": "Tell the user what you added and where." }))
        }
    }
}

/// The wiki named (by name or ID), else the project wiki; with a code wiki's branch.
async fn pick_wiki(client: &AdoClient, project: &str, want: Option<&str>) -> Result<(String, Option<String>, Value), AppError> {
    let wikis = wiki::list_wikis(client, project).await?;
    let found = match want.map(str::trim).filter(|w| !w.is_empty()) {
        Some(w) => wikis.iter().find(|x| x.get("id").and_then(Value::as_str) == Some(w) || x.get("name").and_then(Value::as_str).is_some_and(|n| n.eq_ignore_ascii_case(w))),
        None => wikis.first(),
    };
    let w = found.ok_or_else(|| match want {
        Some(w) => AppError::validation(format!("No wiki \"{w}\" in {project}. Wikis: {}.", wikis.iter().filter_map(|x| x.get("name").and_then(Value::as_str)).collect::<Vec<_>>().join(", "))),
        None => AppError::validation(format!("{project} has no wiki yet. The user can create it in Boards → Wiki.")),
    })?;
    let version = (w.get("type").and_then(Value::as_str) == Some("codeWiki")).then(|| w.pointer("/versions/0/version").and_then(Value::as_str).map(str::to_string)).flatten();
    Ok((w.get("id").and_then(Value::as_str).unwrap_or_default().to_string(), version, w.get("name").cloned().unwrap_or(Value::Null)))
}

fn page_path(args: &Value) -> Result<String, AppError> {
    let p = str_arg(args, "path").map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).ok_or_else(|| AppError::validation("Give the page's path."))?;
    Ok(if p.starts_with('/') { p } else { format!("/{p}") })
}

fn not_found(e: AppError, path: &str) -> AppError {
    if e.kind == ErrorKind::NotFound {
        AppError::validation(format!("There is no page {path}. Find it with search_wiki or list_wiki_pages."))
    } else {
        e
    }
}

/// Appends to the page as it is now; if someone saves in between, reads it again and retries once.
async fn append(client: &AdoClient, project: &str, wiki_id: &str, version: Option<&str>, path: &str, text: &str, create: bool) -> Result<bool, AppError> {
    for _ in 0..2 {
        let page = match wiki::get_page(client, project, wiki_id, path, version).await {
            Ok(p) => p,
            Err(e) if e.kind == ErrorKind::NotFound && create => {
                let name = wiki::page_title(path);
                wiki::check_page_name(&name)?;
                wiki::save_page(client, project, wiki_id, path, text.trim(), None, version).await?;
                return Ok(true);
            }
            Err(e) => return Err(not_found(e, path)),
        };
        let content = joined(page["content"].as_str().unwrap_or(""), text);
        match wiki::save_page(client, project, wiki_id, path, &content, page["version"].as_str(), version).await {
            Ok(_) => return Ok(false),
            Err(e) if e.kind == ErrorKind::Conflict => continue,
            Err(e) => return Err(e),
        }
    }
    Err(AppError::new(ErrorKind::Conflict, "The page kept changing while adding to it. Try again in a moment."))
}

/// The page's text with `text` after it, one blank line between.
fn joined(existing: &str, text: &str) -> String {
    let base = existing.trim_end();
    if base.is_empty() { text.trim().to_string() } else { format!("{base}\n\n{}\n", text.trim()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appended_text_follows_a_blank_line() {
        assert_eq!(joined("# Notes\n\n- a\n\n", "- b"), "# Notes\n\n- a\n\n- b\n");
        assert_eq!(joined("", " First "), "First");
    }

    #[test]
    fn paths_start_at_the_root() {
        assert_eq!(page_path(&json!({ "path": "Decision log/0001" })).unwrap(), "/Decision log/0001");
        assert_eq!(page_path(&json!({ "path": "/Home" })).unwrap(), "/Home");
        assert!(page_path(&json!({})).is_err());
    }

    #[test]
    fn read_only_leaves_out_appending() {
        let names = |ro| definitions(ro).iter().map(|t| t["name"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(names(true), vec!["search_wiki", "list_wiki_pages", "get_wiki_page"]);
        assert!(names(false).contains(&"append_to_wiki".to_string()));
    }
}
