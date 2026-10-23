//! Azure Test Plans: plans, suites, configurations and test points, and publishing test runs to them.
//! Shapes are trimmed to what the app shows, so the UI does not depend on the raw REST payloads.

use crate::ado::client::{enc, AdoClient};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Most entries read from one paged list.
const LIST_CAP: usize = 5000;
/// Results sent in one update; Azure DevOps rejects very large batches.
const RESULT_BATCH: usize = 100;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpPlan {
    pub id: i64,
    pub name: String,
    pub state: String,
    pub iteration: String,
    pub area_path: String,
    pub root_suite_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_date: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpSuite {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    /// "staticTestSuite", "requirementTestSuite" or "dynamicTestSuite".
    pub suite_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirement_id: Option<i64>,
    /// For a tag-based suite: the tag its query selects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpConfiguration {
    pub id: i64,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpPerson {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique_name: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpPoint {
    pub id: i64,
    pub suite_id: i64,
    pub test_case_id: i64,
    pub test_case_title: String,
    pub configuration_id: i64,
    pub configuration_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tester: Option<TpPerson>,
    /// Lower camel case as Azure DevOps sends it: "passed", "failed", "blocked", "notApplicable"…;
    /// "unspecified" (or "none") when the point has not run.
    pub outcome: String,
    pub is_automated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_result_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_by: Option<String>,
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn opt_s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(|x| x.to_string())
}

/// An id Azure DevOps may send as a number or as a string.
fn id_of(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    v.as_i64().or_else(|| v.as_str().and_then(|x| x.parse().ok()))
}

fn person(v: Option<&Value>) -> Option<TpPerson> {
    let v = v?;
    let id = opt_s(v, "id")?;
    Some(TpPerson { id, display_name: s(v, "displayName"), unique_name: opt_s(v, "uniqueName") })
}

pub fn plan_from(v: &Value) -> Option<TpPlan> {
    Some(TpPlan {
        id: id_of(v.get("id"))?,
        name: s(v, "name"),
        state: s(v, "state"),
        iteration: s(v, "iteration"),
        area_path: s(v, "areaPath"),
        root_suite_id: id_of(v.get("rootSuite").and_then(|r| r.get("id")))?,
        start_date: opt_s(v, "startDate"),
        end_date: opt_s(v, "endDate"),
        owner: v.get("owner").and_then(|o| opt_s(o, "displayName")),
        updated_date: opt_s(v, "updatedDate"),
    })
}

pub fn suite_from(v: &Value) -> Option<TpSuite> {
    Some(TpSuite {
        id: id_of(v.get("id"))?,
        name: s(v, "name"),
        parent_id: id_of(v.get("parentSuite").and_then(|p| p.get("id"))),
        suite_type: opt_s(v, "suiteType").unwrap_or_else(|| "staticTestSuite".into()),
        requirement_id: id_of(v.get("requirementId")).filter(|id| *id > 0),
        tag: opt_s(v, "queryString").and_then(|q| tag_in_query(&q)),
    })
}

/// The query of a tag-based suite: test cases in the project carrying the tag.
pub fn tag_query(tag: &str) -> AppResult<String> {
    let t = tag.trim();
    if t.is_empty() || t.contains(';') || t.chars().any(|c| c.is_control()) {
        return Err(AppError::validation("Choose a tag without semicolons or line breaks."));
    }
    Ok(format!(
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN GROUP 'Microsoft.TestCaseCategory' AND [System.Tags] CONTAINS '{}'",
        t.replace('\'', "''")
    ))
}

/// The tag a suite query selects, when it is one Boards wrote (or one shaped like it).
pub fn tag_in_query(q: &str) -> Option<String> {
    let lower = q.to_ascii_lowercase();
    let at = lower.find("[system.tags] contains '")? + "[system.tags] contains '".len();
    let rest = &q[at..];
    let mut out = String::new();
    let mut chars = rest.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\'' {
            if chars.peek() == Some(&'\'') {
                chars.next();
                out.push('\'');
            } else {
                return Some(out);
            }
        } else {
            out.push(c);
        }
    }
    None
}

pub fn configuration_from(v: &Value) -> Option<TpConfiguration> {
    // Retired configurations stay listed in Azure DevOps but cannot take new points.
    if s(v, "state").eq_ignore_ascii_case("inactive") {
        return None;
    }
    Some(TpConfiguration { id: id_of(v.get("id"))?, name: s(v, "name"), is_default: v.get("isDefault").and_then(|x| x.as_bool()).unwrap_or(false) })
}

pub fn point_from(v: &Value, suite_id: i64) -> Option<TpPoint> {
    let tc = v.get("testCaseReference")?;
    let cfg = v.get("configuration");
    let results = v.get("results");
    let last = results.and_then(|r| r.get("lastResultDetails"));
    let outcome = results.and_then(|r| opt_s(r, "outcome")).unwrap_or_else(|| "unspecified".into());
    Some(TpPoint {
        id: id_of(v.get("id"))?,
        suite_id: id_of(v.get("testSuite").and_then(|x| x.get("id"))).unwrap_or(suite_id),
        test_case_id: id_of(tc.get("id"))?,
        test_case_title: s(tc, "name"),
        configuration_id: id_of(cfg.and_then(|c| c.get("id"))).unwrap_or(0),
        configuration_name: cfg.map(|c| s(c, "name")).unwrap_or_default(),
        tester: person(v.get("tester")),
        outcome,
        is_automated: v.get("isAutomated").and_then(|x| x.as_bool()).unwrap_or(false),
        last_run_id: id_of(results.and_then(|r| r.get("lastTestRunId"))).filter(|x| *x > 0),
        last_result_id: id_of(results.and_then(|r| r.get("lastResultId"))).filter(|x| *x > 0),
        last_run_date: last.and_then(|l| opt_s(l, "dateCompleted")).filter(|d| !d.starts_with("0001")),
        last_run_by: last.and_then(|l| l.get("runBy")).and_then(|p| opt_s(p, "displayName")),
    })
}

/// Every entry of a paged testplan list, following the continuation token.
async fn all(client: &AdoClient, base: &str) -> AppResult<Vec<Value>> {
    let mut out: Vec<Value> = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let sep = if base.contains('?') { '&' } else { '?' };
        let path = match &token {
            Some(t) => format!("{base}{sep}continuationToken={}", enc(t)),
            None => base.to_string(),
        };
        let (page, next): (Value, Option<String>) = client.get_page(&client.url(&path)).await?;
        out.extend(page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default());
        match next {
            Some(n) if out.len() < LIST_CAP && token.as_deref() != Some(n.as_str()) => token = Some(n),
            _ => return Ok(out),
        }
    }
}

pub async fn plans(client: &AdoClient, project: &str, active_only: bool) -> AppResult<Vec<TpPlan>> {
    let base = format!("/{}/_apis/testplan/plans?includePlanDetails=true&filterActivePlans={active_only}", enc(project));
    Ok(all(client, &base).await?.iter().filter_map(plan_from).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPlan {
    pub name: String,
    pub iteration: String,
    pub area_path: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    /// Configurations every suite in the plan starts with; empty keeps the project default.
    #[serde(default)]
    pub configuration_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPlan {
    #[serde(flatten)]
    pub plan: TpPlan,
    /// Set when the plan exists but a later step (its configurations) did not work.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

pub async fn create_plan(client: &AdoClient, project: &str, input: &NewPlan) -> AppResult<CreatedPlan> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Give the plan a name."));
    }
    let mut body = json!({ "name": name, "iteration": input.iteration, "areaPath": input.area_path });
    if let Some(d) = &input.start_date {
        body["startDate"] = json!(d);
    }
    if let Some(d) = &input.end_date {
        body["endDate"] = json!(d);
    }
    let created: Value = client.post_json(&client.url(&format!("/{}/_apis/testplan/plans", enc(project))), &body).await?;
    let plan = plan_from(&created).ok_or_else(|| AppError::internal("Test Plans did not return the new plan."))?;
    // The plan exists now: failing here would invite creating it again.
    let warning = if input.configuration_ids.is_empty() {
        None
    } else {
        set_suite_configurations(client, project, plan.id, plan.root_suite_id, &input.configuration_ids)
            .await
            .err()
            .map(|e| format!("The plan was created, but its configurations could not be set: {}", e.message))
    };
    Ok(CreatedPlan { plan, warning })
}

/// Set a plan Active or Inactive (closing a project keeps everything; an inactive plan just leaves the lists).
pub async fn set_plan_state(client: &AdoClient, project: &str, plan: i64, state: &str) -> AppResult<TpPlan> {
    if state != "Active" && state != "Inactive" {
        return Err(AppError::validation("A plan is either Active or Inactive."));
    }
    let url = client.url(&format!("/{}/_apis/testplan/plans/{plan}", enc(project)));
    // The update must name the revision it changes.
    let current: Value = client.get(&url).await?;
    let revision = current.get("revision").and_then(|r| r.as_i64()).unwrap_or(0);
    let updated: Value = client.patch_json(&url, &json!({ "state": state, "revision": revision })).await?;
    plan_from(&updated).ok_or_else(|| AppError::internal("Test Plans did not return the plan."))
}

pub async fn set_suite_configurations(client: &AdoClient, project: &str, plan: i64, suite: i64, configuration_ids: &[i64]) -> AppResult<()> {
    let configs: Vec<Value> = configuration_ids.iter().map(|id| json!({ "id": id })).collect();
    let _: Value = client
        .patch_json(
            &client.url(&format!("/{}/_apis/testplan/Plans/{plan}/suites/{suite}", enc(project))),
            &json!({ "inheritDefaultConfigurations": false, "defaultConfigurations": configs }),
        )
        .await?;
    Ok(())
}

pub async fn suites(client: &AdoClient, project: &str, plan: i64) -> AppResult<Vec<TpSuite>> {
    let base = format!("/{}/_apis/testplan/Plans/{plan}/suites?asTreeView=false", enc(project));
    Ok(all(client, &base).await?.iter().filter_map(suite_from).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSuite {
    pub parent_id: i64,
    pub name: String,
    /// Set for a requirement-based suite: Azure DevOps fills it with the requirement's Tested By test cases.
    #[serde(default)]
    pub requirement_id: Option<i64>,
    /// Set for a tag-based suite: it holds every test case with this tag, and keeps up as tags change.
    #[serde(default)]
    pub tag: Option<String>,
}

pub async fn create_suite(client: &AdoClient, project: &str, plan: i64, input: &NewSuite) -> AppResult<TpSuite> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Give the suite a name."));
    }
    let mut body = json!({ "name": name, "parentSuite": { "id": input.parent_id }, "suiteType": "staticTestSuite", "inheritDefaultConfigurations": true });
    if let Some(req) = input.requirement_id {
        body["suiteType"] = json!("requirementTestSuite");
        body["requirementId"] = json!(req);
    } else if let Some(tag) = &input.tag {
        body["suiteType"] = json!("dynamicTestSuite");
        body["queryString"] = json!(tag_query(tag)?);
    }
    let created: Value = client.post_json(&client.url(&format!("/{}/_apis/testplan/Plans/{plan}/suites", enc(project))), &body).await?;
    suite_from(&created).ok_or_else(|| AppError::internal("Test Plans did not return the new suite."))
}

/// Add test cases to a static suite; with configurations, one point per configuration instead of the suite's defaults.
pub async fn add_cases(client: &AdoClient, project: &str, plan: i64, suite: i64, ids: &[i64], configuration_ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let body: Vec<Value> = ids
        .iter()
        .map(|id| {
            let mut v = json!({ "workItem": { "id": id } });
            if !configuration_ids.is_empty() {
                v["pointAssignments"] = json!(configuration_ids.iter().map(|c| json!({ "configurationId": c })).collect::<Vec<_>>());
            }
            v
        })
        .collect();
    let _: Value = client
        .post_json(&client.url(&format!("/{}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestCase", enc(project))), &json!(body))
        .await?;
    Ok(())
}

/// Take test cases out of a suite. The test cases themselves stay.
pub async fn remove_cases(client: &AdoClient, project: &str, plan: i64, suite: i64, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
    let _: Value = client
        .delete(&client.url(&format!("/{}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestCase?testCaseIds={list}", enc(project))))
        .await?;
    Ok(())
}

pub async fn configurations(client: &AdoClient, project: &str) -> AppResult<Vec<TpConfiguration>> {
    let base = format!("/{}/_apis/testplan/configurations", enc(project));
    Ok(all(client, &base).await?.iter().filter_map(configuration_from).collect())
}

pub async fn points(client: &AdoClient, project: &str, plan: i64, suite: i64) -> AppResult<Vec<TpPoint>> {
    let base = format!("/{}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestPoint?includePointDetails=true&returnIdentityRef=true", enc(project));
    Ok(all(client, &base).await?.iter().filter_map(|v| point_from(v, suite)).collect())
}

/// Outcomes a person may set on a point directly, as the web portal's "Mark outcome" does.
const MARKABLE: &[&str] = &["passed", "failed", "blocked", "notApplicable"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointUpdate {
    pub id: i64,
    /// One of MARKABLE, or "reset" to make the point active (not run) again.
    #[serde(default)]
    pub outcome: Option<String>,
    /// Identity id of the new tester.
    #[serde(default)]
    pub tester_id: Option<String>,
}

pub fn point_update_body(u: &PointUpdate) -> AppResult<Value> {
    let mut v = json!({ "id": u.id });
    match u.outcome.as_deref() {
        None => {}
        // The testplan API has no "reset" flag: an active point with no outcome is what "not run" is.
        Some("reset") => {
            v["isActive"] = json!(true);
            v["results"] = json!({ "outcome": "unspecified" });
        }
        Some(o) if MARKABLE.contains(&o) => v["results"] = json!({ "outcome": o }),
        Some(o) => return Err(AppError::validation(format!("\"{o}\" is not an outcome that can be set."))),
    }
    if let Some(t) = &u.tester_id {
        v["tester"] = json!({ "id": t });
    }
    Ok(v)
}

pub async fn update_points(client: &AdoClient, project: &str, plan: i64, suite: i64, updates: &[PointUpdate]) -> AppResult<Vec<TpPoint>> {
    let body = updates.iter().map(point_update_body).collect::<AppResult<Vec<_>>>()?;
    let url = client.url(&format!("/{}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestPoint?includePointDetails=true&returnIdentityRef=true", enc(project)));
    let updated: Value = client.patch_json(&url, &json!(body)).await?;
    let list = updated.get("value").and_then(|v| v.as_array()).cloned().or_else(|| updated.as_array().cloned()).unwrap_or_default();
    Ok(list.iter().filter_map(|v| point_from(v, suite)).collect())
}

// ----- Test runs -----

/// Outcomes a published result may have, as the test results API spells them.
const RESULT_OUTCOMES: &[&str] = &["Passed", "Failed", "Blocked", "NotApplicable", "NotExecuted", "Inconclusive"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFile {
    pub name: String,
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointResult {
    pub point_id: i64,
    pub outcome: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub stack_trace: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// For automated results: the test's full name and the file it lives in.
    #[serde(default)]
    pub automated_test_name: Option<String>,
    #[serde(default)]
    pub automated_test_storage: Option<String>,
    #[serde(default)]
    pub attachments: Vec<RunFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInput {
    pub plan_id: i64,
    pub name: String,
    pub automated: bool,
    #[serde(default)]
    pub build_number: Option<String>,
    pub results: Vec<PointResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub run_id: i64,
    pub published: usize,
}

fn trimmed(s: &Option<String>, max: usize) -> Option<String> {
    s.as_ref().map(|x| x.trim()).filter(|x| !x.is_empty()).map(|x| x.chars().take(max).collect())
}

/// The update for one created result: outcome, timing and what went wrong.
pub fn result_body(result_id: i64, r: &PointResult) -> AppResult<Value> {
    if !RESULT_OUTCOMES.contains(&r.outcome.as_str()) {
        return Err(AppError::validation(format!("\"{}\" is not a test outcome.", r.outcome)));
    }
    let mut v = json!({ "id": result_id, "outcome": r.outcome, "state": "Completed" });
    // Azure DevOps caps these fields; longer text is refused rather than cut.
    if let Some(c) = trimmed(&r.comment, 1000) {
        v["comment"] = json!(c);
    }
    if let Some(e) = trimmed(&r.error_message, 4000) {
        v["errorMessage"] = json!(e);
    }
    if let Some(st) = trimmed(&r.stack_trace, 4000) {
        v["stackTrace"] = json!(st);
    }
    if let Some(d) = r.duration_ms {
        v["durationInMs"] = json!(d);
    }
    if let Some(n) = trimmed(&r.automated_test_name, 512) {
        v["automatedTestName"] = json!(n);
    }
    if let Some(n) = trimmed(&r.automated_test_storage, 512) {
        v["automatedTestStorage"] = json!(n);
    }
    Ok(v)
}

/// Every result of a run, as (result id, point id).
async fn run_results(client: &AdoClient, p: &str, run_id: i64) -> AppResult<Vec<(i64, i64)>> {
    let mut out = Vec::new();
    let mut read = 0usize;
    loop {
        let page: Value = client.get(&client.url(&format!("/{p}/_apis/test/Runs/{run_id}/results?$top=1000&$skip={read}"))).await?;
        let list = page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let n = list.len();
        read += n;
        out.extend(list.iter().filter_map(|r| Some((id_of(r.get("id"))?, id_of(r.get("testPoint").and_then(|t| t.get("id")))?))));
        if n < 1000 || read >= LIST_CAP * 4 {
            return Ok(out);
        }
    }
}

/// Create one run over the points, set every result, attach files and complete it.
/// If anything fails after the run exists, the run is aborted so no half-finished run is left behind.
pub async fn publish_run(client: &AdoClient, project: &str, input: &RunInput) -> AppResult<RunOutcome> {
    if input.results.is_empty() {
        return Err(AppError::validation("There are no results to publish."));
    }
    for r in &input.results {
        result_body(0, r)?;
    }
    let p = enc(project);
    let mut point_ids: Vec<i64> = input.results.iter().map(|r| r.point_id).collect();
    point_ids.sort_unstable();
    point_ids.dedup();
    let mut body = json!({ "name": input.name, "plan": { "id": input.plan_id.to_string() }, "pointIds": point_ids, "automated": input.automated, "state": "InProgress" });
    if let Some(b) = trimmed(&input.build_number, 256) {
        body["buildReference"] = json!({ "number": b });
    }
    let url = client.url(&format!("/{p}/_apis/test/runs"));
    let run: Value = match client.post_json(&url, &body).await {
        // Some organizations refuse an automated run over test cases with no associated automation;
        // a manual run still records the results, and each keeps its automated test name.
        Err(e) if input.automated && e.status == Some(400) => {
            body["automated"] = json!(false);
            client.post_json(&url, &body).await?
        }
        other => other?,
    };
    let run_id = id_of(run.get("id")).ok_or_else(|| AppError::internal("Test Plans did not return the new run's id."))?;
    match fill_run(client, &p, run_id, input).await {
        Ok(published) => Ok(RunOutcome { run_id, published }),
        Err(e) => {
            let _: AppResult<Value> = client.patch_json(&client.url(&format!("/{p}/_apis/test/runs/{run_id}")), &json!({ "state": "Aborted" })).await;
            Err(e)
        }
    }
}

async fn fill_run(client: &AdoClient, p: &str, run_id: i64, input: &RunInput) -> AppResult<usize> {
    let created = run_results(client, p, run_id).await?;
    let mut updates: Vec<Value> = Vec::new();
    let mut files: Vec<(i64, &RunFile)> = Vec::new();
    for r in &input.results {
        // The first result created for the point; a point listed twice keeps its first result.
        let Some((result_id, _)) = created.iter().find(|(_, point)| *point == r.point_id) else { continue };
        if updates.iter().any(|u| u.get("id").and_then(|x| x.as_i64()) == Some(*result_id)) {
            continue;
        }
        updates.push(result_body(*result_id, r)?);
        files.extend(r.attachments.iter().map(|f| (*result_id, f)));
    }
    if updates.is_empty() {
        return Err(AppError::internal("Test Plans created no results for these points."));
    }
    // Files first: if one is refused, the run is aborted before any point shows the new outcome.
    for (result_id, f) in files {
        let _: Value = client
            .post_json(
                &client.url(&format!("/{p}/_apis/test/Runs/{run_id}/Results/{result_id}/attachments")),
                &json!({ "stream": f.data_base64, "fileName": f.name, "attachmentType": "GeneralAttachment" }),
            )
            .await?;
    }
    for chunk in updates.chunks(RESULT_BATCH) {
        let _: Value = client.patch_json(&client.url(&format!("/{p}/_apis/test/Runs/{run_id}/results")), &json!(chunk)).await?;
    }
    let _: Value = client.patch_json(&client.url(&format!("/{p}/_apis/test/runs/{run_id}")), &json!({ "state": "Completed" })).await?;
    Ok(updates.len())
}

// ----- Run history -----

/// Runs read from one plan; older ones beyond this are not listed.
const RUN_CAP: usize = 2000;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpRun {
    pub id: i64,
    pub name: String,
    /// The version the run tested, as Boards sends it in `buildReference.number`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_number: Option<String>,
    pub state: String,
    pub is_automated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_date: Option<String>,
    pub total_tests: i64,
    pub passed_tests: i64,
}

pub fn run_from(v: &Value) -> Option<TpRun> {
    // Azure DevOps reports the build number in different places depending on how the run was made.
    let build = v
        .get("buildConfiguration")
        .and_then(|b| opt_s(b, "number"))
        .or_else(|| v.get("build").and_then(|b| opt_s(b, "number").or_else(|| opt_s(b, "name"))));
    Some(TpRun {
        id: id_of(v.get("id"))?,
        name: s(v, "name"),
        build_number: build.map(|b| b.trim().to_string()).filter(|b| !b.is_empty()),
        state: s(v, "state"),
        is_automated: v.get("isAutomated").and_then(|x| x.as_bool()).unwrap_or(false),
        completed_date: opt_s(v, "completedDate"),
        total_tests: v.get("totalTests").and_then(|x| x.as_i64()).unwrap_or(0),
        passed_tests: v.get("passedTests").and_then(|x| x.as_i64()).unwrap_or(0),
    })
}

/// The plan's test runs, newest first.
pub async fn runs(client: &AdoClient, project: &str, plan: i64) -> AppResult<Vec<TpRun>> {
    let p = enc(project);
    let mut out = Vec::new();
    let mut read = 0usize;
    loop {
        let page: Value = client.get(&client.url(&format!("/{p}/_apis/test/runs?planId={plan}&includeRunDetails=true&$top=100&$skip={read}"))).await?;
        let list = page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        read += list.len();
        out.extend(list.iter().filter_map(run_from));
        if list.len() < 100 || read >= RUN_CAP {
            break;
        }
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TpResult {
    pub run_id: i64,
    pub result_id: i64,
    pub point_id: i64,
    /// Lower camel case like a point's outcome: "passed", "failed", "notExecuted"…
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

fn lower_first(x: &str) -> String {
    let mut c = x.chars();
    match c.next() {
        Some(f) => f.to_lowercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

pub fn result_from(v: &Value, run_id: i64) -> Option<TpResult> {
    Some(TpResult {
        run_id,
        result_id: id_of(v.get("id"))?,
        point_id: id_of(v.get("testPoint").and_then(|t| t.get("id")))?,
        outcome: opt_s(v, "outcome").map(|o| lower_first(&o)).unwrap_or_else(|| "unspecified".into()),
        completed_date: opt_s(v, "completedDate").filter(|d| !d.starts_with("0001")),
        run_by: v.get("runBy").and_then(|p| opt_s(p, "displayName")),
        error_message: opt_s(v, "errorMessage"),
    })
}

/// Every result of these runs, a run at a time.
pub async fn results_of_runs(client: &AdoClient, project: &str, run_ids: &[i64]) -> AppResult<Vec<TpResult>> {
    let p = enc(project);
    let mut out = Vec::new();
    for &run in run_ids.iter().take(RUN_CAP) {
        let mut read = 0usize;
        loop {
            let page: Value = client.get(&client.url(&format!("/{p}/_apis/test/Runs/{run}/results?$top=1000&$skip={read}"))).await?;
            let list = page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            read += list.len();
            out.extend(list.iter().filter_map(|r| result_from(r, run)));
            if list.len() < 1000 || read >= LIST_CAP * 4 {
                break;
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plan() {
        let v = json!({ "id": 7, "name": "Release 1.2", "state": "Active", "iteration": "P\\S1", "areaPath": "P", "rootSuite": { "id": 70 }, "owner": { "displayName": "Ann" }, "startDate": "2026-10-01T00:00:00Z" });
        let p = plan_from(&v).unwrap();
        assert_eq!((p.id, p.root_suite_id, p.owner.as_deref()), (7, 70, Some("Ann")));
        assert_eq!(p.end_date, None);
        assert!(plan_from(&json!({ "id": 1, "name": "x" })).is_none());
    }

    #[test]
    fn reads_suites_of_each_type() {
        let root = suite_from(&json!({ "id": 70, "name": "Release 1.2", "suiteType": "staticTestSuite" })).unwrap();
        assert_eq!(root.parent_id, None);
        let req = suite_from(&json!({ "id": 71, "name": "1200 : Sign in", "suiteType": "requirementTestSuite", "requirementId": 1200, "parentSuite": { "id": 70 } })).unwrap();
        assert_eq!((req.parent_id, req.requirement_id), (Some(70), Some(1200)));
        let st = suite_from(&json!({ "id": 72, "name": "Smoke", "requirementId": 0, "parentSuite": { "id": "70" } })).unwrap();
        assert_eq!((st.suite_type.as_str(), st.requirement_id, st.parent_id), ("staticTestSuite", None, Some(70)));
    }

    #[test]
    fn inactive_configurations_are_left_out() {
        assert!(configuration_from(&json!({ "id": 1, "name": "Windows 11", "state": "active", "isDefault": true })).unwrap().is_default);
        assert!(configuration_from(&json!({ "id": 2, "name": "Windows 7", "state": "inactive" })).is_none());
    }

    #[test]
    fn reads_a_point_with_its_last_result() {
        let v = json!({
            "id": 501, "isAutomated": false,
            "configuration": { "id": 3, "name": "macOS" },
            "tester": { "id": "u1", "displayName": "Ann", "uniqueName": "ann@x.com" },
            "testCaseReference": { "id": 1234, "name": "Signs in" },
            "testSuite": { "id": 71 },
            "results": { "outcome": "failed", "lastTestRunId": 88, "lastResultId": 100000, "lastResultDetails": { "dateCompleted": "2026-10-20T10:00:00Z", "runBy": { "displayName": "Bo" } } }
        });
        let p = point_from(&v, 0).unwrap();
        assert_eq!((p.id, p.suite_id, p.test_case_id, p.configuration_id), (501, 71, 1234, 3));
        assert_eq!((p.outcome.as_str(), p.last_run_id, p.last_run_by.as_deref()), ("failed", Some(88), Some("Bo")));
        assert_eq!(p.tester.unwrap().display_name, "Ann");
    }

    #[test]
    fn a_point_that_never_ran_has_no_last_run() {
        let v = json!({ "id": 9, "testCaseReference": { "id": 5, "name": "x" }, "results": { "outcome": "unspecified", "lastTestRunId": 0, "lastResultDetails": { "dateCompleted": "0001-01-01T00:00:00", "runBy": {} } } });
        let p = point_from(&v, 70).unwrap();
        assert_eq!((p.suite_id, p.outcome.as_str(), p.last_run_id, p.last_run_date, p.last_run_by), (70, "unspecified", None, None, None));
        assert!(p.tester.is_none());
    }

    #[test]
    fn point_updates_allow_only_known_outcomes() {
        let mark = point_update_body(&PointUpdate { id: 1, outcome: Some("blocked".into()), tester_id: None }).unwrap();
        assert_eq!(mark, json!({ "id": 1, "results": { "outcome": "blocked" } }));
        let reset = point_update_body(&PointUpdate { id: 1, outcome: Some("reset".into()), tester_id: Some("u2".into()) }).unwrap();
        assert_eq!(reset, json!({ "id": 1, "isActive": true, "results": { "outcome": "unspecified" }, "tester": { "id": "u2" } }));
        assert!(point_update_body(&PointUpdate { id: 1, outcome: Some("inProgress".into()), tester_id: None }).is_err());
    }

    #[test]
    fn result_bodies_are_trimmed_and_checked() {
        let r = PointResult {
            point_id: 1, outcome: "Failed".into(), comment: Some("  ".into()), error_message: Some("x".repeat(5000)), stack_trace: None,
            duration_ms: Some(1200), automated_test_name: Some("login › works".into()), automated_test_storage: Some("e2e/login.spec.ts".into()), attachments: vec![],
        };
        let v = result_body(42, &r).unwrap();
        assert_eq!(v["id"], 42);
        assert!(v.get("comment").is_none());
        assert_eq!(v["errorMessage"].as_str().unwrap().len(), 4000);
        assert_eq!(v["durationInMs"], 1200);
        assert!(result_body(42, &PointResult { outcome: "Skipped".into(), ..r }).is_err());
    }

    #[test]
    fn reads_a_run_and_its_version() {
        let a = run_from(&json!({ "id": 9, "name": "Manual · 0.4.0", "state": "Completed", "buildConfiguration": { "number": " 0.4.0 " }, "totalTests": 3, "passedTests": 2 })).unwrap();
        assert_eq!((a.build_number.as_deref(), a.total_tests, a.passed_tests), (Some("0.4.0"), 3, 2));
        let b = run_from(&json!({ "id": 10, "name": "x", "build": { "name": "20261023.1" }, "isAutomated": true })).unwrap();
        assert_eq!((b.build_number.as_deref(), b.is_automated), (Some("20261023.1"), true));
        assert_eq!(run_from(&json!({ "id": 11, "name": "y", "buildConfiguration": { "number": "" } })).unwrap().build_number, None);
    }

    #[test]
    fn reads_a_result_with_its_point() {
        let r = result_from(&json!({ "id": 100000, "outcome": "NotExecuted", "testPoint": { "id": "501" }, "runBy": { "displayName": "Ann" }, "completedDate": "2026-10-20T10:00:00Z" }), 9).unwrap();
        assert_eq!((r.run_id, r.point_id, r.outcome.as_str(), r.run_by.as_deref()), (9, 501, "notExecuted", Some("Ann")));
        assert!(result_from(&json!({ "id": 1, "outcome": "Passed" }), 9).is_none());
    }

    #[test]
    fn tag_suites_query_by_tag_and_read_it_back() {
        let q = tag_query(" O'Brien smoke ").unwrap();
        assert!(q.ends_with("[System.Tags] CONTAINS 'O''Brien smoke'"));
        assert!(q.contains("IN GROUP 'Microsoft.TestCaseCategory'"));
        assert_eq!(tag_in_query(&q).as_deref(), Some("O'Brien smoke"));
        assert_eq!(tag_in_query("select [System.Id] from WorkItems where [System.Tags] contains 'Smoke' and x").as_deref(), Some("Smoke"));
        assert_eq!(tag_in_query("select [System.Id] from WorkItems where [System.State] = 'Ready'"), None);
        assert!(tag_query("a;b").is_err());
        assert!(tag_query("  ").is_err());
        let suite = suite_from(&json!({ "id": 5, "name": "Smoke", "suiteType": "dynamicTestSuite", "queryString": q })).unwrap();
        assert_eq!(suite.tag.as_deref(), Some("O'Brien smoke"));
    }
}
