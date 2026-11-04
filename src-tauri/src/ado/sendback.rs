//! Send a work item back to the developer who fixed it, when testing finds the problem again.
//!
//! A pipeline moves items Active → Resolved (on the pull request into develop) and Resolved → Ready to Test
//! (assigning the tester), so "Resolved by" and the current assignee name the pipeline and the tester, not
//! the developer. Who fixed it is found, in order, from:
//! 1. the author of the item's linked pull request (the most recently completed one, else the newest);
//! 2. "Activated by", which Azure DevOps sets when the item moves to Active;
//! 3. the last person the item was assigned to in its history before it reached the tester.
//!
//! Pipeline and service accounts never count, and neither do the current assignee or the person sending it back.

use crate::ado::api::{add_comment, get_updates, update_work_item, work_item_types};
use crate::ado::client::AdoClient;
use crate::ado::pr::get_pr;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::{json, Map, Value};

/// Who to send the item back to, and why.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fixer {
    pub display_name: String,
    pub unique_name: String,
    pub id: Option<String>,
    /// "pullRequest", "activated" or "history".
    pub reason: String,
    /// For people: "wrote pull request !412", "moved it to Active", "had it before testing".
    pub detail: String,
}

/// What a send-back would do: the person (if one is found) and the state the item returns to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendBackPlan {
    pub fixer: Option<Fixer>,
    pub state: String,
}

/// A person who must not be picked: the tester holding the item, or the one sending it back.
pub struct Exclude<'a> {
    pub ids: Vec<&'a str>,
    pub names: Vec<&'a str>,
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Build agents, pipelines and other non-people identities.
pub fn is_service_account(who: &Value) -> bool {
    let name = str_of(who, "displayName").to_lowercase();
    let unique = str_of(who, "uniqueName").to_lowercase();
    let guid_like = unique.len() == 36 && unique.chars().filter(|c| *c == '-').count() == 4;
    name.contains("build service")
        || name.contains("project collection")
        || name.contains("azure pipelines")
        || name.contains("azure devops")
        || unique.starts_with("build\\")
        || guid_like
}

fn excluded(who: &Value, ex: &Exclude) -> bool {
    let id = str_of(who, "id");
    let names = [str_of(who, "displayName"), str_of(who, "uniqueName")];
    (!id.is_empty() && ex.ids.iter().any(|x| x.eq_ignore_ascii_case(id)))
        || names.iter().any(|n| !n.is_empty() && ex.names.iter().any(|x| x.eq_ignore_ascii_case(n)))
}

/// A real person other than the excluded ones.
fn candidate(who: &Value, ex: &Exclude) -> bool {
    who.is_object() && !str_of(who, "displayName").is_empty() && !is_service_account(who) && !excluded(who, ex)
}

fn fixer(who: &Value, reason: &str, detail: String) -> Fixer {
    Fixer {
        display_name: str_of(who, "displayName").to_string(),
        unique_name: str_of(who, "uniqueName").to_string(),
        id: who.get("id").and_then(Value::as_str).map(str::to_string),
        reason: reason.to_string(),
        detail,
    }
}

/// Pull requests linked to the item, as (repository id, pull request id).
pub fn linked_prs(item: &Value) -> Vec<(String, i64)> {
    item.get("relations")
        .and_then(Value::as_array)
        .map(|rels| {
            rels.iter()
                .filter_map(|r| {
                    let url = str_of(r, "url");
                    let rest = url.strip_prefix("vstfs:///Git/PullRequestId/")?;
                    let parts: Vec<&str> = rest.split("%2F").flat_map(|p| p.split("%2f")).collect();
                    match parts.as_slice() {
                        [_project, repo, pr] => pr.parse().ok().map(|n| (repo.to_string(), n)),
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The author of the most recently completed pull request, else of the newest one.
pub fn from_pull_requests(prs: &[Value], ex: &Exclude) -> Option<Fixer> {
    let mut list: Vec<&Value> = prs.iter().filter(|p| str_of(p, "status") != "abandoned" && candidate(&p["createdBy"], ex)).collect();
    // Completed ones first, then by when they closed or opened, newest first.
    list.sort_by(|a, b| {
        let done = |p: &Value| str_of(p, "status") == "completed";
        let when = |p: &Value| if done(p) { str_of(p, "closedDate").to_string() } else { str_of(p, "creationDate").to_string() };
        done(b).cmp(&done(a)).then_with(|| when(b).cmp(&when(a)))
    });
    list.first().map(|p| fixer(&p["createdBy"], "pullRequest", format!("wrote pull request !{}", p.get("pullRequestId").and_then(Value::as_i64).unwrap_or(0))))
}

pub fn from_activated(item: &Value, ex: &Exclude) -> Option<Fixer> {
    let who = item.get("fields")?.get("Microsoft.VSTS.Common.ActivatedBy")?;
    candidate(who, ex).then(|| fixer(who, "activated", "moved it to Active".into()))
}

/// The last person the item was assigned to before it reached the tester.
pub fn from_history(updates: &[Value], ex: &Exclude) -> Option<Fixer> {
    updates
        .iter()
        .rev()
        .filter_map(|u| u.get("fields")?.get("System.AssignedTo")?.get("newValue"))
        .find(|who| candidate(who, ex))
        .map(|who| fixer(who, "history", "had it before testing".into()))
}

/// The first not-started state of the item's type ("Proposed" in CMMI, "New" in Agile), where reported work goes back to.
pub fn start_state(types: &[Value], work_item_type: &str) -> Option<String> {
    let t = types.iter().find(|t| str_of(t, "name") == work_item_type)?;
    t.get("states")?
        .as_array()?
        .iter()
        .find(|s| str_of(s, "category") == "Proposed")
        .map(|s| str_of(s, "name").to_string())
}

/// Who fixed the item and the state it goes back to. `me` is the person sending it back.
pub async fn plan(client: &AdoClient, item: &Value, me: &Exclude<'_>) -> AppResult<SendBackPlan> {
    let fields = item.get("fields").cloned().unwrap_or(Value::Null);
    let project = str_of(&fields, "System.TeamProject").to_string();
    let id = item.get("id").and_then(Value::as_i64).unwrap_or(0);
    // The current assignee (the tester) is excluded along with me.
    let holder = fields.get("System.AssignedTo").cloned().unwrap_or(Value::Null);
    let ex = Exclude {
        ids: me.ids.iter().copied().chain([str_of(&holder, "id")].into_iter().filter(|s| !s.is_empty())).collect(),
        names: me.names.iter().copied().chain([str_of(&holder, "uniqueName"), str_of(&holder, "displayName")].into_iter().filter(|s| !s.is_empty())).collect(),
    };

    let mut prs = Vec::new();
    for (repo, pr) in linked_prs(item) {
        // A pull request in a repository we cannot read only means one fewer clue.
        if let Ok(p) = get_pr(client, &repo, pr).await {
            prs.push(p);
        }
    }
    let mut found = from_pull_requests(&prs, &ex).or_else(|| from_activated(item, &ex));
    if found.is_none() {
        found = from_history(&get_updates(client, &project, id).await.unwrap_or_default(), &ex);
    }
    let types = work_item_types(client, &project).await.unwrap_or_default();
    let state = start_state(&types, str_of(&fields, "System.WorkItemType")).unwrap_or_else(|| "Proposed".into());
    Ok(SendBackPlan { fixer: found, state })
}

/// Move the item back to `state`, assign it to `assign_to` and add the comment saying what is wrong.
/// The comment is required: the developer needs to know what failed.
pub async fn send_back(client: &AdoClient, project: &str, id: i64, rev: Option<i64>, assign_to: &str, state: &str, comment_html: &str) -> AppResult<Value> {
    if assign_to.trim().is_empty() {
        return Err(AppError::validation("Choose who to send it back to."));
    }
    if comment_html.trim().is_empty() {
        return Err(AppError::validation("Say what is wrong, so the developer knows what to fix."));
    }
    let mut fields = Map::new();
    fields.insert("System.State".into(), json!(state));
    fields.insert("System.AssignedTo".into(), json!(assign_to));
    let item = update_work_item(client, project, id, rev, &fields).await?;
    add_comment(client, project, id, comment_html).await?;
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: Exclude = Exclude { ids: vec![], names: vec![] };
    fn person(name: &str, email: &str) -> Value {
        json!({ "displayName": name, "uniqueName": email, "id": format!("id-{email}") })
    }
    fn pr(id: i64, status: &str, by: Value, created: &str, closed: &str) -> Value {
        json!({ "pullRequestId": id, "status": status, "createdBy": by, "creationDate": created, "closedDate": closed })
    }

    #[test]
    fn tells_pipelines_from_people() {
        assert!(is_service_account(&json!({ "displayName": "Contoso Mobile Build Service (contoso)", "uniqueName": "Build\\0f1e2d3c" })));
        assert!(is_service_account(&json!({ "displayName": "Project Collection Build Service (contoso)", "uniqueName": "x" })));
        assert!(is_service_account(&json!({ "displayName": "Release bot", "uniqueName": "0f1e2d3c-1111-2222-3333-444455556666" })));
        assert!(!is_service_account(&person("Priya Natarajan", "priya@example.com")));
    }

    #[test]
    fn reads_linked_pull_requests() {
        let item = json!({ "relations": [
            { "rel": "ArtifactLink", "url": "vstfs:///Git/PullRequestId/p1%2Fr1%2F412" },
            { "rel": "ArtifactLink", "url": "vstfs:///Git/Ref/p1%2Fr1%2FGBmain" },
            { "rel": "System.LinkTypes.Hierarchy-Reverse", "url": "https://x/_apis/wit/workItems/1" },
        ] });
        assert_eq!(linked_prs(&item), vec![("r1".to_string(), 412)]);
    }

    #[test]
    fn prefers_the_author_of_the_last_completed_pull_request() {
        let prs = [
            pr(400, "completed", person("Marcus", "marcus@example.com"), "2026-10-01", "2026-10-02"),
            pr(412, "completed", person("Priya", "priya@example.com"), "2026-10-05", "2026-10-06"),
            pr(420, "active", person("Hana", "hana@example.com"), "2026-10-09", ""),
            pr(430, "abandoned", person("Tom", "tom@example.com"), "2026-10-10", "2026-10-10"),
        ];
        let f = from_pull_requests(&prs, &NONE).unwrap();
        assert_eq!((f.display_name.as_str(), f.detail.as_str()), ("Priya", "wrote pull request !412"));
        // With nothing completed, the newest open one counts.
        let f = from_pull_requests(&prs[2..], &NONE).unwrap();
        assert_eq!(f.display_name, "Hana");
    }

    #[test]
    fn never_picks_the_tester_or_a_pipeline() {
        let tester = person("Wayne", "wayne@example.com");
        let ex = Exclude { ids: vec![], names: vec!["wayne@example.com"] };
        let prs = [pr(1, "completed", tester.clone(), "2026-10-01", "2026-10-02")];
        assert!(from_pull_requests(&prs, &ex).is_none());
        let item = json!({ "fields": { "Microsoft.VSTS.Common.ActivatedBy": { "displayName": "Contoso Build Service (contoso)", "uniqueName": "Build\\1" } } });
        assert!(from_activated(&item, &NONE).is_none());
    }

    #[test]
    fn falls_back_to_who_activated_it_then_to_the_history() {
        let item = json!({ "fields": { "Microsoft.VSTS.Common.ActivatedBy": person("Tomás", "tomas@example.com") } });
        assert_eq!(from_activated(&item, &NONE).unwrap().reason, "activated");
        let updates = [
            json!({ "fields": { "System.AssignedTo": { "newValue": person("Lead", "lead@example.com") } } }),
            json!({ "fields": { "System.AssignedTo": { "oldValue": person("Lead", "lead@example.com"), "newValue": person("Marcus", "marcus@example.com") } } }),
            json!({ "fields": { "System.State": { "newValue": "Resolved" } } }),
            json!({ "fields": { "System.AssignedTo": { "newValue": person("Wayne", "wayne@example.com") } } }),
        ];
        let ex = Exclude { ids: vec![], names: vec!["wayne@example.com"] };
        let f = from_history(&updates, &ex).unwrap();
        assert_eq!((f.display_name.as_str(), f.reason.as_str()), ("Marcus", "history"));
    }

    #[test]
    fn goes_back_to_the_first_not_started_state() {
        let types = [json!({ "name": "Bug", "states": [
            { "name": "Proposed", "category": "Proposed" }, { "name": "Active", "category": "InProgress" }, { "name": "Ready to Test", "category": "Resolved" },
        ] })];
        assert_eq!(start_state(&types, "Bug").as_deref(), Some("Proposed"));
        assert_eq!(start_state(&types, "Task"), None);
    }
}
