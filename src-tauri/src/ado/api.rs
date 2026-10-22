use super::client::{enc, AdoClient};
use super::wiql;
use crate::error::{AppError, AppResult, ErrorKind};
use futures::stream::{self, StreamExt};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize)]
struct ListResponse<T> {
    #[serde(default = "Vec::new")]
    value: Vec<T>,
}

/// Most items gathered from any paged list, so a misbehaving API cannot keep the app paging forever.
const PAGE_CAP: usize = 2000;
/// Teams whose members are fetched at the same time.
const MEMBER_FETCH_CONCURRENCY: usize = 6;

/// Pages a list with `$top`/`$skip` until a short page comes back. `path` is passed to `client.url`.
async fn list_by_skip<T: DeserializeOwned>(client: &AdoClient, path: &str, top: usize, cap: usize) -> AppResult<Vec<T>> {
    let sep = if path.contains('?') { '&' } else { '?' };
    let mut out: Vec<T> = Vec::new();
    loop {
        let url = client.url(&format!("{path}{sep}$top={top}&$skip={}", out.len()));
        let page: ListResponse<T> = client.get(&url).await?;
        let n = page.value.len();
        out.extend(page.value);
        if n < top || out.len() >= cap {
            return Ok(out);
        }
    }
}

/// Pages a list by the `x-ms-continuationtoken` response header. `path` is passed to `client.url`.
async fn list_by_token<T: DeserializeOwned>(client: &AdoClient, path: &str, cap: usize) -> AppResult<Vec<T>> {
    let sep = if path.contains('?') { '&' } else { '?' };
    let mut out: Vec<T> = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let url = match &token {
            Some(t) => client.url(&format!("{path}{sep}continuationToken={}", enc(t))),
            None => client.url(path),
        };
        let (page, next): (ListResponse<T>, Option<String>) = client.get_page(&url).await?;
        out.extend(page.value);
        match next {
            Some(n) if out.len() < cap && token.as_deref() != Some(n.as_str()) => token = Some(n),
            _ => return Ok(out),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub user_id: String,
    pub user_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub last_update_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub unique_name: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TeamMember {
    identity: Identity,
}

#[derive(Debug, Deserialize)]
struct ConnectionData {
    #[serde(rename = "authenticatedUser")]
    authenticated_user: AuthenticatedUser,
}

#[derive(Debug, Deserialize)]
struct AuthenticatedUser {
    id: String,
    #[serde(rename = "providerDisplayName", default)]
    provider_display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WiqlResult {
    #[serde(rename = "workItems", default)]
    work_items: Vec<WiqlRef>,
}

#[derive(Debug, Deserialize)]
struct WiqlRef {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct FieldRef {
    #[serde(rename = "referenceName")]
    reference_name: String,
    #[serde(rename = "type", default)]
    field_type: Option<String>,
}

pub const STANDARD_FIELDS: &[&str] = &[
    "System.Id",
    "System.Rev",
    "System.Title",
    "System.State",
    "System.Reason",
    "System.WorkItemType",
    "System.AssignedTo",
    "System.CreatedBy",
    "System.CreatedDate",
    "System.ChangedDate",
    "System.ChangedBy",
    "System.IterationPath",
    "System.AreaPath",
    "System.Tags",
    "System.TeamProject",
    "System.BoardColumn",
    "System.BoardColumnDone",
    "System.BoardLane",
    "System.Parent",
    "System.CommentCount",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.Severity",
    "Microsoft.VSTS.Common.StackRank",
    "Microsoft.VSTS.Common.BacklogPriority",
    "Microsoft.VSTS.Scheduling.StoryPoints",
    "Microsoft.VSTS.Scheduling.Effort",
    "Microsoft.VSTS.Scheduling.Size",
    "Microsoft.VSTS.Scheduling.RemainingWork",
    "Microsoft.VSTS.Scheduling.OriginalEstimate",
    "Microsoft.VSTS.Scheduling.CompletedWork",
    "Microsoft.VSTS.Scheduling.StartDate",
    "Microsoft.VSTS.Scheduling.TargetDate",
    "Microsoft.VSTS.Scheduling.DueDate",
    "Microsoft.VSTS.Common.StateChangeDate",
    "Microsoft.VSTS.Common.ClosedDate",
    "System.Description",
    "Microsoft.VSTS.TCM.ReproSteps",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
];

pub async fn connection_info(client: &AdoClient) -> AppResult<ConnectionInfo> {
    let url = client.url("/_apis/connectionData?api-version=7.1-preview.1");
    let data: ConnectionData = client.get(&url).await.map_err(|e| {
        if e.kind == ErrorKind::NotFound {
            AppError::new(ErrorKind::NotFound, "Organization not found. Check the name and try again.")
        } else if e.kind == ErrorKind::Internal {
            AppError::new(ErrorKind::Unauthorized, "Sign-in failed. Check the organization name and token.")
        } else {
            e
        }
    })?;
    Ok(ConnectionInfo {
        user_id: data.authenticated_user.id,
        user_name: data.authenticated_user.provider_display_name.unwrap_or_else(|| "Me".into()),
    })
}

pub async fn list_projects(client: &AdoClient) -> AppResult<Vec<Project>> {
    let mut items: Vec<Project> = list_by_token(client, "/_apis/projects?$top=500&stateFilter=wellFormed", 10_000).await?;
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

pub async fn list_teams(client: &AdoClient, project_id: &str) -> AppResult<Vec<Team>> {
    let path = format!("/_apis/projects/{}/teams", enc(project_id));
    let mut items: Vec<Team> = list_by_skip(client, &path, 500, 10_000).await?;
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

pub async fn default_team(client: &AdoClient, project_id: &str) -> AppResult<Option<Team>> {
    let url = client.url(&format!("/_apis/projects/{}?includeCapabilities=false", enc(project_id)));
    let v: Value = client.get(&url).await?;
    Ok(v.get("defaultTeam").and_then(|t| {
        Some(Team {
            id: t.get("id")?.as_str()?.to_string(),
            name: t.get("name")?.as_str()?.to_string(),
            description: None,
            project_id: Some(project_id.to_string()),
        })
    }))
}

pub async fn list_boards(client: &AdoClient, project: &str, team: &str) -> AppResult<Vec<BoardRef>> {
    let url = client.url(&format!("/{}/{}/_apis/work/boards", enc(project), enc(team)));
    let res: ListResponse<BoardRef> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn get_board(client: &AdoClient, project: &str, team: &str, board_id: &str) -> AppResult<Value> {
    let url = client.url(&format!("/{}/{}/_apis/work/boards/{}", enc(project), enc(team), enc(board_id)));
    client.get(&url).await
}

pub async fn list_iterations(client: &AdoClient, project: &str, team: &str) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("/{}/{}/_apis/work/teamsettings/iterations", enc(project), enc(team)));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn team_settings(client: &AdoClient, project: &str, team: &str) -> AppResult<Value> {
    let url = client.url(&format!("/{}/{}/_apis/work/teamsettings", enc(project), enc(team)));
    client.get(&url).await
}

pub async fn team_areas(client: &AdoClient, project: &str, team: &str) -> AppResult<Vec<(String, bool)>> {
    let url = client.url(&format!("/{}/{}/_apis/work/teamsettings/teamfieldvalues", enc(project), enc(team)));
    let v: Value = client.get(&url).await?;
    let mut out = Vec::new();
    if let Some(values) = v.get("values").and_then(|x| x.as_array()) {
        for item in values {
            if let Some(path) = item.get("value").and_then(|x| x.as_str()) {
                let include = item.get("includeChildren").and_then(|x| x.as_bool()).unwrap_or(false);
                out.push((path.to_string(), include));
            }
        }
    }
    Ok(out)
}

pub async fn work_item_types(client: &AdoClient, project: &str) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("/{}/_apis/wit/workitemtypes", enc(project)));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn team_members(client: &AdoClient, project_id: &str, team_id: &str) -> AppResult<Vec<Identity>> {
    let path = format!("/_apis/projects/{}/teams/{}/members", enc(project_id), enc(team_id));
    let members: Vec<TeamMember> = list_by_skip(client, &path, 500, 10_000).await?;
    Ok(members.into_iter().map(|m| m.identity).collect())
}

/// All people across all teams in a project, de-duplicated.
pub async fn project_members(client: &AdoClient, project_id: &str) -> AppResult<Vec<Identity>> {
    let teams = list_teams(client, project_id).await?;
    let requests: Vec<_> = teams.iter().map(|team| team_members(client, project_id, &team.id)).collect();
    let fetched: Vec<AppResult<Vec<Identity>>> = stream::iter(requests)
        .buffer_unordered(MEMBER_FETCH_CONCURRENCY)
        .collect()
        .await;
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for m in fetched.into_iter().flatten().flatten() {
        if seen.insert(m.id.clone()) {
            out.push(m);
        }
    }
    out.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(out)
}

/// Every field in the organization, as reference name -> data type (string, integer, html, ...).
pub type FieldMap = HashMap<String, String>;

pub async fn org_fields(client: &AdoClient) -> AppResult<FieldMap> {
    let url = client.url("/_apis/wit/fields");
    let res: ListResponse<FieldRef> = client.get(&url).await?;
    Ok(res
        .value
        .into_iter()
        .map(|f| (f.reference_name, f.field_type.unwrap_or_else(|| "string".into())))
        .collect())
}

pub fn select_fields(available: &FieldMap, extra: &[String]) -> Vec<String> {
    let mut fields: Vec<String> = STANDARD_FIELDS
        .iter()
        .filter(|f| available.contains_key(**f))
        .map(|f| f.to_string())
        .collect();
    for e in extra {
        if available.contains_key(e) && !fields.contains(e) {
            fields.push(e.clone());
        }
    }
    fields
}

/// Field definitions for one work item type (required flags, allowed values, help text).
pub async fn work_item_type_fields(client: &AdoClient, project: &str, type_name: &str) -> AppResult<Vec<Value>> {
    let url = client.url(&format!(
        "/{}/_apis/wit/workitemtypes/{}/fields?$expand=allowedValues",
        enc(project),
        enc(type_name)
    ));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

/// Work item types with their field definitions attached under "fieldDefs".
pub async fn work_item_types_with_fields(client: &AdoClient, project: &str) -> AppResult<Vec<Value>> {
    let mut types = work_item_types(client, project).await?;
    let names: Vec<String> = types
        .iter()
        .filter(|t| !t.get("isDisabled").and_then(|d| d.as_bool()).unwrap_or(false))
        .filter_map(|t| t.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
        .collect();
    let fetched = futures::future::join_all(names.iter().map(|n| work_item_type_fields(client, project, n))).await;
    let mut by_name: HashMap<String, Vec<Value>> = HashMap::new();
    for (name, res) in names.into_iter().zip(fetched) {
        by_name.insert(name, res.unwrap_or_default());
    }
    for t in types.iter_mut() {
        let name = t.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
        if let Some(defs) = by_name.remove(&name) {
            if let Some(obj) = t.as_object_mut() {
                obj.insert("fieldDefs".into(), Value::Array(defs));
            }
        }
    }
    Ok(types)
}

pub async fn run_wiql(client: &AdoClient, scope: &str, query: &str, top: u32) -> AppResult<Vec<i64>> {
    let url = client.url(&format!("{scope}/_apis/wit/wiql?$top={top}"));
    let res: WiqlResult = client.post_json(&url, &json!({ "query": query })).await?;
    Ok(res.work_items.into_iter().map(|w| w.id).collect())
}

pub async fn get_items_batch(
    client: &AdoClient,
    scope: &str,
    ids: &[i64],
    fields: &[String],
) -> AppResult<Vec<Value>> {
    let mut out = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(200) {
        let url = client.url(&format!("{scope}/_apis/wit/workitemsbatch"));
        let body = json!({ "ids": chunk, "fields": fields, "errorPolicy": "Omit" });
        let res: ListResponse<Value> = client.post_json(&url, &body).await?;
        out.extend(res.value);
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardQuery {
    pub project: String,
    pub team: String,
    pub types: Vec<String>,
    #[serde(default)]
    pub done_states: Vec<String>,
    #[serde(default = "default_done_days")]
    pub done_days: u32,
    #[serde(default)]
    pub extra_fields: Vec<String>,
    #[serde(default)]
    pub iteration_path: Option<String>,
}

fn default_done_days() -> u32 {
    30
}

pub async fn query_board_items(
    client: &AdoClient,
    available_fields: &FieldMap,
    q: &BoardQuery,
) -> AppResult<Vec<Value>> {
    if q.types.is_empty() {
        return Ok(Vec::new());
    }
    let areas = team_areas(client, &q.project, &q.team).await?;
    let mut clauses = vec![
        "[System.TeamProject] = @project".to_string(),
        format!("[System.WorkItemType] IN ({})", wiql::in_list(&q.types)),
        "[System.State] <> 'Removed'".to_string(),
    ];
    if let Some(area) = wiql::area_clause(&areas) {
        clauses.push(area);
    }
    if !q.done_states.is_empty() {
        clauses.push(format!(
            "([System.State] NOT IN ({}) OR [System.ChangedDate] >= @Today - {})",
            wiql::in_list(&q.done_states),
            q.done_days
        ));
    }
    if let Some(iter) = &q.iteration_path {
        clauses.push(format!("[System.IterationPath] UNDER {}", wiql::quote(iter)));
    }
    let query = format!(
        "SELECT [System.Id] FROM WorkItems WHERE {} ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC",
        clauses.join(" AND ")
    );
    let scope = format!("/{}/{}", enc(&q.project), enc(&q.team));
    let ids = match run_wiql(client, &scope, &query, 5000).await {
        Ok(ids) => ids,
        Err(e) if e.kind == ErrorKind::Validation => {
            // StackRank may not exist in this process; fall back to a plain order.
            let query = query.replace("[Microsoft.VSTS.Common.StackRank] ASC, ", "");
            run_wiql(client, &scope, &query, 5000).await?
        }
        Err(e) => return Err(e),
    };
    let fields = select_fields(available_fields, &q.extra_fields);
    get_items_batch(client, &format!("/{}", enc(&q.project)), &ids, &fields).await
}

/// Every item of the given types in a project (not limited to one team's areas), for the requirements tree.
/// `exclude_states` drops finished items where only open ones matter (e.g. bugs).
pub async fn project_items(
    client: &AdoClient,
    available_fields: &FieldMap,
    project: &str,
    types: &[String],
    exclude_states: &[String],
    extra_fields: &[String],
    with_relations: bool,
) -> AppResult<Vec<Value>> {
    if types.is_empty() {
        return Ok(Vec::new());
    }
    let mut clauses = vec![
        "[System.TeamProject] = @project".to_string(),
        format!("[System.WorkItemType] IN ({})", wiql::in_list(types)),
        "[System.State] <> 'Removed'".to_string(),
    ];
    if !exclude_states.is_empty() {
        clauses.push(format!("[System.State] NOT IN ({})", wiql::in_list(exclude_states)));
    }
    let query = format!(
        "SELECT [System.Id] FROM WorkItems WHERE {} ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC",
        clauses.join(" AND ")
    );
    let scope = format!("/{}", enc(project));
    let ids = match run_wiql(client, &scope, &query, 10000).await {
        Ok(ids) => ids,
        Err(e) if e.kind == ErrorKind::Validation => {
            let query = query.replace("[Microsoft.VSTS.Common.StackRank] ASC, ", "");
            run_wiql(client, &scope, &query, 10000).await?
        }
        Err(e) => return Err(e),
    };
    if with_relations {
        return get_items_with_relations(client, &scope, &ids).await;
    }
    let fields = select_fields(available_fields, extra_fields);
    get_items_batch(client, &scope, &ids, &fields).await
}

/// Full items with their links (the batch API cannot combine a field list with links).
pub async fn get_items_with_relations(client: &AdoClient, scope: &str, ids: &[i64]) -> AppResult<Vec<Value>> {
    let mut out = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(200) {
        let url = client.url(&format!("{scope}/_apis/wit/workitemsbatch"));
        let body = json!({ "ids": chunk, "$expand": "relations", "errorPolicy": "Omit" });
        let res: ListResponse<Value> = client.post_json(&url, &body).await?;
        out.extend(res.value);
    }
    Ok(out)
}

pub async fn my_work(client: &AdoClient, available_fields: &FieldMap) -> AppResult<Vec<Value>> {
    // Open work assigned to me, plus Resolved items I reported: those wait for my check before they close.
    // A Resolved item assigned to me but reported by someone else is theirs to check, so it is left out.
    // WIQL has no state category, so the usual finished states are excluded here and the app drops any
    // other Completed, Removed or Resolved state using each project's own type definitions.
    let query = "SELECT [System.Id] FROM WorkItems WHERE \
                 ([System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Completed', 'Cut') \
                 AND ([System.State] <> 'Resolved' OR [System.CreatedBy] = @Me) \
                 AND [System.WorkItemType] NOT IN ('Test Case', 'Shared Steps')) \
                 OR ([System.CreatedBy] = @Me AND [System.State] = 'Resolved') \
                 ORDER BY [System.ChangedDate] DESC";
    let ids = run_wiql(client, "", query, 500).await?;
    let fields = select_fields(available_fields, &[]);
    get_items_batch(client, "", &ids, &fields).await
}

/// Work items that mentioned me in the last week, newest change first.
pub async fn mentioned_items(client: &AdoClient, available_fields: &FieldMap) -> AppResult<Vec<Value>> {
    let query = "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions) \
                 AND [System.ChangedDate] >= @Today - 7 ORDER BY [System.ChangedDate] DESC";
    let ids = run_wiql(client, "", query, 100).await?;
    let fields = select_fields(available_fields, &[]);
    get_items_batch(client, "", &ids, &fields).await
}

pub async fn search_items(
    client: &AdoClient,
    available_fields: &FieldMap,
    project: Option<&str>,
    text: &str,
) -> AppResult<Vec<Value>> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let mut clauses = Vec::new();
    if let Some(p) = project {
        clauses.push(format!("[System.TeamProject] = {}", wiql::quote(p)));
    }
    if let Ok(id) = text.parse::<i64>() {
        clauses.push(format!("[System.Id] = {id}"));
    } else {
        clauses.push(format!("[System.Title] CONTAINS {}", wiql::quote(text)));
        clauses.push("[System.State] <> 'Removed'".to_string());
    }
    let query = format!(
        "SELECT [System.Id] FROM WorkItems WHERE {} ORDER BY [System.ChangedDate] DESC",
        clauses.join(" AND ")
    );
    let scope = project.map(|p| format!("/{}", enc(p))).unwrap_or_default();
    let ids = run_wiql(client, &scope, &query, 50).await?;
    let fields = select_fields(available_fields, &[]);
    get_items_batch(client, &scope, &ids, &fields).await
}

pub async fn get_work_item(client: &AdoClient, project: &str, id: i64) -> AppResult<Value> {
    let url = client.url(&format!("/{}/_apis/wit/workitems/{}?$expand=relations", enc(project), id));
    client.get(&url).await
}

pub async fn get_children(
    client: &AdoClient,
    available_fields: &FieldMap,
    project: &str,
    parent_id: i64,
) -> AppResult<Vec<Value>> {
    let query = format!(
        "SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = {parent_id} AND [System.State] <> 'Removed' ORDER BY [System.Id] ASC"
    );
    let scope = format!("/{}", enc(project));
    let ids = run_wiql(client, &scope, &query, 500).await?;
    let fields = select_fields(available_fields, &[]);
    get_items_batch(client, &scope, &ids, &fields).await
}

/// Turn a `{ field: value | null }` map into JSON Patch operations. `null` removes the field.
fn patch_ops(fields: &Map<String, Value>) -> Vec<Value> {
    fields
        .iter()
        .map(|(k, v)| {
            if v.is_null() {
                json!({ "op": "remove", "path": format!("/fields/{k}") })
            } else {
                json!({ "op": "add", "path": format!("/fields/{k}"), "value": v })
            }
        })
        .collect()
}

pub async fn create_work_item(
    client: &AdoClient,
    project: &str,
    work_item_type: &str,
    fields: &Map<String, Value>,
    parent_id: Option<i64>,
) -> AppResult<Value> {
    let mut ops = patch_ops(fields);
    if let Some(pid) = parent_id {
        ops.push(json!({
            "op": "add",
            "path": "/relations/-",
            "value": {
                "rel": "System.LinkTypes.Hierarchy-Reverse",
                "url": format!("{}/_apis/wit/workItems/{}", client.base(), pid)
            }
        }));
    }
    let url = client.url(&format!(
        "/{}/_apis/wit/workitems/${}?$expand=relations",
        enc(project),
        enc(work_item_type)
    ));
    client.post_patch(&url, &Value::Array(ops)).await
}

pub async fn update_work_item(
    client: &AdoClient,
    project: &str,
    id: i64,
    rev: Option<i64>,
    fields: &Map<String, Value>,
) -> AppResult<Value> {
    let mut ops = Vec::new();
    if let Some(rev) = rev {
        ops.push(json!({ "op": "test", "path": "/rev", "value": rev }));
    }
    ops.extend(patch_ops(fields));
    let url = client.url(&format!("/{}/_apis/wit/workitems/{}?$expand=relations", enc(project), id));
    client.patch_patch(&url, &Value::Array(ops)).await.map_err(|e| {
        if e.kind == ErrorKind::Conflict || (e.kind == ErrorKind::Validation && is_rev_test_failure(&e.message)) {
            AppError::new(
                ErrorKind::Conflict,
                "Someone else changed this item since you opened it. Refresh and try again.",
            )
        } else {
            e
        }
    })
}

/// The `test /rev` patch operation failed: someone saved the item in between.
fn is_rev_test_failure(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("tf26071") || m.contains("test operation") || m.contains("path /rev") || m.contains("\"/rev\"")
}

pub async fn set_parent(client: &AdoClient, project: &str, id: i64, parent_id: Option<i64>) -> AppResult<Value> {
    let current = get_work_item(client, project, id).await?;
    let mut ops = Vec::new();
    if let Some(rels) = current.get("relations").and_then(|r| r.as_array()) {
        for (idx, rel) in rels.iter().enumerate().rev() {
            if rel.get("rel").and_then(|r| r.as_str()) == Some("System.LinkTypes.Hierarchy-Reverse") {
                ops.push(json!({ "op": "remove", "path": format!("/relations/{idx}") }));
            }
        }
    }
    if let Some(pid) = parent_id {
        ops.push(json!({
            "op": "add",
            "path": "/relations/-",
            "value": {
                "rel": "System.LinkTypes.Hierarchy-Reverse",
                "url": format!("{}/_apis/wit/workItems/{}", client.base(), pid)
            }
        }));
    }
    if ops.is_empty() {
        return Ok(current);
    }
    let url = client.url(&format!("/{}/_apis/wit/workitems/{}?$expand=relations", enc(project), id));
    client.patch_patch(&url, &Value::Array(ops)).await
}

/// Link two items (e.g. a change request "Affects" a requirement); does nothing if the link exists.
/// Index of the relation `rel` pointing at `target_url` (case-insensitive) on a work item.
pub(crate) fn relation_index(item: &Value, rel: &str, target_url: &str) -> Option<usize> {
    item.get("relations")?
        .as_array()?
        .iter()
        .position(|r| r.get("rel").and_then(|x| x.as_str()) == Some(rel) && r.get("url").and_then(|u| u.as_str()).map(|u| u.eq_ignore_ascii_case(target_url)).unwrap_or(false))
}

pub async fn add_link(client: &AdoClient, project: &str, id: i64, target_id: i64, rel: &str) -> AppResult<Value> {
    let current = get_work_item(client, project, id).await?;
    let target_url = format!("{}/_apis/wit/workItems/{}", client.base(), target_id);
    if relation_index(&current, rel, &target_url).is_some() {
        return Ok(current);
    }
    let ops = json!([{ "op": "add", "path": "/relations/-", "value": { "rel": rel, "url": target_url } }]);
    let url = client.url(&format!("/{}/_apis/wit/workitems/{}?$expand=relations", enc(project), id));
    client.patch_patch(&url, &ops).await
}

/// Remove one link; does nothing when the item has no such link.
pub async fn remove_link(client: &AdoClient, project: &str, id: i64, target_id: i64, rel: &str) -> AppResult<Value> {
    let current = get_work_item(client, project, id).await?;
    let target_url = format!("{}/_apis/wit/workItems/{}", client.base(), target_id);
    let Some(index) = relation_index(&current, rel, &target_url) else {
        return Ok(current);
    };
    let rev = current.get("rev").cloned().unwrap_or(Value::Null);
    let ops = json!([{ "op": "test", "path": "/rev", "value": rev }, { "op": "remove", "path": format!("/relations/{index}") }]);
    let url = client.url(&format!("/{}/_apis/wit/workitems/{}?$expand=relations", enc(project), id));
    client.patch_patch(&url, &ops).await
}

pub async fn delete_work_item(client: &AdoClient, project: &str, id: i64) -> AppResult<()> {
    let url = client.url(&format!("/{}/_apis/wit/workitems/{}", enc(project), id));
    let _: Value = client_delete(client, &url).await?;
    Ok(())
}

async fn client_delete(client: &AdoClient, url: &str) -> AppResult<Value> {
    // Deletion moves the item to the recycle bin; it is recoverable from the web UI.
    client.delete(url).await
}

/// All comments, oldest first, following `continuationToken` (capped at `PAGE_CAP`).
pub async fn get_comments(client: &AdoClient, project: &str, id: i64) -> AppResult<Vec<Value>> {
    let base = format!("/{}/_apis/wit/workItems/{}/comments?$top=200&order=asc&api-version=7.1-preview.4", enc(project), id);
    let mut out = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let path = match &token {
            Some(t) => format!("{base}&continuationToken={}", enc(t)),
            None => base.clone(),
        };
        let v: Value = client.get(&client.url(&path)).await?;
        out.extend(v.get("comments").and_then(|c| c.as_array()).cloned().unwrap_or_default());
        let next = v.get("continuationToken").and_then(|t| t.as_str()).filter(|t| !t.is_empty()).map(|t| t.to_string());
        match next {
            Some(n) if out.len() < PAGE_CAP && token.as_deref() != Some(n.as_str()) => token = Some(n),
            _ => return Ok(out),
        }
    }
}

pub async fn add_comment(client: &AdoClient, project: &str, id: i64, text: &str) -> AppResult<Value> {
    let url = client.url(&format!(
        "/{}/_apis/wit/workItems/{}/comments?api-version=7.1-preview.4",
        enc(project),
        id
    ));
    client.post_json(&url, &json!({ "text": text })).await
}

pub async fn get_updates(client: &AdoClient, project: &str, id: i64) -> AppResult<Vec<Value>> {
    let path = format!("/{}/_apis/wit/workItems/{}/updates", enc(project), id);
    list_by_skip(client, &path, 200, PAGE_CAP).await
}

pub async fn project_tags(client: &AdoClient, project_id: &str) -> AppResult<Vec<String>> {
    let url = client.url(&format!("/{}/_apis/wit/tags?api-version=7.1-preview.1", enc(project_id)));
    let res: ListResponse<Value> = client.get(&url).await?;
    let mut tags: Vec<String> = res
        .value
        .into_iter()
        .filter_map(|t| t.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
        .collect();
    tags.sort_by_key(|t| t.to_lowercase());
    Ok(tags)
}

/// Add an area (module) under `parent` (a path below the project root, empty for the root).
pub async fn create_area(client: &AdoClient, project: &str, parent: &str, name: &str) -> AppResult<Value> {
    let below: String = parent.split('\\').filter(|s| !s.is_empty()).map(|s| format!("/{}", enc(s))).collect();
    let url = client.url(&format!("/{}/_apis/wit/classificationnodes/Areas{}", enc(project), below));
    client.post_json(&url, &json!({ "name": name })).await
}

pub async fn classification_nodes(client: &AdoClient, project: &str, group: &str) -> AppResult<Value> {
    let url = client.url(&format!(
        "/{}/_apis/wit/classificationnodes/{}?$depth=10",
        enc(project),
        group
    ));
    client.get(&url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relation_index_finds_matching_relation() {
        let item = json!({ "relations": [
            { "rel": "System.LinkTypes.Related", "url": "https://dev.azure.com/o/_apis/wit/workItems/5" },
            { "rel": "Microsoft.VSTS.Common.TestedBy-Reverse", "url": "https://dev.azure.com/o/_apis/wit/workItems/9" }
        ]});
        let i = relation_index(&item, "Microsoft.VSTS.Common.TestedBy-Reverse", "HTTPS://dev.azure.com/o/_apis/wit/workItems/9");
        assert_eq!(i, Some(1));
    }

    #[test]
    fn rev_conflicts_are_told_apart_from_other_errors() {
        assert!(is_rev_test_failure("TF26071: This work item has been changed by someone else since you opened it."));
        assert!(is_rev_test_failure("Test operation failed for path /rev"));
        assert!(!is_rev_test_failure("The field 'Review Notes' is required."));
        assert!(!is_rev_test_failure("Invalid previous revision value."));
    }

    #[test]
    fn relation_index_is_none_when_absent() {
        let item = json!({ "relations": [{ "rel": "System.LinkTypes.Related", "url": "https://dev.azure.com/o/_apis/wit/workItems/5" }] });
        assert_eq!(relation_index(&item, "System.LinkTypes.Related", "https://dev.azure.com/o/_apis/wit/workItems/6"), None);
        assert_eq!(relation_index(&json!({}), "System.LinkTypes.Related", "x"), None);
    }
}
