//! Commands for the Wiki view: the project's Azure DevOps wikis, read and edited in place.
use crate::ado::wiki;
use crate::error::AppResult;
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn wiki_list(state: State<'_, AppState>, org: String, project: String) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    wiki::list_wikis(&c, &project).await
}

#[tauri::command]
pub async fn wiki_create(state: State<'_, AppState>, org: String, project: String, project_id: String) -> AppResult<Value> {
    let c = state.client(&org).await?;
    wiki::create_project_wiki(&c, &project, &project_id).await
}

#[tauri::command]
pub async fn wiki_tree(state: State<'_, AppState>, org: String, project: String, wiki_id: String, version: Option<String>) -> AppResult<Value> {
    let c = state.client(&org).await?;
    wiki::page_tree(&c, &project, &wiki_id, version.as_deref()).await
}

#[tauri::command]
pub async fn wiki_page(state: State<'_, AppState>, org: String, project: String, wiki_id: String, path: String, version: Option<String>) -> AppResult<Value> {
    let c = state.client(&org).await?;
    wiki::get_page(&c, &project, &wiki_id, &path, version.as_deref()).await
}

/// Saves a page; `page_version` from wiki_page for an edit, none for a new page.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn wiki_save(state: State<'_, AppState>, org: String, project: String, wiki_id: String, path: String, content: String, page_version: Option<String>, version: Option<String>) -> AppResult<Value> {
    let c = state.client(&org).await?;
    wiki::save_page(&c, &project, &wiki_id, &path, &content, page_version.as_deref(), version.as_deref()).await
}

/// A new page under `parent` (a path; "/" for the top level).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn wiki_create_page(state: State<'_, AppState>, org: String, project: String, wiki_id: String, parent: String, name: String, content: String, version: Option<String>) -> AppResult<Value> {
    let name = wiki::check_page_name(&name)?;
    let c = state.client(&org).await?;
    wiki::save_page(&c, &project, &wiki_id, &wiki::child_path(&parent, &name), &content, None, version.as_deref()).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn wiki_upload_attachment(state: State<'_, AppState>, org: String, project: String, wiki_id: String, file_name: String, data_base64: String, version: Option<String>) -> AppResult<Value> {
    let c = state.client(&org).await?;
    wiki::upload_attachment(&c, &project, &wiki_id, &file_name, &data_base64, version.as_deref()).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn wiki_attachment(state: State<'_, AppState>, org: String, project: String, repo_id: String, branch: String, path: String, root: Option<String>) -> AppResult<String> {
    let c = state.client(&org).await?;
    wiki::attachment(&c, &project, &repo_id, &branch, &path, root.as_deref()).await
}

#[tauri::command]
pub async fn wiki_search(state: State<'_, AppState>, org: String, project: String, text: String) -> AppResult<Value> {
    if text.trim().is_empty() {
        return Ok(json!({ "fullText": false, "results": [] }));
    }
    let c = state.client(&org).await?;
    wiki::search(&c, &project, text.trim(), 25).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn wiki_changes(state: State<'_, AppState>, org: String, project: String, repo_id: String, branch: String, root: Option<String>, since: String) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    wiki::changes(&c, &project, &repo_id, &branch, root.as_deref(), &since).await
}

/// Work items for a live block on a page; `filter` takes the same fields as the AI tools' find_work_items.
#[tauri::command]
pub async fn wiki_find_items(state: State<'_, AppState>, org: String, project: String, team: Option<String>, filter: Value) -> AppResult<Value> {
    let c = state.client(&org).await?;
    crate::mcp::find_items(&c, &state, &org, &project, team.as_deref(), &filter).await
}
