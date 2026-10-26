//! Staged imports: an AI tool stages a plan (`stage_import`) and the user reviews it in
//! Boards → Imports, picks rows and conflict fields, and applies them there. Nothing is written
//! to Azure DevOps until then. Kept in `mcp-imports.json` in the app's config folder, newest first.

use super::sync::{self, SyncRequest};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const KEEP: usize = 30;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Pending,
    /// Being written now; a second apply or a re-stage waits for it.
    Applying,
    Applied,
    Discarded,
    /// The AI tool staged the same file again.
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    pub id: String,
    pub org: String,
    pub project: String,
    pub source: Option<String>,
    /// Milliseconds since 1970.
    pub created: u64,
    pub status: Status,
    /// Counts when it was staged: create, update, skip, remove, error, rowsWithConflicts.
    pub summary: Value,
    pub request: SyncRequest,
    #[serde(default)]
    pub current_project: Option<String>,
    /// What the last apply did, per row. An import with failed rows stays pending so they can be tried again.
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub finished: Option<u64>,
}

impl Staged {
    /// Everything but the request, for lists.
    fn info(&self) -> Value {
        let mut v = serde_json::to_value(self).unwrap_or_default();
        if let Some(o) = v.as_object_mut() {
            o.remove("request");
            o.insert("rows".into(), json!(self.request.items.len()));
            o.insert("removeMissing".into(), json!(self.request.remove_missing));
        }
        v
    }
}

static FILE: Mutex<()> = Mutex::new(());

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_config_dir().map_err(|e| AppError::internal(e.to_string()))?.join("mcp-imports.json"))
}

/// The list, or an error for a file that cannot be read (never treated as empty, so it is not overwritten).
fn load_unlocked(app: &AppHandle) -> AppResult<Vec<Staged>> {
    let p = path(app)?;
    match std::fs::read_to_string(&p) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| AppError::internal(format!("Could not read {}: {e}", p.display()))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn load(app: &AppHandle) -> AppResult<Vec<Staged>> {
    let _guard = FILE.lock().map_err(|_| AppError::internal("Imports are unavailable."))?;
    load_unlocked(app)
}

/// Written through a temporary file, so a crash never leaves half a list.
fn save(app: &AppHandle, all: &[Staged]) -> AppResult<()> {
    let p = path(app)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(all)?)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

/// Reads, changes and writes the list under one lock.
fn update<T>(app: &AppHandle, f: impl FnOnce(&mut Vec<Staged>) -> AppResult<T>) -> AppResult<T> {
    let _guard = FILE.lock().map_err(|_| AppError::internal("Imports are unavailable."))?;
    let mut all = load_unlocked(app)?;
    let out = f(&mut all)?;
    save(app, &all)?;
    Ok(out)
}

fn new_id() -> String {
    let mut bytes = [0u8; 4];
    let _ = getrandom::getrandom(&mut bytes);
    format!("import-{:x}-{}", now(), bytes.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

fn find(all: &[Staged], id: &str) -> AppResult<Staged> {
    all.iter().find(|s| s.id == id).cloned().ok_or_else(|| AppError::validation(format!("No import {id}.")))
}

fn notify(app: &AppHandle) {
    let _ = app.emit_to("main", "mcp-imports", json!({}));
}

/// Keeps a new import; a pending one from the same file and project is marked superseded.
/// The user decides each conflict in the review, so a staged request never overwrites on its own.
pub fn stage(app: &AppHandle, org: &str, project: &str, mut request: SyncRequest, current_project: Option<String>, summary: Value) -> AppResult<Staged> {
    request.overwrite = false;
    let staged = Staged {
        id: new_id(),
        org: org.to_string(),
        project: project.to_string(),
        source: request.source.clone(),
        created: now(),
        status: Status::Pending,
        summary,
        request,
        current_project,
        result: None,
        finished: None,
    };
    let s = staged.clone();
    update(app, move |all| {
        let same = |x: &Staged| x.org == s.org && x.project == s.project && x.source == s.source;
        if all.iter().any(|x| x.status == Status::Applying && same(x)) {
            return Err(AppError::validation("The user is applying the earlier import of this file right now. Stage again when it has finished."));
        }
        for x in all.iter_mut().filter(|x| x.status == Status::Pending && same(x)) {
            x.status = Status::Superseded;
            x.finished = Some(now());
        }
        all.insert(0, s);
        all.truncate(KEEP);
        Ok(())
    })?;
    notify(app);
    Ok(staged)
}

/// For `get_import_result`: one import, or the newest.
pub fn result(app: &AppHandle, id: Option<&str>) -> AppResult<Value> {
    let all = load(app)?;
    let s = match id {
        Some(id) => find(&all, id)?,
        None => all.first().cloned().ok_or_else(|| AppError::validation("Nothing has been staged yet."))?,
    };
    let next = match s.status {
        Status::Pending if s.result.is_some() => "Partly applied: `result` shows the last attempt; rows that failed or changed can be applied again in Boards → Imports.",
        Status::Pending => "Not reviewed yet: the user applies or discards it in Boards → Imports.",
        Status::Applying => "The user is applying it now.",
        Status::Applied => "Applied by the user; `result` lists each row (rows they did not pick have skipped: \"not picked\").",
        Status::Discarded => "The user discarded it; nothing was written.",
        Status::Superseded => "Replaced by a newer import of the same file; nothing from this one was written.",
    };
    let mut v = s.info();
    if let Some(o) = v.as_object_mut() {
        o.insert("next".into(), json!(next));
    }
    Ok(v)
}

/// At start-up: an import left "applying" by a crash goes back to pending (its rows are re-checked on review).
pub fn recover(app: &AppHandle) {
    let _ = update(app, |all| {
        for s in all.iter_mut().filter(|s| s.status == Status::Applying) {
            s.status = Status::Pending;
        }
        Ok(())
    });
}

// ----- commands for the review screen -----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickIn {
    pub row_key: String,
    /// The row's `fp` from the review the user saw.
    pub fp: String,
    /// Conflict fields (reference names, or "System.Parent") that take the file's value.
    #[serde(default)]
    pub take_file: Vec<String>,
    /// Fields (reference names) whose file text the user edited: the text to use instead.
    #[serde(default)]
    pub edits: Map<String, Value>,
}

#[tauri::command]
pub fn mcp_imports(app: AppHandle) -> AppResult<Vec<Value>> {
    Ok(load(&app)?.iter().map(Staged::info).collect())
}

/// The import planned again against Boards as it is now, row by row.
#[tauri::command]
pub async fn mcp_import_review(app: AppHandle, id: String, take_file: Option<HashMap<String, Vec<String>>>) -> AppResult<Value> {
    let staged = find(&load(&app)?, &id)?;
    let state = app.state::<AppState>();
    let client = state.client(&staged.org).await?;
    let field_types = state.fields(&client).await?;
    let mut req = staged.request.clone();
    req.overwrite = false;
    req.take_file = take_file.unwrap_or_default();
    let mut v = sync::review(&client, &field_types, &req, staged.current_project.clone()).await?;
    if let Some(o) = v.as_object_mut() {
        o.insert("import".into(), staged.info());
    }
    Ok(v)
}

#[tauri::command]
pub async fn mcp_import_apply(app: AppHandle, id: String, picks: Vec<PickIn>) -> AppResult<Value> {
    if picks.is_empty() {
        return Err(AppError::validation("Pick at least one row."));
    }
    // Claim it first, so a second apply (or a re-stage) cannot run alongside this one.
    let staged = update(&app, |all| {
        let s = all.iter_mut().find(|s| s.id == id).ok_or_else(|| AppError::validation(format!("No import {id}.")))?;
        if s.status != Status::Pending {
            return Err(AppError::validation("This import is not waiting for review any more."));
        }
        s.status = Status::Applying;
        Ok(s.clone())
    })?;
    notify(&app);
    let outcome = run_apply(&app, &staged, picks).await;
    let r = outcome.as_ref().ok().cloned();
    update(&app, |all| {
        if let Some(s) = all.iter_mut().find(|s| s.id == id) {
            let failed = r.as_ref().and_then(|v| v["failed"].as_u64()).unwrap_or(0);
            // Failed or changed rows can be tried again, so the import stays open for them.
            s.status = if r.is_some() && failed == 0 { Status::Applied } else { Status::Pending };
            if r.is_some() {
                s.result = r.clone();
                s.finished = Some(now());
            }
        }
        Ok(())
    })?;
    notify(&app);
    outcome
}

async fn run_apply(app: &AppHandle, staged: &Staged, picks: Vec<PickIn>) -> AppResult<Value> {
    let state = app.state::<AppState>();
    let client = state.client(&staged.org).await?;
    let field_types = state.fields(&client).await?;
    let mut req = staged.request.clone();
    req.overwrite = false;
    req.take_file = picks.iter().filter(|p| !p.take_file.is_empty()).map(|p| (p.row_key.clone(), p.take_file.clone())).collect();
    req.edits = picks.iter().filter(|p| !p.edits.is_empty()).map(|p| (p.row_key.clone(), p.edits.clone())).collect();
    let picked: HashMap<String, String> = picks.into_iter().map(|p| (p.row_key, p.fp)).collect();
    let changed = |wid: i64| {
        let _ = app.emit_to("main", "mcp-changed", json!({ "id": wid }));
    };
    sync::apply_picked(&client, &field_types, &req, staged.current_project.clone(), &picked, &changed).await
}

#[tauri::command]
pub fn mcp_import_discard(app: AppHandle, id: String) -> AppResult<()> {
    update(&app, |all| {
        let s = all.iter_mut().find(|s| s.id == id).ok_or_else(|| AppError::validation(format!("No import {id}.")))?;
        if s.status == Status::Pending {
            s.status = Status::Discarded;
            s.finished = Some(now());
        }
        Ok(())
    })?;
    notify(&app);
    Ok(())
}
