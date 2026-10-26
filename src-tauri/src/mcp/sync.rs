//! Bring a list of work items (e.g. SRS parsed from a markdown file) into Boards safely:
//! plan first (create / fill empty fields / skip / conflict), then apply exactly that plan.
//!
//! Matching: the type's ID field (e.g. "SRS ID") first, then the exact title. Existing text is
//! never replaced unless the caller asks for `overwrite`; a difference is reported as a conflict.
//!
//! The same plan backs staged imports (imports.rs): there each row also carries the full text
//! before and after, and the user picks rows and conflict fields in the app.

use super::fields::{self, TypeInfo};
use super::steps::{self, STEPS_FIELD, TESTS_REL};
use super::tools::{html_to_text, text_to_html};
use crate::ado::api::{self, FieldMap};
use crate::ado::client::AdoClient;
use crate::ado::wiql;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

const MAX_ROWS: usize = 300;
const WIQL_MAX: u32 = 1000;
const DEFAULT_TYPE: &str = "Requirement";
/// Added to items the file no longer has, whether or not their type has a Removed state.
pub const REMOVED_TAG: &str = "Removed by import";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    #[serde(default)]
    pub project: Option<String>,
    /// Type for rows that do not name one; "Requirement" when omitted.
    #[serde(default, rename = "type")]
    pub default_type: Option<String>,
    /// The ID field to match on for the default type, when it is not detected.
    #[serde(default)]
    pub key_field: Option<String>,
    /// The ID field per type, when it is not detected: type name → field, e.g. {"Epic": "User Need ID"}.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub key_fields: HashMap<String, String>,
    /// Replace text that differs instead of reporting a conflict.
    #[serde(default)]
    pub overwrite: bool,
    pub items: Vec<RowIn>,
    /// The file is the complete list for its types: items of those types it does not have are offered for removal.
    #[serde(default)]
    pub remove_missing: bool,
    /// Where the items came from, e.g. "docs/SRS.md".
    #[serde(default)]
    pub source: Option<String>,
    /// Picked in the review: row key → fields (reference names, or "System.Parent") whose conflict takes the file's value.
    #[serde(skip)]
    pub take_file: HashMap<String, Vec<String>>,
    /// Edited in the review: row key → field reference name → the text to use instead of the file's.
    #[serde(skip)]
    pub edits: HashMap<String, Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowIn {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, rename = "type")]
    pub type_name: Option<String>,
    #[serde(default)]
    pub fields: Map<String, Value>,
    #[serde(default)]
    pub parent_key: Option<String>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    /// Test case steps: `[{ "action", "expected" }]` or numbered lines.
    #[serde(default)]
    pub steps: Option<Value>,
    /// Requirements a test case tests (Tested By links), by key ("SRS-0012") or ID ("#3741").
    #[serde(default)]
    pub tests: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum Parent {
    None,
    Id(i64),
    /// Created earlier in the same plan, by row index.
    Row(usize),
}

#[derive(Debug, Clone, PartialEq)]
enum Action {
    Create,
    Update,
    Skip,
    /// In Boards but not in the file: set to Removed (when the type has that state) and tagged.
    Remove,
    Error(String),
}

#[derive(Debug, Clone)]
struct RowPlan {
    /// Stable across re-plans: "r3" for the file's fourth row, "w1182" for an item only in Boards.
    row_key: String,
    type_name: String,
    action: Action,
    work_item_id: Option<i64>,
    /// Field values to write, ready for Azure DevOps (rich text as HTML).
    set: Map<String, Value>,
    parent: Parent,
    set_parent: bool,
    /// For display: what each write is, and what was left alone.
    view: Value,
    /// The existing item's revision, to notice a change between review and apply.
    rev: Option<i64>,
    /// Per field, for the review: kind (set, fill, conflict, same), text before and after, and whether it is written.
    changes: Vec<Value>,
    /// Posted on the item after the change (removals say why).
    comment: Option<String>,
    /// Requirements to link as tested by this item: wanted while planning, then only those not linked yet.
    links: Vec<i64>,
    /// Display labels for link targets ("SRS-0012 #3741").
    link_labels: HashMap<i64, String>,
}

// ----- comparing values -----

/// Text as compared: rich text reduced to words, whitespace collapsed.
pub fn normalize(v: &Value) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => html_to_text(s),
        Value::Object(o) => o.get("displayName").and_then(Value::as_str).unwrap_or("").to_string(),
        other => other.to_string(),
    };
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Text as shown in the review: rich text as plain text, line breaks kept.
fn shown(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => html_to_text(s).trim().to_string(),
        Value::Object(o) => o.get("displayName").and_then(Value::as_str).unwrap_or("").to_string(),
        other => other.to_string(),
    }
}

/// `tags` (Azure DevOps "a; b") with `tag` added once.
pub fn add_tag(tags: &str, tag: &str) -> String {
    let mut list: Vec<&str> = tags.split(';').map(str::trim).filter(|t| !t.is_empty()).collect();
    if !list.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
        list.push(tag);
    }
    list.join("; ")
}

fn change(field: &str, name: &str, kind: &str, before: String, after: String, write: bool) -> Value {
    json!({ "field": field, "name": name, "kind": kind, "before": before, "after": after, "write": write })
}

#[derive(Debug, PartialEq)]
pub enum Cmp {
    Same,
    Fill,
    Conflict,
}

pub fn compare(existing: Option<&Value>, incoming: &Value) -> Cmp {
    let have = existing.map(normalize).unwrap_or_default();
    let want = normalize(incoming);
    if have.is_empty() && !want.is_empty() {
        Cmp::Fill
    } else if have == want || want.is_empty() {
        Cmp::Same
    } else {
        Cmp::Conflict
    }
}

fn short(s: &str) -> String {
    let t: String = s.chars().take(280).collect();
    if t.len() < s.len() { format!("{t}…") } else { t }
}

pub(super) fn key_norm(s: &str) -> String {
    s.trim().to_lowercase()
}

/// The value Azure DevOps should store: steps as their XML, HTML for rich-text fields, the value as given otherwise.
fn write_value(field_types: &FieldMap, reference: &str, v: &Value) -> Value {
    if reference == STEPS_FIELD {
        return json!(steps::to_xml(&steps::from_input(v).unwrap_or_default()));
    }
    match (field_types.get(reference).map(String::as_str), v) {
        (Some("html"), Value::String(s)) => json!(text_to_html(s)),
        _ => v.clone(),
    }
}

/// Text the user edited in the review replaces the file's value of fields the file has. The key a row is
/// matched on is not editable; edited steps are numbered text like the review shows.
fn apply_edits(incoming: &mut [(String, Value)], edits: &Map<String, Value>, key_field: Option<&str>) {
    for (field, v) in incoming.iter_mut() {
        if Some(field.as_str()) == key_field {
            continue;
        }
        let Some(text) = edits.get(field.as_str()).and_then(Value::as_str) else { continue };
        *v = if field == STEPS_FIELD { steps::to_value(&steps::from_input(&json!(text)).unwrap_or_default()) } else { json!(text) };
    }
}

/// A value as the review shows it; steps as numbered text.
fn shown_field(reference: &str, v: &Value) -> String {
    if reference == STEPS_FIELD {
        return steps::to_text(&steps::from_input(v).unwrap_or_default());
    }
    shown(v)
}

/// Compares Boards' value with the file's: kind, text before and after, and why it cannot be written (if so).
fn compare_field(reference: &str, have: Option<&Value>, v: &Value) -> (Cmp, String, String, Option<String>) {
    if reference == STEPS_FIELD {
        let theirs = have.and_then(Value::as_str).map(steps::parse).unwrap_or_default();
        let mine = steps::from_input(v).unwrap_or_default();
        let (before, after) = (steps::to_text(&theirs), steps::to_text(&mine));
        let cmp = if mine.is_empty() || steps::same(&theirs, &mine) { Cmp::Same } else if theirs.is_empty() { Cmp::Fill } else { Cmp::Conflict };
        // Writing a new list would drop the reference to shared steps.
        let locked = (cmp == Cmp::Conflict && steps::has_shared(&theirs)).then(|| "Uses shared steps, so its steps are kept; change them in Boards.".to_string());
        return (cmp, before, after, locked);
    }
    (compare(have, v), have.map(shown).unwrap_or_default(), shown(v), None)
}

/// A link target written as "#3741" or "3741".
pub(super) fn id_ref(s: &str) -> Option<i64> {
    s.trim().trim_start_matches('#').parse().ok()
}

/// Requirements' links from tests: work item ID → IDs it is linked to as tested by.
async fn tested_by(client: &AdoClient, ids: &[i64]) -> AppResult<HashMap<i64, Vec<i64>>> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(200) {
        let res: Value = client.post_json(&client.url("/_apis/wit/workitemsbatch"), &json!({ "ids": chunk, "$expand": "Relations", "errorPolicy": "Omit" })).await?;
        for it in res.get("value").and_then(Value::as_array).into_iter().flatten() {
            let targets: Vec<i64> = it
                .get("relations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|r| r.get("rel").and_then(Value::as_str) == Some(TESTS_REL))
                .filter_map(|r| r.get("url").and_then(Value::as_str).and_then(|u| u.rsplit('/').next()).and_then(|x| x.parse().ok()))
                .collect();
            out.insert(item_id(it), targets);
        }
    }
    Ok(out)
}

// ----- looking things up -----

async fn ids_where(client: &AdoClient, project: &str, clause: &str) -> AppResult<Vec<i64>> {
    let q = format!(
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = {} AND [System.State] <> 'Removed' AND {clause}",
        wiql::quote(project)
    );
    let ids = api::run_wiql(client, "", &q, WIQL_MAX).await?;
    // At the limit some matches may be missing, and a missed match becomes a duplicate or a false removal.
    if ids.len() as u32 >= WIQL_MAX {
        return Err(AppError::validation(format!("A lookup found {WIQL_MAX} or more work items, so some could be missed. Split the file into smaller parts.")));
    }
    Ok(ids)
}

async fn items(client: &AdoClient, ids: &[i64], fields: &[String]) -> AppResult<Vec<Value>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    api::get_items_batch(client, "", ids, fields).await
}

fn field_str(item: &Value, reference: &str) -> String {
    item.get("fields").and_then(|f| f.get(reference)).map(normalize).unwrap_or_default()
}

fn item_id(item: &Value) -> i64 {
    item.get("id").and_then(Value::as_i64).unwrap_or(0)
}

/// Existing items of `type_name` whose `field` is one of `values`, keyed by that value (lowercased).
async fn by_field(
    client: &AdoClient,
    field_types: &FieldMap,
    project: &str,
    type_name: &str,
    field: &str,
    values: &[String],
    fetch: &[String],
) -> AppResult<HashMap<String, Vec<Value>>> {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    // A word search on rich text also finds longer values, so it looks at fewer keys at a time.
    let size = if fields::is_long_text(field_types, field) { 25 } else { 100 };
    for chunk in values.chunks(size) {
        let clause = format!("[System.WorkItemType] = {} AND {}", wiql::quote(type_name), fields::any_of(field_types, field, chunk));
        let ids = ids_where(client, project, &clause).await?;
        for it in items(client, &ids, fetch).await? {
            // A word search also finds longer values; keep exact matches only.
            let k = key_norm(&field_str(&it, field));
            if chunk.iter().any(|c| key_norm(c) == k) {
                out.entry(k).or_default().push(it);
            }
        }
    }
    Ok(out)
}

/// Parents by key across every ID field in the project: key (lowercased) → work item IDs.
/// A parent as the review shows it: "Feature #3700: DI-12 Export reports", or "New Feature: …" for one this import creates.
fn describe(type_name: &str, id: Option<i64>, key: Option<&str>, title: &str) -> String {
    let what = match id {
        Some(id) => format!("{type_name} #{id}"),
        None => format!("New {type_name}"),
    };
    let name = [key.unwrap_or(""), title].iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
    if name.is_empty() { what } else { format!("{what}: {name}") }
}

/// "row 2" (a parent this import creates) named after that row.
fn row_label(req: &SyncRequest, default_type: &str, text: &str) -> Option<String> {
    let i = text.strip_prefix("row ")?.parse::<usize>().ok()?.checked_sub(1)?;
    let row = req.items.get(i)?;
    Some(describe(row.type_name.as_deref().unwrap_or(default_type), None, row.key.as_deref(), row.title.as_deref().unwrap_or("")))
}

/// Parent changes are planned as "#3700" or "row 2"; the review names them in full.
async fn label_parents(client: &AdoClient, key_fields: &[String], req: &SyncRequest, default_type: &str, rows: &mut [RowPlan]) -> AppResult<()> {
    let is_parent = |c: &Value| c["field"] == "System.Parent";
    let ids: HashSet<i64> = rows
        .iter()
        .flat_map(|r| r.changes.iter().filter(|c| is_parent(c)))
        .flat_map(|c| [&c["before"], &c["after"]])
        .filter_map(|v| v.as_str()?.strip_prefix('#')?.parse().ok())
        .collect();
    let mut fetch: Vec<String> = vec!["System.Title".into(), "System.WorkItemType".into()];
    fetch.extend(key_fields.iter().cloned());
    let found = items(client, &ids.into_iter().collect::<Vec<_>>(), &fetch).await?;
    let labels: HashMap<String, String> = found
        .iter()
        .map(|it| {
            let key = key_fields.iter().map(|f| field_str(it, f)).find(|k| !k.is_empty());
            (format!("#{}", item_id(it)), describe(&field_str(it, "System.WorkItemType"), Some(item_id(it)), key.as_deref(), &field_str(it, "System.Title")))
        })
        .collect();
    for c in rows.iter_mut().flat_map(|r| r.changes.iter_mut()).filter(|c| is_parent(c)) {
        for side in ["before", "after"] {
            let label = c[side].as_str().and_then(|t| labels.get(t).cloned().or_else(|| row_label(req, default_type, t)));
            if let Some(label) = label {
                c[side] = json!(label);
            }
        }
    }
    Ok(())
}

/// The ID field the request names for a type: from `keyFields`, else `keyField` for the default type.
fn named_key_field<'a>(req: &'a SyncRequest, default_type: &str, type_name: &str) -> Option<&'a str> {
    req.key_fields
        .iter()
        .find(|(t, _)| t.trim().eq_ignore_ascii_case(type_name))
        .map(|(_, f)| f.as_str())
        .or_else(|| req.key_field.as_deref().filter(|_| type_name.eq_ignore_ascii_case(default_type)))
        .filter(|f| !f.trim().is_empty())
}

pub(super) async fn parents_by_key(client: &AdoClient, field_types: &FieldMap, project: &str, key_fields: &[String], keys: &[String]) -> AppResult<HashMap<String, Vec<i64>>> {
    let mut out: HashMap<String, Vec<i64>> = HashMap::new();
    if key_fields.is_empty() || keys.is_empty() {
        return Ok(out);
    }
    for chunk in keys.chunks(100) {
        let clause = format!("({})", key_fields.iter().map(|f| fields::any_of(field_types, f, chunk)).collect::<Vec<_>>().join(" OR "));
        let ids = ids_where(client, project, &clause).await?;
        for it in items(client, &ids, key_fields).await? {
            for f in key_fields {
                let k = key_norm(&field_str(&it, f));
                if !k.is_empty() && chunk.iter().any(|c| key_norm(c) == k) {
                    let e = out.entry(k).or_default();
                    if !e.contains(&item_id(&it)) {
                        e.push(item_id(&it));
                    }
                }
            }
        }
    }
    Ok(out)
}

// ----- planning -----

struct Planned {
    project: String,
    rows: Vec<RowPlan>,
    /// Why items only in Boards were not looked for.
    removals_held: Option<String>,
}

async fn build(client: &AdoClient, field_types: &FieldMap, req: &SyncRequest, current_project: Option<String>) -> AppResult<Planned> {
    if req.items.is_empty() {
        return Err(AppError::validation("`items` is empty."));
    }
    if req.items.len() > MAX_ROWS {
        return Err(AppError::validation(format!("At most {MAX_ROWS} items per plan; split the file.")));
    }
    let project = req.project.clone().or(current_project).ok_or_else(|| AppError::validation("No project is open in Boards; pass `project`."))?;
    let types = fields::project_types(client, &project).await?;
    let default_type = req.default_type.clone().unwrap_or_else(|| DEFAULT_TYPE.to_string());

    // Each row's type, key field and resolved fields.
    struct Prepared<'a> {
        t: Option<&'a TypeInfo>,
        key_field: Option<String>,
        incoming: Vec<(String, Value)>,
        error: Option<String>,
    }
    let mut prepared: Vec<Prepared> = Vec::new();
    for (i, row) in req.items.iter().enumerate() {
        let type_name = row.type_name.clone().unwrap_or_else(|| default_type.clone());
        let t = match fields::find_type(&types, &type_name) {
            Ok(t) => t,
            Err(e) => {
                prepared.push(Prepared { t: None, key_field: None, incoming: Vec::new(), error: Some(e.message) });
                continue;
            }
        };
        let mut error = None;
        let key_field = match named_key_field(req, &default_type, &t.name) {
            Some(name) => fields::resolve_field(t, name).or_else(|| {
                error = Some(format!("\"{}\" has no field \"{name}\" to match keys on.", t.name));
                None
            }),
            None => fields::key_field(t),
        };
        let mut incoming = Vec::new();
        if let Some(title) = row.title.as_deref().filter(|s| !s.trim().is_empty()) {
            incoming.push(("System.Title".to_string(), json!(title.trim())));
        }
        if let (Some(kf), Some(key)) = (&key_field, row.key.as_deref().filter(|k| !k.trim().is_empty())) {
            incoming.push((kf.clone(), json!(key.trim())));
        }
        for (name, v) in &row.fields {
            match fields::resolve_field(t, name) {
                Some(r) if r == STEPS_FIELD && !incoming.iter().any(|(x, _)| *x == r) => match steps::from_input(v) {
                    Ok(list) => incoming.push((r, steps::to_value(&list))),
                    Err(e) => error = Some(e),
                },
                Some(r) if !incoming.iter().any(|(x, _)| *x == r) => incoming.push((r, v.clone())),
                Some(_) => {}
                None => {
                    let near = fields::similar(t, name);
                    let hint = if near.is_empty() { "Check list_work_item_types.".to_string() } else { format!("Did you mean: {}? Ask the user if unsure.", near.join(", ")) };
                    error = Some(format!("\"{}\" has no field \"{name}\". {hint}", t.name));
                }
            }
        }
        if let Some(sv) = &row.steps {
            match (fields::resolve_field(t, STEPS_FIELD), steps::from_input(sv)) {
                (Some(r), Ok(list)) => {
                    incoming.retain(|(x, _)| *x != r);
                    incoming.push((r, steps::to_value(&list)));
                }
                (None, _) => error = Some(format!("\"{}\" has no Steps field; steps belong to test cases.", t.name)),
                (_, Err(e)) => error = Some(e),
            }
        }
        if let Some(edits) = req.edits.get(&format!("r{i}")) {
            apply_edits(&mut incoming, edits, key_field.as_deref());
        }
        if row.key.is_some() && key_field.is_none() {
            error = error.or(Some(format!("\"{}\" has no ID field to put the key in; name it in `keyFields`, e.g. {{\"{}\": \"<field>\"}}.", t.name, t.name)));
        }
        prepared.push(Prepared { t: Some(t), key_field, incoming, error });
    }

    // Fields to read back from existing items.
    let mut fetch: Vec<String> = vec!["System.Title".into(), "System.Parent".into(), "System.WorkItemType".into()];
    for p in &prepared {
        for (r, _) in &p.incoming {
            if !fetch.contains(r) {
                fetch.push(r.clone());
            }
        }
    }

    // Existing items by key, then by title, per type.
    let mut by_key: HashMap<(String, String), Vec<Value>> = HashMap::new();
    let mut by_title: HashMap<(String, String), Vec<Value>> = HashMap::new();
    let mut groups: HashMap<(String, Option<String>), (Vec<String>, Vec<String>)> = HashMap::new();
    for (row, p) in req.items.iter().zip(&prepared) {
        let Some(t) = p.t else { continue };
        let g = groups.entry((t.name.clone(), p.key_field.clone())).or_default();
        if let (Some(_), Some(k)) = (&p.key_field, row.key.as_deref().filter(|k| !k.trim().is_empty())) {
            g.0.push(k.trim().to_string());
        }
        if let Some(title) = row.title.as_deref().filter(|s| !s.trim().is_empty()) {
            g.1.push(title.trim().to_string());
        }
    }
    for ((type_name, key_field), (keys, titles)) in &groups {
        if let Some(kf) = key_field {
            for (k, v) in by_field(client, field_types, &project, type_name, kf, keys, &fetch).await? {
                by_key.insert((type_name.clone(), k), v);
            }
        }
        for (k, v) in by_field(client, field_types, &project, type_name, "System.Title", titles, &fetch).await? {
            by_title.insert((type_name.clone(), k), v);
        }
    }

    // Parents and tested requirements may be any type, so look in every type's ID field.
    let mut key_fields = fields::all_key_fields(&types);
    for p in &prepared {
        if let Some(kf) = p.key_field.as_ref().filter(|kf| !key_fields.contains(kf)) {
            key_fields.push(kf.clone());
        }
    }

    // Parents named by key: existing ones, or rows of this plan.
    let parent_keys: Vec<String> = req.items.iter().filter_map(|r| r.parent_key.clone()).filter(|k| !k.trim().is_empty()).collect();
    let parents = parents_by_key(client, field_types, &project, &key_fields, &parent_keys).await?;
    let test_keys: Vec<String> = req.items.iter().flat_map(|r| r.tests.iter()).filter(|k| id_ref(k).is_none() && !k.trim().is_empty()).cloned().collect();
    let test_targets = parents_by_key(client, field_types, &project, &key_fields, &test_keys).await?;

    let mut rows: Vec<RowPlan> = Vec::new();
    for (i, (row, p)) in req.items.iter().zip(&prepared).enumerate() {
        let type_name = p.t.map(|t| t.name.clone()).unwrap_or_default();
        let row_key = format!("r{i}");
        let mut plan = RowPlan { row_key: row_key.clone(), type_name: type_name.clone(), action: Action::Skip, work_item_id: None, set: Map::new(), parent: Parent::None, set_parent: false, view: Value::Null, rev: None, changes: Vec::new(), comment: None, links: Vec::new(), link_labels: HashMap::new() };
        let take_file = |field: &str| req.overwrite || req.take_file.get(&row_key).is_some_and(|f| f.iter().any(|x| x == field));
        let label = json!({ "row": i + 1, "key": row.key, "title": row.title, "type": type_name });
        let fail = |mut plan: RowPlan, msg: String| {
            plan.action = Action::Error(msg.clone());
            plan.view = json!({ "row": label["row"], "key": label["key"], "title": label["title"], "action": "error", "error": msg });
            plan
        };
        let (Some(t), None) = (p.t, &p.error) else {
            rows.push(fail(plan, p.error.clone().unwrap_or_default()));
            continue;
        };

        // Match: key first; the exact title only for an item without a different key.
        let key = row.key.as_deref().map(key_norm).filter(|k| !k.is_empty());
        let mut matched_by = None;
        let mut found: Vec<Value> = key.as_ref().and_then(|k| by_key.get(&(t.name.clone(), k.clone()))).cloned().unwrap_or_default();
        if !found.is_empty() {
            matched_by = Some("key");
        } else if let Some(title) = row.title.as_deref().map(key_norm).filter(|s| !s.is_empty()) {
            let same_title: Vec<Value> = by_title.get(&(t.name.clone(), title)).cloned().unwrap_or_default();
            found = same_title
                .into_iter()
                .filter(|it| match (&p.key_field, &key) {
                    (Some(kf), Some(k)) => {
                        let theirs = key_norm(&field_str(it, kf));
                        theirs.is_empty() || theirs == *k
                    }
                    _ => true,
                })
                .collect();
            if !found.is_empty() {
                matched_by = Some("title");
            }
        }
        if found.len() > 1 {
            let ids: Vec<i64> = found.iter().map(item_id).collect();
            rows.push(fail(plan, format!("Matches several work items: {ids:?}. Give a key, or fix the duplicates in Boards.")));
            continue;
        }

        // Requirements it tests.
        let mut link_error = None;
        for k in row.tests.iter().filter(|k| !k.trim().is_empty()) {
            let target = match id_ref(k) {
                Some(id) => Some((id, format!("#{id}"))),
                None => match test_targets.get(&key_norm(k)).map(Vec::as_slice) {
                    Some([id]) => Some((*id, format!("{} #{id}", k.trim()))),
                    Some(ids) if ids.len() > 1 => {
                        link_error = Some(format!("\"{}\" matches several work items: {ids:?}.", k.trim()));
                        None
                    }
                    _ => {
                        link_error = Some(format!("No work item has the key \"{}\" to link as tested.", k.trim()));
                        None
                    }
                },
            };
            if let Some((id, label)) = target {
                if !plan.links.contains(&id) {
                    plan.links.push(id);
                    plan.link_labels.insert(id, label);
                }
            }
        }
        if let Some(e) = link_error {
            rows.push(fail(plan, e));
            continue;
        }

        // Parent.
        let wanted_parent = if let Some(id) = row.parent_id {
            Ok(Parent::Id(id))
        } else if let Some(pk) = row.parent_key.as_deref().filter(|k| !k.trim().is_empty()) {
            let k = key_norm(pk);
            let earlier = req.items[..i].iter().position(|r| r.key.as_deref().map(key_norm).as_ref() == Some(&k));
            match (parents.get(&k).map(Vec::as_slice), earlier) {
                (Some([id]), _) => Ok(Parent::Id(*id)),
                (Some(ids), _) if ids.len() > 1 => Err(format!("Parent key \"{pk}\" matches several work items: {ids:?}.")),
                // An earlier row: its item if it matched one, else the item it creates.
                (_, Some(r)) => match (&rows[r].action, rows[r].work_item_id) {
                    (Action::Error(_), _) => Err(format!("Its parent (row {}) has an error.", r + 1)),
                    (_, Some(id)) => Ok(Parent::Id(id)),
                    _ => Ok(Parent::Row(r)),
                },
                _ => Err(format!("No work item has the key \"{pk}\".")),
            }
        } else {
            Ok(Parent::None)
        };
        let wanted_parent = match wanted_parent {
            Ok(p) => p,
            Err(e) => {
                rows.push(fail(plan, e));
                continue;
            }
        };
        let parent_view = match &wanted_parent {
            Parent::None => Value::Null,
            Parent::Id(id) => json!(id),
            Parent::Row(r) => json!(format!("row {}", r + 1)),
        };

        if let Some(existing) = found.into_iter().next() {
            let id = item_id(&existing);
            let ex_fields = existing.get("fields");
            let mut set_view = Map::new();
            let mut conflicts = Vec::new();
            let mut same = Vec::new();
            for (r, v) in &p.incoming {
                let have = ex_fields.and_then(|f| f.get(r));
                let name = fields::display_name(t, r);
                let (cmp, before, after, locked) = compare_field(r, have, v);
                let kind = match cmp { Cmp::Same => "same", Cmp::Fill => "fill", Cmp::Conflict => "conflict" };
                let write = locked.is_none() && (cmp == Cmp::Fill || (cmp == Cmp::Conflict && take_file(r)));
                let mut c = change(r, &name, kind, before.clone(), after.clone(), write);
                if let (Some(o), Some(why)) = (c.as_object_mut(), &locked) {
                    o.insert("locked".into(), json!(why));
                }
                plan.changes.push(c);
                match cmp {
                    Cmp::Conflict if locked.is_some() => conflicts.push(json!({ "field": name, "inBoards": short(&before), "inFile": short(&after), "note": locked })),
                    Cmp::Same => same.push(json!(name)),
                    Cmp::Fill => {
                        plan.set.insert(r.clone(), write_value(field_types, r, v));
                        set_view.insert(name, json!("fill (empty in Boards)"));
                    }
                    Cmp::Conflict if take_file(r) => {
                        plan.set.insert(r.clone(), write_value(field_types, r, v));
                        set_view.insert(name, json!("overwrite"));
                    }
                    Cmp::Conflict => conflicts.push(json!({ "field": name, "inBoards": short(&before), "inFile": short(&after) })),
                }
            }
            let have_parent = ex_fields.and_then(|f| f.get("System.Parent")).and_then(Value::as_i64);
            let parent_text = |p: &Value| match p { Value::Number(n) => format!("#{n}"), Value::String(s) => s.clone(), _ => String::new() };
            let have_text = have_parent.map(|h| format!("#{h}")).unwrap_or_default();
            match (&wanted_parent, have_parent) {
                (Parent::None, _) => {}
                (Parent::Id(want), Some(have)) if *want == have => {
                    same.push(json!("Parent"));
                    plan.changes.push(change("System.Parent", "Parent", "same", have_text.clone(), have_text, false));
                }
                (Parent::Id(_) | Parent::Row(_), None) => {
                    plan.set_parent = true;
                    set_view.insert("Parent".into(), json!("fill (no parent in Boards)"));
                    plan.changes.push(change("System.Parent", "Parent", "fill", String::new(), parent_text(&parent_view), true));
                }
                (_, Some(have)) if take_file("System.Parent") => {
                    plan.set_parent = true;
                    set_view.insert("Parent".into(), json!(format!("overwrite (was {have})")));
                    plan.changes.push(change("System.Parent", "Parent", "conflict", have_text, parent_text(&parent_view), true));
                }
                (_, Some(have)) => {
                    conflicts.push(json!({ "field": "Parent", "inBoards": have, "inFile": parent_view }));
                    plan.changes.push(change("System.Parent", "Parent", "conflict", have_text, parent_text(&parent_view), false));
                }
            }
            plan.parent = wanted_parent;
            plan.work_item_id = Some(id);
            plan.rev = existing.get("rev").and_then(Value::as_i64);
            plan.action = if plan.set.is_empty() && !plan.set_parent { Action::Skip } else { Action::Update };
            plan.view = json!({
                "row": i + 1, "key": row.key, "title": row.title,
                "action": if plan.action == Action::Skip { "skip" } else { "update" },
                "workItemId": id, "matchedBy": matched_by,
                "set": set_view, "unchanged": same, "conflicts": conflicts,
            });
        } else {
            if row.title.as_deref().map_or(true, |s| s.trim().is_empty()) {
                rows.push(fail(plan, "Not in Boards yet, and a new work item needs a title.".into()));
                continue;
            }
            for (r, v) in &p.incoming {
                plan.set.insert(r.clone(), write_value(field_types, r, v));
                plan.changes.push(change(r, &fields::display_name(t, r), "set", String::new(), shown_field(r, v), true));
            }
            if wanted_parent != Parent::None {
                let text = match &parent_view { Value::Number(n) => format!("#{n}"), Value::String(s) => s.clone(), _ => String::new() };
                plan.changes.push(change("System.Parent", "Parent", "set", String::new(), text, true));
            }
            plan.action = Action::Create;
            plan.set_parent = wanted_parent != Parent::None;
            plan.parent = wanted_parent;
            plan.view = json!({
                "row": i + 1, "key": row.key, "title": row.title, "action": "create", "type": t.name,
                "fields": p.incoming.iter().map(|(r, _)| fields::display_name(t, r)).collect::<Vec<_>>(),
                "parent": parent_view,
            });
        }
        rows.push(plan);
    }
    label_parents(client, &key_fields, req, &default_type, &mut rows).await?;
    // Links to requirements: only the ones not there yet are added; existing links are never removed.
    let linked_ids: Vec<i64> = rows.iter().filter(|r| !r.links.is_empty() && !matches!(r.action, Action::Error(_))).filter_map(|r| r.work_item_id).collect();
    let linked = if linked_ids.is_empty() { HashMap::new() } else { tested_by(client, &linked_ids).await? };
    for r in rows.iter_mut().filter(|r| !r.links.is_empty() && !matches!(r.action, Action::Error(_))) {
        let have: Vec<i64> = r.work_item_id.and_then(|id| linked.get(&id).cloned()).unwrap_or_default();
        let missing: Vec<i64> = r.links.iter().copied().filter(|id| !have.contains(id)).collect();
        let labels = |ids: &[i64]| ids.iter().map(|id| r.link_labels.get(id).cloned().unwrap_or_else(|| format!("#{id}"))).collect::<Vec<_>>().join(", ");
        let before = labels(&have);
        let after = labels(&[have.clone(), missing.clone()].concat());
        let added = labels(&missing);
        let kind = if missing.is_empty() { "same" } else if r.action == Action::Create { "set" } else { "add" };
        r.changes.push(change("Tests", "Tests", kind, before, after, !missing.is_empty()));
        if !missing.is_empty() && r.action != Action::Create {
            if r.action == Action::Skip {
                r.action = Action::Update;
                r.view["action"] = json!("update");
            }
            if let Some(o) = r.view.get_mut("set").and_then(Value::as_object_mut) {
                o.insert("Tests".into(), json!(format!("link {added}")));
            }
        }
        r.links = missing;
    }

    // A row with an error may stand for an item in Boards that it failed to match; that item must not look removed.
    let errors = rows.iter().filter(|r| matches!(r.action, Action::Error(_))).count();
    let removals_held = (req.remove_missing && errors > 0).then(|| format!("Items only in Boards are not listed while {errors} row(s) have errors: fix them and stage again."));
    if req.remove_missing && errors == 0 {
        let removals = missing(client, &project, &types, &prepared.iter().filter_map(|p| p.t.map(|t| (t, p.key_field.clone()))).collect::<Vec<_>>(), &rows, req.source.as_deref()).await?;
        rows.extend(removals);
    }
    Ok(Planned { project, rows, removals_held })
}

/// Items of the file's types that no row matched: offered for removal.
async fn missing(client: &AdoClient, project: &str, types: &[TypeInfo], in_file: &[(&TypeInfo, Option<String>)], rows: &[RowPlan], source: Option<&str>) -> AppResult<Vec<RowPlan>> {
    let matched: HashSet<i64> = rows.iter().filter_map(|r| r.work_item_id).collect();
    let mut seen_types: Vec<&str> = Vec::new();
    let mut out = Vec::new();
    for (t, key_field) in in_file {
        if seen_types.contains(&t.name.as_str()) {
            continue;
        }
        seen_types.push(&t.name);
        let ids: Vec<i64> = ids_where(client, project, &format!("[System.WorkItemType] = {}", wiql::quote(&t.name))).await?.into_iter().filter(|id| !matched.contains(id)).collect();
        let mut fetch: Vec<String> = ["System.Title", "System.State", "System.Tags"].iter().map(|s| s.to_string()).collect();
        fetch.extend(key_field.clone());
        let removed_state = types.iter().find(|x| x.name == t.name).and_then(|x| x.states.iter().find(|s| s.eq_ignore_ascii_case("Removed"))).cloned();
        for it in items(client, &ids, &fetch).await? {
            let id = item_id(&it);
            let key = key_field.as_ref().map(|k| field_str(&it, k)).filter(|k| !k.is_empty());
            let title = field_str(&it, "System.Title");
            let state = field_str(&it, "System.State");
            let tags = it.get("fields").and_then(|f| f.get("System.Tags")).and_then(Value::as_str).unwrap_or("").to_string();
            let mut set = Map::new();
            let mut changes = Vec::new();
            if let Some(removed) = &removed_state {
                set.insert("System.State".into(), json!(removed));
                changes.push(change("System.State", "State", "set", state.clone(), removed.clone(), true));
            }
            let tagged = add_tag(&tags, REMOVED_TAG);
            set.insert("System.Tags".into(), json!(tagged));
            changes.push(change("System.Tags", "Tags", "set", tags, tagged, true));
            let note = removed_state.is_none().then(|| format!("\"{}\" has no Removed state, so it is only tagged.", t.name));
            out.push(RowPlan {
                row_key: format!("w{id}"),
                type_name: t.name.clone(),
                action: Action::Remove,
                work_item_id: Some(id),
                set,
                parent: Parent::None,
                set_parent: false,
                view: json!({ "key": key, "title": title, "action": "remove", "workItemId": id, "state": state, "note": note }),
                rev: it.get("rev").and_then(Value::as_i64),
                changes,
                comment: Some(format!("Not in {}, so a Boards import marked it as removed.", source.unwrap_or("the imported file"))),
                links: Vec::new(),
                link_labels: HashMap::new(),
            });
        }
    }
    Ok(out)
}

fn summarize(rows: &[RowPlan]) -> Value {
    let count = |f: &dyn Fn(&RowPlan) -> bool| rows.iter().filter(|r| f(r)).count();
    json!({
        "create": count(&|r| r.action == Action::Create),
        "update": count(&|r| r.action == Action::Update),
        "skip": count(&|r| r.action == Action::Skip),
        "remove": count(&|r| r.action == Action::Remove),
        "error": count(&|r| matches!(r.action, Action::Error(_))),
        "rowsWithConflicts": count(&|r| r.view.get("conflicts").and_then(Value::as_array).is_some_and(|c| !c.is_empty())),
    })
}

// ----- stored plans -----

struct Stored {
    request: SyncRequest,
    current_project: Option<String>,
    views: Vec<Value>,
}

static PLANS: Mutex<Vec<(String, Stored)>> = Mutex::new(Vec::new());

fn plan_id(views: &[Value]) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut h = DefaultHasher::new();
    serde_json::to_string(views).unwrap_or_default().hash(&mut h);
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0).hash(&mut h);
    format!("plan-{:012x}", h.finish() & 0xffff_ffff_ffff)
}

fn store(request: SyncRequest, current_project: Option<String>, views: Vec<Value>) -> String {
    let id = plan_id(&views);
    if let Ok(mut plans) = PLANS.lock() {
        plans.push((id.clone(), Stored { request, current_project, views }));
        let excess = plans.len().saturating_sub(20);
        plans.drain(..excess);
    }
    id
}

fn plan_json(id: &str, planned: &Planned, views: &[Value]) -> Value {
    json!({
        "planId": id,
        "project": planned.project,
        "summary": summarize(&planned.rows),
        "removalsHeld": planned.removals_held,
        "rows": views,
        "next": "Show this plan to the user. Only if they agree, call apply_work_item_sync with this planId. Conflicts are left as they are unless planned again with overwrite: true.",
    })
}

pub async fn plan(client: &AdoClient, field_types: &FieldMap, args: &Value, current_project: Option<String>) -> AppResult<Value> {
    let req: SyncRequest = serde_json::from_value(args.clone()).map_err(|e| AppError::validation(format!("Bad input: {e}")))?;
    let planned = build(client, field_types, &req, current_project.clone()).await?;
    let views: Vec<Value> = planned.rows.iter().map(|r| r.view.clone()).collect();
    let id = store(req, current_project, views.clone());
    Ok(plan_json(&id, &planned, &views))
}

/// Runs a stored plan, after checking Boards still looks the way it did when it was planned.
pub async fn apply(client: &AdoClient, field_types: &FieldMap, plan_id: &str, on_change: &(dyn Fn(i64) + Sync)) -> AppResult<Value> {
    let (request, current_project, views) = {
        let plans = PLANS.lock().map_err(|_| AppError::internal("Plans are unavailable."))?;
        let s = &plans.iter().find(|(id, _)| id == plan_id).ok_or_else(|| AppError::validation("Unknown or expired planId. Call plan_work_item_sync again."))?.1;
        (s.request.clone(), s.current_project.clone(), s.views.clone())
    };
    let planned = build(client, field_types, &request, current_project.clone()).await?;
    let fresh: Vec<Value> = planned.rows.iter().map(|r| r.view.clone()).collect();
    if fresh != views {
        let id = store(request, current_project, fresh.clone());
        return Err(AppError::validation(format!(
            "Boards changed since that plan, so nothing was written. New plan (show it to the user again):\n{}",
            serde_json::to_string_pretty(&plan_json(&id, &planned, &fresh)).unwrap_or_default()
        )));
    }
    let results = execute(client, &planned, &|_| Pick::Do, on_change).await;
    let failed = results.iter().filter(|r| r["ok"] == false).count();
    Ok(json!({ "project": planned.project, "summary": summarize(&planned.rows), "failedRows": failed, "results": results }))
}

// ----- staged imports: review in the app -----

/// Plans `req` and returns its summary and the rows as the review screen shows them.
pub async fn review(client: &AdoClient, field_types: &FieldMap, req: &SyncRequest, current_project: Option<String>) -> AppResult<Value> {
    let planned = build(client, field_types, req, current_project).await?;
    Ok(json!({ "project": planned.project, "summary": summarize(&planned.rows), "removalsHeld": planned.removals_held, "rows": planned.rows.iter().map(review_row).collect::<Vec<_>>() }))
}

/// What the row is for the reviewer: new, changed, conflict, same, missing (only in Boards) or error.
fn category(r: &RowPlan) -> &'static str {
    match &r.action {
        Action::Error(_) => "error",
        Action::Create => "new",
        Action::Remove => "missing",
        _ if r.changes.iter().any(|c| c["kind"] == "conflict") => "conflict",
        Action::Update => "changed",
        Action::Skip => "same",
    }
}

/// Identifies the row's state in Boards: if it differs at apply time, the user reviewed something else.
fn fingerprint(r: &RowPlan) -> String {
    match (&r.action, r.work_item_id) {
        (Action::Remove, Some(id)) => format!("rm:{id}:{}", r.rev.unwrap_or(0)),
        (_, Some(id)) => format!("{id}:{}", r.rev.unwrap_or(0)),
        (Action::Error(e), None) => format!("error:{e}"),
        (_, None) => "new".into(),
    }
}

fn review_row(r: &RowPlan) -> Value {
    let v = &r.view;
    json!({
        "rowKey": r.row_key,
        "fp": fingerprint(r),
        "category": category(r),
        "type": r.type_name,
        "key": v.get("key"),
        "title": v.get("title"),
        "workItemId": r.work_item_id,
        "matchedBy": v.get("matchedBy"),
        "parent": v.get("parent"),
        "parentRow": match r.parent { Parent::Row(i) => json!(format!("r{i}")), _ => Value::Null },
        "error": match &r.action { Action::Error(e) => json!(e), _ => Value::Null },
        "note": v.get("note"),
        "changes": r.changes,
    })
}

/// Applies the rows the user picked (row key → the fingerprint they reviewed); the rest are left alone.
pub async fn apply_picked(client: &AdoClient, field_types: &FieldMap, req: &SyncRequest, current_project: Option<String>, picked: &HashMap<String, String>, on_change: &(dyn Fn(i64) + Sync)) -> AppResult<Value> {
    let planned = build(client, field_types, req, current_project).await?;
    let pick = |r: &RowPlan| match picked.get(&r.row_key) {
        None => Pick::No,
        Some(fp) if *fp == fingerprint(r) => Pick::Do,
        Some(_) => Pick::Stale,
    };
    let results = execute(client, &planned, &pick, on_change).await;
    let count = |k: &str, v: Value| results.iter().filter(|r| r.get(k) == Some(&v)).count();
    Ok(json!({
        "project": planned.project,
        "done": results.iter().filter(|r| r["ok"] == true && r.get("skipped").is_none()).count(),
        "failed": count("ok", json!(false)),
        "notPicked": count("skipped", json!("not picked")),
        "unchanged": count("skipped", json!("nothing to change")),
        "results": results,
    }))
}

enum Pick {
    Do,
    No,
    /// Changed in Boards after the review.
    Stale,
}

async fn execute(client: &AdoClient, planned: &Planned, pick: &(dyn Fn(&RowPlan) -> Pick + Sync), on_change: &(dyn Fn(i64) + Sync)) -> Vec<Value> {
    let mut created: HashMap<usize, i64> = HashMap::new();
    let mut results = Vec::new();
    for (i, row) in planned.rows.iter().enumerate() {
        let action = row.view.get("action").cloned().unwrap_or(Value::Null);
        let base = json!({ "rowKey": row.row_key, "row": row.view.get("row"), "key": row.view.get("key"), "title": row.view.get("title"), "action": action, "workItemId": row.work_item_id });
        let with = |extra: Value| {
            let mut b = base.clone();
            if let (Some(o), Some(e)) = (b.as_object_mut(), extra.as_object()) {
                o.extend(e.clone());
            }
            b
        };
        match pick(row) {
            Pick::No => {
                results.push(with(json!({ "ok": true, "skipped": "not picked" })));
                continue;
            }
            Pick::Stale => {
                results.push(with(json!({ "ok": false, "error": "Changed in Boards after the review, so it was left alone. Review it again." })));
                continue;
            }
            Pick::Do => {}
        }
        let parent = match row.parent {
            Parent::None => None,
            Parent::Id(id) => Some(id),
            Parent::Row(r) => match created.get(&r) {
                Some(id) => Some(*id),
                None if row.set_parent => {
                    results.push(with(json!({ "ok": false, "error": format!("Its parent (row {}) was not created, so this row was left alone.", r + 1) })));
                    continue;
                }
                None => None,
            },
        };
        if row.action == Action::Skip {
            results.push(with(json!({ "ok": true, "skipped": "nothing to change" })));
            continue;
        }
        let mut note: Option<String> = None;
        let outcome: AppResult<Option<i64>> = match &row.action {
            Action::Skip | Action::Error(_) => Ok(row.work_item_id),
            Action::Create => api::create_work_item(client, &planned.project, &row.type_name, &row.set, if row.set_parent { parent } else { None })
                .await
                .map(|v| v.get("id").and_then(Value::as_i64)),
            Action::Update | Action::Remove => {
                let id = row.work_item_id.unwrap_or(0);
                let mut r = Ok(Some(id));
                if !row.set.is_empty() {
                    r = api::update_work_item(client, &planned.project, id, row.rev, &row.set).await.map(|_| Some(id));
                    // Some processes refuse the move to Removed: still tag it, and say so.
                    if let (Err(e), Action::Remove, true) = (&r, &row.action, row.set.contains_key("System.State")) {
                        let mut tags_only = row.set.clone();
                        tags_only.remove("System.State");
                        let first = e.message.clone();
                        r = api::update_work_item(client, &planned.project, id, row.rev, &tags_only).await.map(|_| Some(id));
                        if r.is_ok() {
                            note = Some(format!("Tagged only; the state change was refused: {first}"));
                        }
                    }
                }
                if r.is_ok() && row.set_parent {
                    if let Err(e) = api::set_parent(client, &planned.project, id, parent).await {
                        // The fields are already written; only the parent is missing.
                        r = Err(AppError::new(e.kind, format!("Fields were written, but setting the parent failed: {}", e.message)));
                    }
                }
                if let (Ok(_), Some(text)) = (&r, &row.comment) {
                    // The change is made either way; a failed note is not worth failing the row for.
                    let _ = api::add_comment(client, &planned.project, id, &text_to_html(text)).await;
                }
                r
            }
        };
        // Then the requirements it tests.
        let outcome = match (outcome, row.links.is_empty()) {
            (Ok(Some(id)), false) if matches!(row.action, Action::Create | Action::Update) => {
                let mut failed = Vec::new();
                for t in &row.links {
                    if let Err(e) = api::add_link(client, &planned.project, id, *t, TESTS_REL).await {
                        failed.push(format!("#{t}: {}", e.message));
                    }
                }
                if row.action == Action::Create {
                    created.insert(i, id);
                }
                if failed.is_empty() { Ok(Some(id)) } else { Err(AppError::validation(format!("Saved as #{id}, but linking failed for {}", failed.join("; ")))) }
            }
            (o, _) => o,
        };
        match outcome {
            Ok(id) => {
                if let Some(id) = id {
                    if row.action == Action::Create {
                        created.insert(i, id);
                    }
                    if matches!(row.action, Action::Create | Action::Update | Action::Remove) {
                        on_change(id);
                    }
                }
                match &row.action {
                    Action::Error(e) => results.push(with(json!({ "ok": false, "error": e }))),
                    _ => results.push(with(json!({ "ok": true, "workItemId": id, "note": note }))),
                }
            }
            Err(e) => results.push(with(json!({ "ok": false, "error": e.message }))),
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parents_are_named_in_full() {
        assert_eq!(describe("Feature", Some(3700), Some("DI-12"), "Export reports"), "Feature #3700: DI-12 Export reports");
        assert_eq!(describe("Epic", Some(3600), None, ""), "Epic #3600");
        let req: SyncRequest = serde_json::from_value(json!({ "items": [
            { "key": "UN-3", "title": "Clinicians share reports", "type": "Epic" },
            { "title": "Export reports", "type": "Feature", "parentKey": "UN-3" },
        ] }))
        .unwrap();
        assert_eq!(row_label(&req, "Requirement", "row 1").as_deref(), Some("New Epic: UN-3 Clinicians share reports"));
        assert_eq!(row_label(&req, "Requirement", "row 3"), None);
        assert_eq!(row_label(&req, "Requirement", "#3700"), None);
    }

    #[test]
    fn key_fields_are_named_per_type() {
        let req: SyncRequest = serde_json::from_value(json!({
            "type": "Requirement", "keyField": "SRS ID",
            "keyFields": { "epic": "User Need ID", "Feature": " " }, "items": []
        }))
        .unwrap();
        assert_eq!(named_key_field(&req, "Requirement", "Requirement"), Some("SRS ID"));
        assert_eq!(named_key_field(&req, "Requirement", "Epic"), Some("User Need ID"));
        // A blank name falls back to the detected field; keyField is only for the default type.
        assert_eq!(named_key_field(&req, "Requirement", "Feature"), None);
        assert_eq!(named_key_field(&req, "Requirement", "Test Case"), None);
        assert!(serde_json::to_value(&req).unwrap()["keyFields"].is_object());
    }

    #[test]
    fn compare_fills_empty_and_flags_differences() {
        assert_eq!(compare(None, &json!("New")), Cmp::Fill);
        assert_eq!(compare(Some(&json!("")), &json!("New")), Cmp::Fill);
        assert_eq!(compare(Some(&json!("<p>Same  text</p>")), &json!("Same text")), Cmp::Same);
        assert_eq!(compare(Some(&json!("Old")), &json!("New")), Cmp::Conflict);
        assert_eq!(compare(Some(&json!("Old")), &json!("")), Cmp::Same);
        assert_eq!(compare(Some(&json!(3)), &json!(3)), Cmp::Same);
    }

    #[test]
    fn rich_text_fields_are_written_as_html() {
        let mut types = FieldMap::new();
        types.insert("Microsoft.VSTS.Common.AcceptanceCriteria".into(), "html".into());
        types.insert("Custom.SRSID".into(), "string".into());
        assert_eq!(write_value(&types, "Microsoft.VSTS.Common.AcceptanceCriteria", &json!("a\nb")), json!("<p>a<br>b</p>"));
        assert_eq!(write_value(&types, "Custom.SRSID", &json!("SRS-1")), json!("SRS-1"));
    }

    #[test]
    fn requests_parse_from_tool_arguments() {
        let r: SyncRequest = serde_json::from_value(json!({
            "items": [{ "key": "SRS-1", "title": "T", "fields": { "Acceptance Criteria": "x" }, "parentKey": "DI-1" }],
            "overwrite": true,
        }))
        .unwrap();
        assert!(r.overwrite);
        assert_eq!(r.items[0].parent_key.as_deref(), Some("DI-1"));
        assert_eq!(r.items[0].fields["Acceptance Criteria"], "x");
    }

    fn row(action: Action, id: Option<i64>, rev: Option<i64>, kinds: &[&str]) -> RowPlan {
        RowPlan {
            row_key: "r0".into(), type_name: "Requirement".into(), action, work_item_id: id, set: Map::new(), parent: Parent::None,
            set_parent: false, view: json!({}), rev, changes: kinds.iter().map(|k| json!({ "kind": k })).collect(), comment: None, links: Vec::new(), link_labels: HashMap::new(),
        }
    }

    #[test]
    fn rows_are_grouped_for_review() {
        assert_eq!(category(&row(Action::Create, None, None, &["set"])), "new");
        assert_eq!(category(&row(Action::Update, Some(1), Some(3), &["fill", "same"])), "changed");
        assert_eq!(category(&row(Action::Skip, Some(1), Some(3), &["conflict"])), "conflict");
        assert_eq!(category(&row(Action::Update, Some(1), Some(3), &["fill", "conflict"])), "conflict");
        assert_eq!(category(&row(Action::Skip, Some(1), Some(3), &["same"])), "same");
        assert_eq!(category(&row(Action::Remove, Some(1), Some(3), &[])), "missing");
        assert_eq!(category(&row(Action::Error("x".into()), None, None, &[])), "error");
    }

    #[test]
    fn fingerprints_change_with_the_item_not_the_choices() {
        // Taking the file's side of a conflict turns a skip into an update; the item is still the one reviewed.
        assert_eq!(fingerprint(&row(Action::Skip, Some(7), Some(3), &[])), fingerprint(&row(Action::Update, Some(7), Some(3), &[])));
        assert_ne!(fingerprint(&row(Action::Update, Some(7), Some(3), &[])), fingerprint(&row(Action::Update, Some(7), Some(4), &[])));
        assert_ne!(fingerprint(&row(Action::Create, None, None, &[])), fingerprint(&row(Action::Update, Some(7), Some(1), &[])));
    }

    #[test]
    fn tags_are_added_once() {
        assert_eq!(add_tag("", REMOVED_TAG), "Removed by import");
        assert_eq!(add_tag("a; b", "c"), "a; b; c");
        assert_eq!(add_tag("a; removed by import", REMOVED_TAG), "a; removed by import");
    }

    #[test]
    fn edits_replace_the_files_text_but_not_the_key() {
        let mut incoming = vec![
            ("System.Title".to_string(), json!("Old title")),
            ("Custom.SRSID".to_string(), json!("SRS-1")),
            (STEPS_FIELD.to_string(), json!([{ "action": "Open", "expected": "" }])),
        ];
        let edits = json!({ "System.Title": "New title", "Custom.SRSID": "SRS-9", "Custom.NotInFile": "x", STEPS_FIELD: "1. Open\n   Expected: It opens" });
        apply_edits(&mut incoming, edits.as_object().unwrap(), Some("Custom.SRSID"));
        assert_eq!(incoming[0].1, json!("New title"));
        assert_eq!(incoming[1].1, json!("SRS-1"));
        assert_eq!(steps::from_input(&incoming[2].1).unwrap(), vec![steps::Step::Step { action: "Open".into(), expected: "It opens".into() }]);
        assert_eq!(incoming.len(), 3);
    }

    #[test]
    fn removal_flag_and_source_parse() {
        let r: SyncRequest = serde_json::from_value(json!({ "items": [], "removeMissing": true, "source": "docs/SRS.md" })).unwrap();
        assert!(r.remove_missing && r.take_file.is_empty());
        assert_eq!(r.source.as_deref(), Some("docs/SRS.md"));
        // Stored with the import and read back.
        let back: SyncRequest = serde_json::from_value(serde_json::to_value(&r).unwrap()).unwrap();
        assert!(back.remove_missing);
    }

    #[test]
    fn steps_compare_as_lists_and_keep_shared_steps() {
        let xml = steps::to_xml(&[steps::Step::Step { action: "Open".into(), expected: "Opens".into() }]);
        let have = json!(xml);
        let same = compare_field(STEPS_FIELD, Some(&have), &json!([{ "action": "Open", "expected": "Opens" }]));
        assert_eq!(same.0, Cmp::Same);
        let fill = compare_field(STEPS_FIELD, None, &json!("1. Open => Opens"));
        assert_eq!((fill.0, fill.2.as_str()), (Cmp::Fill, "1. Open\n   Expected: Opens"));
        let differs = compare_field(STEPS_FIELD, Some(&have), &json!([{ "action": "Open the app", "expected": "Opens" }]));
        assert_eq!(differs.0, Cmp::Conflict);
        assert!(differs.3.is_none());
        let shared = json!(r#"<steps id="0" last="2"><compref id="2" ref="9" /></steps>"#);
        assert!(compare_field(STEPS_FIELD, Some(&shared), &json!("1. Open")).3.is_some());
        assert!(write_value(&FieldMap::new(), STEPS_FIELD, &json!([{ "action": "Open", "expected": "" }])).as_str().unwrap().starts_with("<steps "));
    }

    #[test]
    fn test_cases_parse_steps_and_tests() {
        let r: SyncRequest = serde_json::from_value(json!({ "type": "Test Case", "items": [{ "title": "Export PDF", "steps": [{ "action": "Open", "expected": "Opens" }], "tests": ["SRS-0012", "#3741"] }] })).unwrap();
        assert_eq!(r.items[0].tests, vec!["SRS-0012", "#3741"]);
        assert_eq!(id_ref("#3741"), Some(3741));
        assert_eq!(id_ref("SRS-0012"), None);
    }
}
