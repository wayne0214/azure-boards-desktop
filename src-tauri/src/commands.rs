use crate::ado::api::{self, BoardQuery, BoardRef, ConnectionInfo, Identity, Project, Team};
use crate::ado::client::AdoClient;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::secrets;
use crate::settings::{Account, RecentTarget, Settings};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

fn normalize_org(input: &str) -> AppResult<String> {
    let mut s = input.trim().to_string();
    for prefix in ["https://", "http://"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.to_string();
        }
    }
    if let Some(rest) = s.strip_prefix("dev.azure.com/") {
        s = rest.to_string();
    }
    if let Some(idx) = s.find(".visualstudio.com") {
        s = s[..idx].to_string();
    }
    s = s.trim_matches('/').split('/').next().unwrap_or("").to_string();
    if s.is_empty() || s.contains(|c: char| c.is_whitespace()) {
        return Err(AppError::validation("Enter your organization name, for example \"contoso\"."));
    }
    Ok(s)
}

// ----- Accounts -----

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    state.settings.get()
}

#[tauri::command]
pub async fn test_connection(org: String, pat: String) -> AppResult<ConnectionInfo> {
    let org = normalize_org(&org)?;
    let pat = pat.trim();
    if pat.is_empty() {
        return Err(AppError::validation("Paste your Personal Access Token."));
    }
    let client = AdoClient::new(&org, pat)?;
    api::connection_info(&client).await
}

#[tauri::command]
pub async fn add_account(state: State<'_, AppState>, org: String, pat: String) -> AppResult<Settings> {
    let org = normalize_org(&org)?;
    let pat = pat.trim().to_string();
    let client = AdoClient::new(&org, &pat)?;
    let info = api::connection_info(&client).await?;
    secrets::save_pat(&org, &pat)?;
    state.forget_client(&org).await;
    let account = Account {
        org: org.clone(),
        user_id: info.user_id,
        user_name: info.user_name,
        added_at: now_secs(),
    };
    state.settings.update(|s| {
        s.accounts.retain(|a| a.org != org);
        s.accounts.push(account);
        s.active_org = Some(org.clone());
    })
}

#[tauri::command]
pub async fn remove_account(state: State<'_, AppState>, org: String) -> AppResult<Settings> {
    secrets::delete_pat(&org)?;
    state.forget_client(&org).await;
    state.settings.update(|s| {
        s.accounts.retain(|a| a.org != org);
        s.recent.retain(|r| r.org != org);
        if s.active_org.as_deref() == Some(org.as_str()) {
            s.active_org = s.accounts.first().map(|a| a.org.clone());
        }
    })
}

#[tauri::command]
pub fn set_active_org(state: State<'_, AppState>, org: String) -> AppResult<Settings> {
    state.settings.update(|s| s.active_org = Some(org))
}

#[tauri::command]
pub fn remember_target(state: State<'_, AppState>, target: RecentTarget) -> AppResult<Settings> {
    state.settings.update(|s| {
        s.recent.retain(|r| !(r.org == target.org && r.project_id == target.project_id));
        s.recent.insert(0, target);
        s.recent.truncate(12);
    })
}

#[tauri::command]
pub fn toggle_pinned_project(state: State<'_, AppState>, key: String) -> AppResult<Settings> {
    state.settings.update(|s| {
        if let Some(pos) = s.pinned_projects.iter().position(|k| k == &key) {
            s.pinned_projects.remove(pos);
        } else {
            s.pinned_projects.push(key);
        }
    })
}

// ----- Reads -----

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>, org: String) -> AppResult<Vec<Project>> {
    let client = state.client(&org).await?;
    let projects = api::list_projects(&client).await?;
    let _ = state.cache.set(&format!("{org}/projects"), &serde_json::to_string(&projects)?);
    Ok(projects)
}

#[tauri::command]
pub async fn list_teams(state: State<'_, AppState>, org: String, project_id: String) -> AppResult<Vec<Team>> {
    let client = state.client(&org).await?;
    api::list_teams(&client, &project_id).await
}

#[tauri::command]
pub async fn default_team(state: State<'_, AppState>, org: String, project_id: String) -> AppResult<Option<Team>> {
    let client = state.client(&org).await?;
    api::default_team(&client, &project_id).await
}

#[tauri::command]
pub async fn list_boards(state: State<'_, AppState>, org: String, project: String, team: String) -> AppResult<Vec<BoardRef>> {
    let client = state.client(&org).await?;
    api::list_boards(&client, &project, &team).await
}

#[tauri::command]
pub async fn get_board(state: State<'_, AppState>, org: String, project: String, team: String, board_id: String) -> AppResult<Value> {
    let client = state.client(&org).await?;
    api::get_board(&client, &project, &team, &board_id).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamContext {
    pub iterations: Vec<Value>,
    pub settings: Value,
    pub work_item_types: Vec<Value>,
    pub members: Vec<Identity>,
    pub tags: Vec<String>,
    pub field_types: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub async fn get_team_context(
    state: State<'_, AppState>,
    org: String,
    project_id: String,
    project: String,
    team: String,
) -> AppResult<TeamContext> {
    let client = state.client(&org).await?;
    let (iterations, settings, types, members, tags, field_types) = tokio::join!(
        api::list_iterations(&client, &project, &team),
        api::team_settings(&client, &project, &team),
        api::work_item_types_with_fields(&client, &project),
        api::project_members(&client, &project_id),
        api::project_tags(&client, &project_id),
        state.fields(&client),
    );
    Ok(TeamContext {
        iterations: iterations?,
        settings: settings.unwrap_or(Value::Null),
        work_item_types: types?,
        members: members.unwrap_or_default(),
        tags: tags.unwrap_or_default(),
        field_types: field_types.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn query_board_items(state: State<'_, AppState>, org: String, query: BoardQuery) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let fields = state.fields(&client).await?;
    api::query_board_items(&client, &fields, &query).await
}

#[tauri::command]
pub async fn project_items(
    state: State<'_, AppState>,
    org: String,
    project: String,
    types: Vec<String>,
    exclude_states: Vec<String>,
    extra_fields: Vec<String>,
    with_relations: Option<bool>,
) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let fields = state.fields(&client).await?;
    api::project_items(&client, &fields, &project, &types, &exclude_states, &extra_fields, with_relations.unwrap_or(false)).await
}

/// Link types the app may add: a change request affecting a requirement, or a plain related link.
const ALLOWED_LINKS: &[&str] = &["Microsoft.VSTS.Common.Affects-Forward", "System.LinkTypes.Related", "Microsoft.VSTS.Common.TestedBy-Reverse"];

#[tauri::command]
pub async fn add_link(state: State<'_, AppState>, org: String, project: String, id: i64, target_id: i64, rel: String) -> AppResult<Value> {
    if !ALLOWED_LINKS.contains(&rel.as_str()) {
        return Err(AppError::validation("That link type is not supported."));
    }
    let client = state.client(&org).await?;
    api::add_link(&client, &project, id, target_id, &rel).await
}

#[tauri::command]
pub async fn remove_link(state: State<'_, AppState>, org: String, project: String, id: i64, target_id: i64, rel: String) -> AppResult<Value> {
    if !ALLOWED_LINKS.contains(&rel.as_str()) {
        return Err(AppError::validation("That link type is not supported."));
    }
    let client = state.client(&org).await?;
    api::remove_link(&client, &project, id, target_id, &rel).await
}

/// Copy a recorded run to Azure Test Plans; a refusal comes back as a reason, never an error.
#[tauri::command]
pub async fn tp_mirror_result(state: State<'_, AppState>, org: String, project: String, input: crate::ado::testplans::MirrorInput) -> AppResult<crate::ado::testplans::MirrorResult> {
    let client = state.client(&org).await?;
    Ok(crate::ado::testplans::mirror_result(&client, &project, &input).await)
}

#[tauri::command]
pub async fn my_work(state: State<'_, AppState>, org: String) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let fields = state.fields(&client).await?;
    api::my_work(&client, &fields).await
}

#[tauri::command]
pub async fn planning_types(state: State<'_, AppState>, org: String, project: String) -> AppResult<Vec<String>> {
    let client = state.client(&org).await?;
    api::planning_types(&client, &project).await
}

#[tauri::command]
pub async fn mentioned_items(state: State<'_, AppState>, org: String) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let fields = state.fields(&client).await?;
    api::mentioned_items(&client, &fields).await
}

/// Work item types of one project, with their states, without field definitions.
#[tauri::command]
pub async fn work_item_types(state: State<'_, AppState>, org: String, project: String) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    api::work_item_types(&client, &project).await
}

#[tauri::command]
pub async fn search_work_items(
    state: State<'_, AppState>,
    org: String,
    project: Option<String>,
    text: String,
) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let fields = state.fields(&client).await?;
    api::search_items(&client, &fields, project.as_deref(), &text).await
}

#[tauri::command]
pub async fn get_work_item(state: State<'_, AppState>, org: String, project: String, id: i64) -> AppResult<Value> {
    let client = state.client(&org).await?;
    api::get_work_item(&client, &project, id).await
}

#[tauri::command]
pub async fn get_children(state: State<'_, AppState>, org: String, project: String, id: i64) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let fields = state.fields(&client).await?;
    api::get_children(&client, &fields, &project, id).await
}

#[tauri::command]
pub async fn get_comments(state: State<'_, AppState>, org: String, project: String, id: i64) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    api::get_comments(&client, &project, id).await
}

#[tauri::command]
pub async fn get_updates(state: State<'_, AppState>, org: String, project: String, id: i64) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    api::get_updates(&client, &project, id).await
}

/// Create a module (area path). Names follow Azure DevOps rules: no \\ / : * ? " < > | # $ & + and not too long.
#[tauri::command]
pub async fn create_area(state: State<'_, AppState>, org: String, project: String, parent: String, name: String) -> AppResult<Value> {
    let name = name.trim();
    if name.is_empty() || name.len() > 255 || name.chars().any(|c| "\\/:*?\"<>|#$&+%".contains(c) || c.is_control()) || name.starts_with('.') || name.ends_with('.') {
        return Err(AppError::validation("A module name cannot be empty or contain \\ / : * ? \" < > | # $ & + %."));
    }
    let client = state.client(&org).await?;
    api::create_area(&client, &project, &parent, name).await.map_err(|e| {
        if e.kind == ErrorKind::Forbidden || e.kind == ErrorKind::Unauthorized {
            AppError::new(e.kind, "You do not have permission to add modules. Ask a project administrator to add it under Project settings → Areas.")
        } else {
            e
        }
    })
}

/// The area paths a team's board shows, and whether each includes its sub-areas.
#[tauri::command]
pub async fn team_areas(state: State<'_, AppState>, org: String, project: String, team: String) -> AppResult<Vec<Value>> {
    let client = state.client(&org).await?;
    let areas = api::team_areas(&client, &project, &team).await?;
    Ok(areas.into_iter().map(|(path, include)| serde_json::json!({ "path": path, "includeChildren": include })).collect())
}

#[tauri::command]
pub async fn get_classification_nodes(
    state: State<'_, AppState>,
    org: String,
    project: String,
    group: String,
) -> AppResult<Value> {
    if group != "areas" && group != "iterations" {
        return Err(AppError::validation("group must be areas or iterations"));
    }
    let client = state.client(&org).await?;
    api::classification_nodes(&client, &project, &group).await
}

// ----- Writes -----

#[tauri::command]
pub async fn create_work_item(
    state: State<'_, AppState>,
    org: String,
    project: String,
    work_item_type: String,
    fields: Map<String, Value>,
    parent_id: Option<i64>,
) -> AppResult<Value> {
    let title_ok = fields
        .get("System.Title")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !title_ok {
        return Err(AppError::validation("A title is required."));
    }
    let client = state.client(&org).await?;
    api::create_work_item(&client, &project, &work_item_type, &fields, parent_id).await
}

#[tauri::command]
pub async fn update_work_item(
    state: State<'_, AppState>,
    org: String,
    project: String,
    id: i64,
    rev: Option<i64>,
    fields: Map<String, Value>,
) -> AppResult<Value> {
    if fields.is_empty() {
        return Err(AppError::validation("Nothing to update."));
    }
    let client = state.client(&org).await?;
    api::update_work_item(&client, &project, id, rev, &fields).await
}

#[tauri::command]
pub async fn set_parent(
    state: State<'_, AppState>,
    org: String,
    project: String,
    id: i64,
    parent_id: Option<i64>,
) -> AppResult<Value> {
    let client = state.client(&org).await?;
    api::set_parent(&client, &project, id, parent_id).await
}

#[tauri::command]
pub async fn delete_work_item(state: State<'_, AppState>, org: String, project: String, id: i64) -> AppResult<()> {
    let client = state.client(&org).await?;
    api::delete_work_item(&client, &project, id).await
}

#[tauri::command]
pub async fn add_comment(
    state: State<'_, AppState>,
    org: String,
    project: String,
    id: i64,
    text: String,
) -> AppResult<Value> {
    if text.trim().is_empty() {
        return Err(AppError::validation("Write a comment first."));
    }
    let client = state.client(&org).await?;
    api::add_comment(&client, &project, id, &text).await
}

#[tauri::command]
pub async fn fetch_attachment(state: State<'_, AppState>, org: String, url: String) -> AppResult<String> {
    use base64::Engine;
    if !crate::ado::client::is_ado_url(&url) {
        return Err(AppError::validation("Only Azure DevOps attachments can be loaded."));
    }
    let client = state.client(&org).await?;
    let (ct, bytes) = client.get_bytes(&url).await?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(AppError::validation("Attachment is too large to display."));
    }
    Ok(format!("data:{};base64,{}", ct, base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Upload a file (e.g. a pasted screenshot) as a work item attachment; returns `{ id, url }`.
/// The URL can be used in rich text fields as an image source.
#[tauri::command]
pub async fn upload_attachment(state: State<'_, AppState>, org: String, project: String, file_name: String, data_base64: String) -> AppResult<Value> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| AppError::validation("The file could not be read."))?;
    if bytes.is_empty() {
        return Err(AppError::validation("The file is empty."));
    }
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(AppError::validation("Images up to 25 MB can be attached."));
    }
    let name: String = file_name.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\')).collect();
    let name = if name.trim().is_empty() { "image.png".to_string() } else { name };
    let client = state.client(&org).await?;
    let url = client.url(&format!("/{}/_apis/wit/attachments?fileName={}", crate::ado::client::enc(&project), urlencoding::encode(&name)));
    client.post_bytes(&url, bytes).await
}

/// Launch options for development, e.g. `BOARDS_START_VIEW=timesheet`.
#[tauri::command]
pub fn get_launch_options() -> Value {
    serde_json::json!({ "startView": std::env::var("BOARDS_START_VIEW").ok() })
}

/// Debug-only trace from the UI, printed to the terminal.
#[tauri::command]
pub fn debug_log(message: String) {
    #[cfg(debug_assertions)]
    eprintln!("[ui] {message}");
    #[cfg(not(debug_assertions))]
    let _ = message;
}

// ----- Cache -----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub value: Value,
    pub updated_at: i64,
}

#[tauri::command]
pub fn cache_get(state: State<'_, AppState>, key: String) -> AppResult<Option<CacheEntry>> {
    match state.cache.get(&key)? {
        Some((raw, updated_at)) => Ok(Some(CacheEntry { value: serde_json::from_str(&raw)?, updated_at })),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn cache_set(state: State<'_, AppState>, key: String, value: Value) -> AppResult<()> {
    state.cache.set(&key, &value.to_string())
}

#[tauri::command]
pub fn cache_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.cache.clear()
}

// ----- Files -----

#[derive(Debug, Serialize)]
pub struct CsvData {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Shows the native dialog and waits for it without blocking the main thread.
async fn run_dialog<F>(show: F) -> AppResult<Option<PathBuf>>
where
    F: FnOnce(Box<dyn FnOnce(Option<FilePath>) + Send>),
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    show(Box::new(move |picked| {
        let _ = tx.send(picked);
    }));
    let picked = rx.await.map_err(|_| AppError::internal("The file dialog closed unexpectedly."))?;
    match picked {
        Some(p) => p.into_path().map(Some).map_err(|e| AppError::validation(format!("That location cannot be used: {e}"))),
        None => Ok(None),
    }
}

fn dialog_for(app: &tauri::AppHandle) -> FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    match app.get_webview_window("main") {
        Some(win) => dialog.set_parent(&win),
        None => dialog,
    }
}

fn picked(state: &AppState, path: Option<PathBuf>) -> AppResult<Option<String>> {
    match path {
        Some(p) => {
            let shown = p.to_string_lossy().into_owned();
            state.allow_path(p)?;
            Ok(Some(shown))
        }
        None => Ok(None),
    }
}

/// Asks where to save a file; the chosen path may then be written with `write_text_file`.
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    default_name: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> AppResult<Option<String>> {
    let filter_name = filter_name.unwrap_or_else(|| "CSV".into());
    let extensions = extensions.filter(|e| !e.is_empty()).unwrap_or_else(|| vec!["csv".into()]);
    let ext_refs: Vec<&str> = extensions.iter().map(|e| e.as_str()).collect();
    let builder = dialog_for(&app).set_file_name(default_name).add_filter(filter_name, &ext_refs);
    let path = run_dialog(|done| builder.save_file(done)).await?;
    picked(&state, path)
}

/// Asks for a CSV file to import; the chosen path may then be read with `read_csv`.
#[tauri::command]
pub async fn pick_csv_file(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<Option<String>> {
    let builder = dialog_for(&app).add_filter("CSV", &["csv", "txt"]);
    let path = run_dialog(|done| builder.pick_file(done)).await?;
    picked(&state, path)
}

/// Asks for a file to open, of the given kinds; the chosen path may then be read with `read_text_file`.
#[tauri::command]
pub async fn pick_open_file(app: tauri::AppHandle, state: State<'_, AppState>, filter_name: String, extensions: Vec<String>) -> AppResult<Option<String>> {
    let ext_refs: Vec<&str> = extensions.iter().map(|e| e.as_str()).collect();
    let builder = dialog_for(&app).add_filter(filter_name, &ext_refs);
    let path = run_dialog(|done| builder.pick_file(done)).await?;
    picked(&state, path)
}

/// Largest text file read from disk, such as a test report.
const MAX_TEXT_FILE: u64 = 50 * 1024 * 1024;

#[tauri::command]
pub fn read_text_file(state: State<'_, AppState>, path: String) -> AppResult<String> {
    state.check_path(Path::new(&path))?;
    if std::fs::metadata(&path)?.len() > MAX_TEXT_FILE {
        return Err(AppError::validation("That file is larger than 50 MB."));
    }
    let bytes = std::fs::read(&path)?;
    String::from_utf8(bytes).map_err(|_| AppError::validation("That file is not UTF-8 text."))
}

#[tauri::command]
pub fn read_csv(state: State<'_, AppState>, path: String) -> AppResult<CsvData> {
    state.check_path(Path::new(&path))?;
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_path(&path)
        .map_err(|e| AppError::validation(format!("Could not open the file: {e}")))?;
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| AppError::validation(format!("Could not read the header row: {e}")))?
        .iter()
        .map(|h| h.trim_start_matches('\u{feff}').to_string())
        .collect();
    let mut rows = Vec::new();
    for rec in reader.records() {
        let rec = rec.map_err(|e| AppError::validation(format!("Bad row in CSV: {e}")))?;
        let mut row: Vec<String> = rec.iter().map(|s| s.to_string()).collect();
        row.resize(headers.len(), String::new());
        rows.push(row);
        if rows.len() > 5000 {
            return Err(AppError::validation("Import is limited to 5,000 rows at a time."));
        }
    }
    Ok(CsvData { headers, rows })
}

#[tauri::command]
pub fn write_text_file(state: State<'_, AppState>, path: String, content: String) -> AppResult<()> {
    state.check_path(Path::new(&path))?;
    std::fs::write(&path, content)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ImportRow {
    pub work_item_type: String,
    pub fields: Map<String, Value>,
    pub parent_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub index: usize,
    pub id: Option<i64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn import_work_items(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org: String,
    project: String,
    rows: Vec<ImportRow>,
) -> AppResult<Vec<ImportResult>> {
    use tauri::Emitter;
    let client = state.client(&org).await?;
    let mut results = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        let res = api::create_work_item(&client, &project, &row.work_item_type, &row.fields, row.parent_id).await;
        let item = match res {
            Ok(v) => ImportResult { index, id: v.get("id").and_then(|i| i.as_i64()), error: None },
            Err(e) => ImportResult { index, id: None, error: Some(e.message) },
        };
        let _ = app.emit("import-progress", &item);
        results.push(item);
    }
    Ok(results)
}

/// Seconds since the Unix epoch, as a string.
fn now_secs() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}
