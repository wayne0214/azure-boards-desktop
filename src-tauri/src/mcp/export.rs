//! `export_work_items`: many work items with their full text in one call (e.g. the whole SRS),
//! as markdown or JSON. Children follow their parent; long exports come in pages that fit an AI
//! tool's output limit, continued with `offset`.

use super::fields::{self, TypeInfo};
use super::steps::{self, STEPS_FIELD, TESTS_REL};
use super::tools::{field, item_url, plain, query, str_arg, str_list, Found};
use crate::ado::client::AdoClient;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// About 15k tokens: under Claude Code's default limit for one tool result.
const PAGE_CHARS: usize = 60_000;
const FETCH_CHUNK: usize = 50;

pub fn definition_props(id_schema: &Value) -> Value {
    json!({
        "project": { "type": "string", "description": "Project name; omit for the current project" },
        "types": { "type": "array", "items": { "type": "string" }, "description": "e.g. [\"Requirement\"]" },
        "states": { "type": "array", "items": { "type": "string" }, "description": "Only these states; default all but Removed" },
        "text": { "type": "string", "description": "Words in the title or an ID field" },
        "key": { "type": "string", "description": "Exact value of an ID field, e.g. SRS-182" },
        "iteration": { "type": "string", "description": "\"current\" for the team's current sprint, or an iteration path" },
        "changedSince": { "type": "string", "description": "YYYY-MM-DD" },
        "ids": { "type": "array", "items": id_schema, "description": "These work items instead of a search" },
        "fields": { "type": "array", "items": { "type": "string" }, "description": "Only these fields (display or reference names); default every filled-in field" },
        "format": { "type": "string", "enum": ["markdown", "json"], "description": "Default markdown" },
        "limit": { "type": "integer", "description": "Most items to look at; default 500, at most 1000" },
        "offset": { "type": "integer", "description": "Continue a long export: the nextOffset of the previous page" },
    })
}

// ----- choosing what to show -----

/// Fields that describe the record rather than the requirement.
fn is_bookkeeping(reference: &str) -> bool {
    (reference.starts_with("System.") && !matches!(reference, "System.Description" | "System.Tags"))
        || reference.starts_with("WEF_")
        || reference.ends_with("Date")
        || reference.ends_with("By")
        || matches!(reference, "Microsoft.VSTS.Common.StackRank" | "Microsoft.VSTS.Common.BacklogPriority")
}

fn field_text(reference: &str, v: &Value) -> String {
    if reference == STEPS_FIELD {
        return steps::to_text(&steps::parse(v.as_str().unwrap_or("")));
    }
    text_of(v)
}

fn text_of(v: &Value) -> String {
    match plain(v) {
        Value::String(s) => s.trim().to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Multi-line or long values get a section of their own; the rest go in a short list.
fn is_long(s: &str) -> bool {
    s.contains('\n') || s.chars().count() > 80
}

#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub id: i64,
    pub parent: Option<i64>,
    pub key: Option<String>,
    pub title: String,
    pub type_name: String,
    pub state: String,
    pub url: String,
    /// Display name and text, in the order they should appear.
    pub fields: Vec<(String, String)>,
}

/// IDs of the requirements an item tests (Tested By links).
fn tested(item: &Value) -> Vec<i64> {
    item.get("relations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|r| r.get("rel").and_then(Value::as_str) == Some(TESTS_REL))
        .filter_map(|r| r.get("url").and_then(Value::as_str).and_then(|u| u.rsplit('/').next()).and_then(|x| x.parse().ok()))
        .collect()
}

fn row(org: &str, item: &Value, t: Option<&TypeInfo>, key: Option<(String, String)>, wanted: &[String], tests: Option<String>) -> Row {
    let s = |name: &str| field(item, name).map(text_of).unwrap_or_default();
    let name = |reference: &str| t.map(|t| fields::display_name(t, reference)).unwrap_or_else(|| reference.to_string());
    let key_field = key.as_ref().map(|k| k.0.clone());
    let all = item.get("fields").and_then(Value::as_object).cloned().unwrap_or_default();
    let mut out: Vec<(String, String)> = Vec::new();
    if wanted.is_empty() {
        for (reference, v) in &all {
            if is_bookkeeping(reference) || Some(reference) == key_field.as_ref() {
                continue;
            }
            let text = field_text(reference, v);
            if !text.is_empty() {
                out.push((name(reference), text));
            }
        }
        if let Some(t) = tests {
            out.push(("Tests".into(), t));
        }
        // Description first, then the others by name; short values before long ones.
        out.sort_by(|a, b| (b.0 == "Description").cmp(&(a.0 == "Description")).then(is_long(&a.1).cmp(&is_long(&b.1))).then(a.0.cmp(&b.0)));
    } else {
        for w in wanted {
            let reference = t.and_then(|t| fields::resolve_field(t, w)).unwrap_or_else(|| w.clone());
            if reference.eq_ignore_ascii_case("tests") {
                out.push(("Tests".into(), tests.clone().unwrap_or_default()));
                continue;
            }
            let text = all.get(&reference).map(|v| field_text(&reference, v)).unwrap_or_default();
            out.push((name(&reference), text));
        }
    }
    Row {
        id: item.get("id").and_then(Value::as_i64).unwrap_or(0),
        parent: field(item, "System.Parent").and_then(Value::as_i64),
        key: key.map(|k| k.1),
        title: s("System.Title"),
        type_name: s("System.WorkItemType"),
        state: s("System.State"),
        url: item_url(org, item),
        fields: out,
    }
}

// ----- order and rendering -----

/// IDs with each item's children right after it (depth-first), keeping the given order among siblings.
/// Items whose parent is not exported stay at the top level. Returns (id, depth).
pub fn tree_order(ids: &[i64], parent_of: &HashMap<i64, i64>) -> Vec<(i64, usize)> {
    let present: HashSet<i64> = ids.iter().copied().collect();
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut roots = Vec::new();
    for &id in ids {
        match parent_of.get(&id).filter(|p| present.contains(p) && **p != id) {
            Some(p) => children.entry(*p).or_default().push(id),
            None => roots.push(id),
        }
    }
    let mut out = Vec::with_capacity(ids.len());
    let mut seen = HashSet::new();
    fn walk(id: i64, depth: usize, children: &HashMap<i64, Vec<i64>>, seen: &mut HashSet<i64>, out: &mut Vec<(i64, usize)>) {
        if !seen.insert(id) {
            return;
        }
        out.push((id, depth));
        for &c in children.get(&id).map(Vec::as_slice).unwrap_or(&[]) {
            walk(c, depth + 1, children, seen, out);
        }
    }
    for r in roots {
        walk(r, 0, &children, &mut seen, &mut out);
    }
    // A parent loop leaves items unreached: add them at the top level.
    for &id in ids {
        walk(id, 0, &children, &mut seen, &mut out);
    }
    out
}

pub fn markdown(row: &Row, depth: usize) -> String {
    let hashes = "#".repeat((depth + 2).min(4));
    let heading = match &row.key {
        Some(k) => format!("{hashes} {k} · {}", row.title),
        None => format!("{hashes} {}", row.title),
    };
    let mut meta = vec![row.type_name.clone(), row.state.clone(), format!("[#{}]({})", row.id, row.url)];
    if let Some(p) = row.parent {
        meta.push(format!("parent #{p}"));
    }
    meta.retain(|m| !m.is_empty());
    let mut out = format!("{heading}\n\n{}\n", meta.join(" · "));
    let (short, long): (Vec<_>, Vec<_>) = row.fields.iter().partition(|(_, v)| !is_long(v));
    if !short.is_empty() {
        out.push('\n');
        for (name, v) in short {
            out.push_str(&format!("- **{name}:** {}\n", if v.is_empty() { "—" } else { v }));
        }
    }
    for (name, v) in long {
        out.push_str(&format!("\n**{name}**\n\n{v}\n"));
    }
    out
}

fn as_json(row: &Row, depth: usize) -> Value {
    let mut fields = Map::new();
    for (name, v) in &row.fields {
        fields.insert(name.clone(), json!(v));
    }
    json!({
        "id": row.id, "key": row.key, "title": row.title, "type": row.type_name, "state": row.state,
        "parent": row.parent, "depth": depth, "url": row.url, "fields": fields,
    })
}

// ----- fetching -----

/// Full items (every field, plus relations) through the batch API, in the order of `ids`.
async fn full_items(client: &AdoClient, ids: &[i64]) -> AppResult<Vec<Value>> {
    let mut out = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(200) {
        let res: Value = client.post_json(&client.url("/_apis/wit/workitemsbatch"), &json!({ "ids": chunk, "$expand": "Relations", "errorPolicy": "Omit" })).await?;
        out.extend(res.get("value").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter(|v| !v.is_null()));
    }
    let pos: HashMap<i64, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
    out.sort_by_key(|it| it.get("id").and_then(Value::as_i64).and_then(|id| pos.get(&id).copied()).unwrap_or(usize::MAX));
    Ok(out)
}

async fn parents(client: &AdoClient, ids: &[i64]) -> AppResult<HashMap<i64, i64>> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(200) {
        let res: Value = client.post_json(&client.url("/_apis/wit/workitemsbatch"), &json!({ "ids": chunk, "fields": ["System.Parent"], "errorPolicy": "Omit" })).await?;
        for it in res.get("value").and_then(Value::as_array).into_iter().flatten() {
            if let (Some(id), Some(p)) = (it.get("id").and_then(Value::as_i64), field(it, "System.Parent").and_then(Value::as_i64)) {
                out.insert(id, p);
            }
        }
    }
    Ok(out)
}

pub async fn export(org: &str, client: &AdoClient, state: &AppState, ctx: &Value, args: &Value) -> AppResult<Value> {
    let given: Vec<i64> = args.get("ids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
    let found = if given.is_empty() {
        query(client, state, ctx, args, "[System.Id]", (500, 1000)).await?
    } else {
        if given.len() > 1000 {
            return Err(AppError::validation("At most 1000 ids per export."));
        }
        let project = str_arg(args, "project").or_else(|| ctx.get("project").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
        let ptypes = if project.is_empty() { Vec::new() } else { fields::project_types(client, &project).await? };
        let key_fields = fields::all_key_fields(&ptypes);
        Found { project, limit: u32::MAX, ids: given, ptypes, key_fields, available: Default::default(), wanted_key: None }
    };
    let truncated = found.ids.len() as u32 >= found.limit;
    let wanted = str_list(args, "fields");
    let markdown_out = str_arg(args, "format").map_or(true, |f| !f.eq_ignore_ascii_case("json"));
    let order = tree_order(&found.ids, &parents(client, &found.ids).await?);
    let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    if offset > order.len() {
        return Err(AppError::validation(format!("offset {offset} is past the end ({} items).", order.len())));
    }

    // Fetch a chunk at a time until the page is full.
    let mut md = String::new();
    let mut rows = Vec::new();
    let mut used = 0usize;
    // Deleted, or not visible to this account.
    let mut omitted = 0usize;
    let mut next = offset;
    'pages: for chunk in order[offset..].chunks(FETCH_CHUNK) {
        let ids: Vec<i64> = chunk.iter().map(|(id, _)| *id).collect();
        let items = full_items(client, &ids).await?;
        let by_id: HashMap<i64, &Value> = items.iter().filter_map(|it| it.get("id").and_then(Value::as_i64).map(|id| (id, it))).collect();
        // Requirements these items test, named by key.
        let targets: Vec<i64> = items.iter().flat_map(tested).collect::<HashSet<_>>().into_iter().collect();
        let mut label: HashMap<i64, String> = HashMap::new();
        if !targets.is_empty() {
            let mut want = found.key_fields.clone();
            want.push("System.WorkItemType".into());
            for part in targets.chunks(200) {
                let res: Value = client.post_json(&client.url("/_apis/wit/workitemsbatch"), &json!({ "ids": part, "fields": want, "errorPolicy": "Omit" })).await?;
                for t in res.get("value").and_then(Value::as_array).into_iter().flatten() {
                    let id = t.get("id").and_then(Value::as_i64).unwrap_or(0);
                    label.insert(id, found.key_of(t).map(|k| format!("{} (#{id})", k.1)).unwrap_or_else(|| format!("#{id}")));
                }
            }
        }
        for (id, depth) in chunk {
            let Some(it) = by_id.get(id) else {
                omitted += 1;
                next += 1;
                continue;
            };
            if !found.keeps(it) {
                next += 1;
                continue;
            }
            let t = field(it, "System.WorkItemType").and_then(Value::as_str).and_then(|n| found.ptypes.iter().find(|p| p.name == n));
            let tests = tested(it);
            let tests = (!tests.is_empty()).then(|| tests.iter().map(|id| label.get(id).cloned().unwrap_or_else(|| format!("#{id}"))).collect::<Vec<_>>().join(", "));
            let r = row(org, it, t, found.key_of(it), &wanted, tests);
            let j = as_json(&r, *depth);
            let piece = if markdown_out { markdown(&r, *depth) } else { j.to_string() };
            if used > 0 && used + piece.len() > PAGE_CHARS {
                break 'pages;
            }
            used += piece.len();
            if markdown_out {
                if !md.is_empty() {
                    md.push('\n');
                }
                md.push_str(&piece);
            } else {
                rows.push(j);
            }
            next += 1;
        }
    }
    let more = next < order.len();
    let mut out = json!({
        "project": found.project,
        "total": order.len(),
        "from": offset,
        "nextOffset": if more { json!(next) } else { Value::Null },
        "truncated": truncated,
        "omitted": omitted,
        "note": if more { format!("Page ends at item {next} of {}; call again with offset {next} for the rest. Items created or moved in Boards meanwhile can shift between pages.", order.len()) } else { "Complete.".into() },
    });
    if let Some(o) = out.as_object_mut() {
        if markdown_out {
            o.insert("markdown".into(), json!(md));
        } else {
            o.insert("items".into(), json!(rows));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(id: i64, parent: Option<i64>, fields: Vec<(&str, &str)>) -> Row {
        Row {
            id,
            parent,
            key: Some(format!("SRS-{id}")),
            title: format!("Item {id}"),
            type_name: "Requirement".into(),
            state: "Active".into(),
            url: format!("https://x/{id}"),
            fields: fields.into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
        }
    }

    #[test]
    fn children_follow_their_parent() {
        let parents: HashMap<i64, i64> = [(3, 1), (4, 3), (2, 99), (5, 5)].into_iter().collect();
        assert_eq!(tree_order(&[1, 2, 3, 4, 5], &parents), vec![(1, 0), (3, 1), (4, 2), (2, 0), (5, 0)]);
        // A loop between two items still lists both.
        let looped: HashMap<i64, i64> = [(1, 2), (2, 1)].into_iter().collect();
        assert_eq!(tree_order(&[1, 2], &looped).len(), 2);
    }

    #[test]
    fn markdown_puts_long_text_in_sections() {
        let md = markdown(&r(7, Some(3), vec![("Risk Level", "Low"), ("Acceptance Criteria", "Given a user\nWhen they sign in")]), 1);
        assert!(md.starts_with("### SRS-7 · Item 7\n\nRequirement · Active · [#7](https://x/7) · parent #3\n"));
        assert!(md.contains("\n- **Risk Level:** Low\n"));
        assert!(md.contains("\n**Acceptance Criteria**\n\nGiven a user\nWhen they sign in\n"));
        assert!(markdown(&r(1, None, vec![]), 5).starts_with("#### "));
    }

    #[test]
    fn bookkeeping_fields_are_left_out() {
        assert!(is_bookkeeping("System.ChangedDate") && is_bookkeeping("System.AreaPath") && is_bookkeeping("Microsoft.VSTS.Common.ClosedBy"));
        assert!(!is_bookkeeping("System.Description") && !is_bookkeeping("Custom.SRSID") && !is_bookkeeping("Microsoft.VSTS.Common.AcceptanceCriteria"));
    }
}
