//! Test results from Azure Test Plans, read-only: a test case's run history, one result with its step
//! results and attachments, and an attachment's bytes. Results are V&V evidence, so outcomes are passed on
//! as recorded (only lower-camel-cased, like a point's outcome) and nothing here writes to Azure DevOps.
//!
//! Attachments belong to the result, not the run: the run's own list is usually empty.

use crate::ado::client::{enc, AdoClient};
use crate::ado::plans::{runs, TpRun};
use crate::error::{AppError, AppResult, ErrorKind};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// Results of one run read in one request.
const RUN_PAGE: usize = 1000;
/// Most runs read per plan when looking for a test case's history or a plan's results.
const RUN_SCAN: usize = 100;
/// Runs read at once.
const PARALLEL: usize = 6;
/// Largest attachment downloaded.
pub const MAX_ATTACHMENT: usize = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultSummary {
    pub run_id: i64,
    pub run_name: String,
    pub result_id: i64,
    pub test_case_id: i64,
    pub test_case_title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<i64>,
    /// Lower camel case: "passed", "failed", "notExecuted", "blocked"…
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<String>,
    pub is_automated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    /// The test case step's id ("2"); inside shared steps, "compref id;step id".
    pub step_id: String,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultAttachment {
    pub id: i64,
    pub file_name: String,
    pub size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// "image", "text" or "file", from the name: how the app can show it.
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultDetail {
    #[serde(flatten)]
    pub summary: ResultSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automated_test_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_date: Option<String>,
    /// Step results of the first iteration, as recorded.
    pub steps: Vec<StepResult>,
    /// Iterations recorded (data-driven test cases run the steps once per row).
    pub iterations: usize,
    pub attachments: Vec<ResultAttachment>,
    /// Why the attachment list could not be read, if it could not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_url: Option<String>,
}

/// What to list; at least one of the ids is needed.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultQuery {
    pub test_case_id: Option<i64>,
    pub plan_id: Option<i64>,
    pub run_id: Option<i64>,
    /// Matched without regard to case: "failed", "Passed"…
    pub outcome: Option<String>,
    #[serde(default)]
    pub limit: usize,
}

/// The run a result belongs to, as far as a result list needs it.
#[derive(Debug, Clone, Default)]
struct RunInfo {
    name: String,
    is_automated: bool,
    plan_id: Option<i64>,
}

impl From<&TpRun> for RunInfo {
    fn from(r: &TpRun) -> Self {
        Self { name: r.name.clone(), is_automated: r.is_automated, plan_id: None }
    }
}

fn opt_s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

fn id_of(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    v.as_i64().or_else(|| v.as_str().and_then(|x| x.parse().ok()))
}

/// Durations come as numbers with a fraction ("1234.0") or, now and then, as strings.
fn ms(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    v.as_f64().or_else(|| v.as_str().and_then(|x| x.parse().ok())).map(|x| x.round() as i64)
}

fn date(v: &Value, key: &str) -> Option<String> {
    opt_s(v, key).filter(|d| !d.starts_with("0001"))
}

pub fn lower_first(x: &str) -> String {
    let mut c = x.chars();
    match c.next() {
        Some(f) => f.to_lowercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn outcome_of(v: &Value) -> String {
    opt_s(v, "outcome").map(|o| lower_first(&o)).unwrap_or_else(|| "unspecified".into())
}

fn run_info(v: &Value) -> RunInfo {
    RunInfo {
        name: opt_s(v, "name").unwrap_or_default(),
        is_automated: v.get("isAutomated").and_then(|x| x.as_bool()).unwrap_or(false),
        plan_id: id_of(v.get("plan").and_then(|p| p.get("id"))).filter(|x| *x > 0),
    }
}

fn summary_from(v: &Value, run_id: i64, run: &RunInfo) -> Option<ResultSummary> {
    let tc = v.get("testCase");
    Some(ResultSummary {
        run_id,
        run_name: if run.name.is_empty() { v.get("testRun").and_then(|r| opt_s(r, "name")).unwrap_or_default() } else { run.name.clone() },
        result_id: id_of(v.get("id"))?,
        test_case_id: id_of(tc.and_then(|t| t.get("id"))).unwrap_or(0),
        test_case_title: opt_s(v, "testCaseTitle").or_else(|| tc.and_then(|t| opt_s(t, "name"))).unwrap_or_default(),
        point_id: id_of(v.get("testPoint").and_then(|t| t.get("id"))).filter(|x| *x > 0),
        plan_id: run.plan_id.or_else(|| id_of(v.get("testPlan").and_then(|t| t.get("id"))).filter(|x| *x > 0)),
        outcome: outcome_of(v),
        completed_date: date(v, "completedDate"),
        duration_ms: ms(v.get("durationInMs")),
        configuration: v.get("configuration").and_then(|c| opt_s(c, "name")),
        // A result made by an automated test carries its name even when the run is not marked automated.
        is_automated: run.is_automated || opt_s(v, "automatedTestName").is_some(),
        run_by: v.get("runBy").and_then(|p| opt_s(p, "displayName")),
        error_message: opt_s(v, "errorMessage"),
    })
}

/// "00000002" → "2"; inside shared steps the ids follow each other ("0000000300000002") or are split by ";" → "3;2".
fn step_id_from_path(path: &str) -> String {
    let hex = |p: &str| i64::from_str_radix(p, 16).map(|n| n.to_string()).unwrap_or_else(|_| p.to_string());
    path.split(';')
        .flat_map(|part| {
            if part.len() > 8 && part.len() % 8 == 0 && part.is_ascii() {
                (0..part.len()).step_by(8).map(|i| hex(&part[i..i + 8])).collect::<Vec<_>>()
            } else {
                vec![hex(part)]
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn step_from(v: &Value) -> Option<StepResult> {
    let step_id = opt_s(v, "stepIdentifier").or_else(|| opt_s(v, "actionPath").map(|p| step_id_from_path(&p)))?;
    Some(StepResult {
        step_id,
        outcome: outcome_of(v),
        duration_ms: ms(v.get("durationInMs")),
        error_message: opt_s(v, "errorMessage"),
        comment: opt_s(v, "comment"),
    })
}

/// How the app can show a file, by its name.
pub fn kind_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => "image",
        "txt" | "log" | "json" | "xml" | "csv" | "md" | "yaml" | "yml" | "trx" | "out" | "err" => "text",
        _ => "file",
    }
}

fn attachment_from(v: &Value) -> Option<ResultAttachment> {
    let file_name = opt_s(v, "fileName").unwrap_or_else(|| "attachment".into());
    Some(ResultAttachment {
        id: id_of(v.get("id"))?,
        kind: kind_of(&file_name).to_string(),
        size: v.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
        comment: opt_s(v, "comment"),
        file_name,
    })
}

pub fn detail_from(v: &Value, run_id: i64, run: &Value, attachments: Result<Vec<ResultAttachment>, String>) -> Option<ResultDetail> {
    let info = run_info(run);
    let iterations = v.get("iterationDetails").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let steps = iterations
        .first()
        .and_then(|i| i.get("actionResults"))
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(step_from).collect())
        .unwrap_or_default();
    let (attachments, attachments_error) = match attachments {
        Ok(a) => (a, None),
        Err(e) => (vec![], Some(e)),
    };
    Some(ResultDetail {
        summary: summary_from(v, run_id, &info)?,
        stack_trace: opt_s(v, "stackTrace"),
        comment: opt_s(v, "comment"),
        automated_test_name: opt_s(v, "automatedTestName"),
        started_date: date(v, "startedDate"),
        steps,
        iterations: iterations.len(),
        attachments,
        attachments_error,
        run_url: opt_s(run, "webAccessUrl"),
    })
}

fn list(v: &Value, key: &str) -> Vec<Value> {
    v.get(key).and_then(|x| x.as_array()).cloned().unwrap_or_default()
}

async fn run_json(client: &AdoClient, project: &str, run_id: i64) -> AppResult<Value> {
    client.get(&client.url(&format!("/{}/_apis/test/runs/{run_id}", enc(project)))).await
}

/// Every result of one run, as raw JSON.
async fn run_results(client: &AdoClient, project: &str, run_id: i64) -> AppResult<Vec<Value>> {
    let p = enc(project);
    let mut out = Vec::new();
    loop {
        let page: Value = client.get(&client.url(&format!("/{p}/_apis/test/Runs/{run_id}/results?$top={RUN_PAGE}&$skip={}", out.len()))).await?;
        let got = list(&page, "value");
        let n = got.len();
        out.extend(got);
        if n < RUN_PAGE || out.len() >= RUN_PAGE * 20 {
            return Ok(out);
        }
    }
}

async fn attachments(client: &AdoClient, project: &str, run_id: i64, result_id: i64) -> AppResult<Vec<ResultAttachment>> {
    let v: Value = client.get(&client.url(&format!("/{}/_apis/test/Runs/{run_id}/Results/{result_id}/attachments", enc(project)))).await?;
    Ok(list(&v, "value").iter().filter_map(attachment_from).collect())
}

/// One result with its step results (first iteration) and attachment list.
pub async fn result(client: &AdoClient, project: &str, run_id: i64, result_id: i64) -> AppResult<ResultDetail> {
    let url = client.url(&format!("/{}/_apis/test/Runs/{run_id}/results/{result_id}?detailsToInclude=Iterations", enc(project)));
    let (res, run, files) = futures::join!(client.get::<Value>(&url), run_json(client, project, run_id), attachments(client, project, run_id, result_id));
    let res = res?;
    // The run only adds its name and how it was made; the result stands without it.
    let run = run.unwrap_or_else(|_| json!({}));
    detail_from(&res, run_id, &run, files.map_err(|e| e.message)).ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("Result {result_id} of run {run_id} was not found.")))
}

/// An attachment's bytes, as Azure DevOps only sends them for `Accept: application/octet-stream`.
pub async fn attachment(client: &AdoClient, project: &str, run_id: i64, result_id: i64, attachment_id: i64) -> AppResult<Vec<u8>> {
    let url = client.url(&format!("/{}/_apis/test/Runs/{run_id}/Results/{result_id}/attachments/{attachment_id}", enc(project)));
    let (_, bytes) = client.get_bytes_accepting(&url, "application/octet-stream").await?;
    if bytes.len() > MAX_ATTACHMENT {
        return Err(AppError::validation(format!("The attachment is larger than {} MB.", MAX_ATTACHMENT / 1024 / 1024)));
    }
    Ok(bytes)
}

/// Plans a test case has points in, and the last result each point recorded.
fn plans_and_last_results(points: &Value) -> (BTreeSet<i64>, Vec<(i64, i64)>) {
    let all = if points.get("points").is_some() { list(points, "points") } else { list(points, "value") };
    let mut plans = BTreeSet::new();
    let mut last = Vec::new();
    for p in &all {
        if let Some(plan) = id_of(p.get("testPlan").and_then(|t| t.get("id"))).filter(|x| *x > 0) {
            plans.insert(plan);
        }
        let run = id_of(p.get("lastTestRun").and_then(|r| r.get("id"))).filter(|x| *x > 0);
        let res = id_of(p.get("lastResult").and_then(|r| r.get("id"))).filter(|x| *x > 0);
        if let (Some(run), Some(res)) = (run, res) {
            last.push((run, res));
        }
    }
    (plans, last)
}

fn matches(r: &ResultSummary, q: &ResultQuery) -> bool {
    q.test_case_id.map_or(true, |id| r.test_case_id == id) && q.outcome.as_deref().map_or(true, |o| r.outcome.eq_ignore_ascii_case(o.trim()))
}

/// Newest first: by completion, then by run and result id (results still running have no date).
fn sort_newest(out: &mut [ResultSummary]) {
    out.sort_by(|a, b| b.completed_date.cmp(&a.completed_date).then(b.run_id.cmp(&a.run_id)).then(b.result_id.cmp(&a.result_id)));
}

/// Results of these runs that match, reading a few runs at a time, newest run first.
async fn scan(client: &AdoClient, project: &str, runs: &[(i64, RunInfo)], q: &ResultQuery) -> AppResult<Vec<ResultSummary>> {
    let pages: Vec<AppResult<Vec<ResultSummary>>> = stream::iter(runs.iter().cloned())
        .map(|(id, info)| async move {
            let raw = run_results(client, project, id).await?;
            Ok(raw.iter().filter_map(|v| summary_from(v, id, &info)).filter(|r| matches(r, q)).collect())
        })
        .buffered(PARALLEL)
        .collect()
        .await;
    let mut out = Vec::new();
    for p in pages {
        out.extend(p?);
    }
    Ok(out)
}

async fn plan_runs(client: &AdoClient, project: &str, plan: i64) -> AppResult<Vec<(i64, RunInfo)>> {
    Ok(runs(client, project, plan)
        .await?
        .iter()
        .take(RUN_SCAN)
        .map(|r| (r.id, RunInfo { plan_id: Some(plan), ..RunInfo::from(r) }))
        .collect())
}

/// A test case's results across the plans it is in, newest first. Reads the plans' latest runs, and
/// each point's last result even when its run is older than those.
async fn case_history(client: &AdoClient, project: &str, q: &ResultQuery, case_id: i64) -> AppResult<Vec<ResultSummary>> {
    let p = enc(project);
    let points: Value = client.post_json(&client.url(&format!("/{p}/_apis/test/points")), &json!({ "pointsFilter": { "testcaseIds": [case_id] } })).await?;
    let (mut plans, last) = plans_and_last_results(&points);
    if let Some(only) = q.plan_id {
        plans.retain(|x| *x == only);
    }
    let mut runs: Vec<(i64, RunInfo)> = Vec::new();
    for plan in plans {
        runs.extend(plan_runs(client, project, plan).await?);
    }
    runs.sort_by(|a, b| b.0.cmp(&a.0));
    runs.dedup_by_key(|r| r.0);
    // Newest runs first, a few at a time, until there are enough results.
    let mut out = Vec::new();
    for chunk in runs.chunks(PARALLEL) {
        out.extend(scan(client, project, chunk, q).await?);
        if out.len() >= q.limit.max(1) {
            break;
        }
    }
    let read: BTreeSet<i64> = runs.iter().map(|r| r.0).collect();
    for (run, res) in last.into_iter().filter(|(run, _)| !read.contains(run)) {
        let url = client.url(&format!("/{p}/_apis/test/Runs/{run}/results/{res}"));
        let (v, info) = futures::join!(client.get::<Value>(&url), run_json(client, project, run));
        let info = info.map(|i| run_info(&i)).unwrap_or_default();
        if let Some(r) = summary_from(&v?, run, &info).filter(|r| matches(r, q) && q.plan_id.map_or(true, |only| r.plan_id.map_or(true, |x| x == only))) {
            out.push(r);
        }
    }
    let mut seen = BTreeSet::new();
    out.retain(|r| seen.insert((r.run_id, r.result_id)));
    Ok(out)
}

/// Results by test case, plan or run, newest first, at most `limit`.
pub async fn list_results(client: &AdoClient, project: &str, q: &ResultQuery) -> AppResult<Vec<ResultSummary>> {
    let mut out = if let Some(run) = q.run_id {
        let info = run_info(&run_json(client, project, run).await?);
        run_results(client, project, run).await?.iter().filter_map(|v| summary_from(v, run, &info)).filter(|r| matches(r, q)).collect()
    } else if let Some(case) = q.test_case_id {
        case_history(client, project, q, case).await?
    } else if let Some(plan) = q.plan_id {
        let runs = plan_runs(client, project, plan).await?;
        let mut out = Vec::new();
        // A run at a time in batches, so a plan with many runs stops once there are enough results.
        for chunk in runs.chunks(PARALLEL) {
            out.extend(scan(client, project, chunk, q).await?);
            if out.len() >= q.limit {
                break;
            }
        }
        out
    } else {
        return Err(AppError::validation("Give a test case, plan or run ID."));
    };
    sort_newest(&mut out);
    out.truncate(q.limit.max(1));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_203() -> Value {
        json!({ "id": 203, "name": "Playwright · login", "state": "Completed", "isAutomated": true, "plan": { "id": "5383" }, "webAccessUrl": "https://dev.azure.com/dxdhub/AI%20Scoliosis/_TestManagement/Runs?runId=203" })
    }

    fn failed_result() -> Value {
        json!({
            "id": 100001, "outcome": "Failed", "durationInMs": 5321.0,
            "testCase": { "id": "5376", "name": "Admin sees their profile" }, "testCaseTitle": "Admin sees their profile",
            "testPoint": { "id": "9001" }, "configuration": { "id": "3", "name": "Windows 10" },
            "completedDate": "2026-10-27T09:15:00Z", "startedDate": "2026-10-27T09:14:54Z",
            "errorMessage": "expected value \"QA Administrator\" to be \"qa-admin@example.com\"",
            "stackTrace": "Error: expected…\n    at login.spec.ts:42:7",
            "automatedTestName": "login › admin profile",
            "iterationDetails": [{ "id": 1, "outcome": "Failed", "actionResults": [
                { "actionPath": "00000002", "stepIdentifier": "2", "outcome": "Failed", "errorMessage": "expected value \"QA Administrator\" to be \"qa-admin@example.com\"", "durationInMs": 5000.0 },
                { "actionPath": "00000003", "stepIdentifier": "3", "outcome": "NotExecuted" }
            ] }]
        })
    }

    #[test]
    fn reads_a_failed_result_with_steps_and_attachments() {
        let files = vec![attachment_from(&json!({ "id": 11, "fileName": "1-screenshot.png", "size": 234900 })).unwrap(), attachment_from(&json!({ "id": 12, "fileName": "2-app-log.txt", "size": 812 })).unwrap()];
        let d = detail_from(&failed_result(), 203, &run_203(), Ok(files)).unwrap();
        assert_eq!((d.summary.outcome.as_str(), d.summary.test_case_id, d.summary.plan_id, d.summary.duration_ms), ("failed", 5376, Some(5383), Some(5321)));
        assert_eq!((d.summary.run_name.as_str(), d.summary.configuration.as_deref(), d.summary.is_automated), ("Playwright · login", Some("Windows 10"), true));
        assert_eq!(d.steps.len(), 2);
        assert_eq!((d.steps[0].step_id.as_str(), d.steps[0].outcome.as_str(), d.steps[0].duration_ms), ("2", "failed", Some(5000)));
        assert!(d.steps[0].error_message.as_deref().unwrap().contains("qa-admin@example.com"));
        assert_eq!((d.steps[1].step_id.as_str(), d.steps[1].outcome.as_str()), ("3", "notExecuted"));
        assert_eq!((d.attachments[0].kind.as_str(), d.attachments[0].size), ("image", 234900));
        assert_eq!(d.attachments[1].kind, "text");
        assert!(d.run_url.unwrap().contains("runId=203"));
    }

    #[test]
    fn a_result_without_iterations_or_attachments_still_reads() {
        let v = json!({ "id": 5, "outcome": "Passed", "testCase": { "id": 5376 }, "testRun": { "name": "Manual run" } });
        let d = detail_from(&v, 201, &json!({}), Err("TF400813".into())).unwrap();
        assert_eq!((d.summary.run_name.as_str(), d.summary.is_automated, d.iterations), ("Manual run", false, 0));
        assert!(d.steps.is_empty() && d.attachments.is_empty());
        assert_eq!(d.attachments_error.as_deref(), Some("TF400813"));
        assert_eq!(d.summary.point_id, None);
    }

    #[test]
    fn step_ids_come_from_the_action_path_when_missing() {
        assert_eq!(step_id_from_path("00000002"), "2");
        assert_eq!(step_id_from_path("0000000A;00000003"), "10;3");
        assert_eq!(step_id_from_path("0000000300000005"), "3;5");
        let s = step_from(&json!({ "actionPath": "0000000b", "outcome": "Passed" })).unwrap();
        assert_eq!(s.step_id, "11");
        assert!(step_from(&json!({ "outcome": "Passed" })).is_none());
    }

    #[test]
    fn files_are_shown_by_their_name() {
        assert_eq!(kind_of("1-screenshot.PNG"), "image");
        assert_eq!(kind_of("3-inference-2026.log"), "text");
        assert_eq!(kind_of("trace.zip"), "file");
        assert_eq!(kind_of("README"), "file");
    }

    #[test]
    fn points_name_their_plans_and_last_results() {
        let v = json!({ "points": [
            { "id": 1, "testPlan": { "id": "5383" }, "lastTestRun": { "id": "203" }, "lastResult": { "id": "100001" } },
            { "id": 2, "testPlan": { "id": "5383" }, "lastTestRun": { "id": "0" }, "lastResult": { "id": "0" } },
            { "id": 3, "testPlan": { "id": 77 } }
        ] });
        let (plans, last) = plans_and_last_results(&v);
        assert_eq!(plans.into_iter().collect::<Vec<_>>(), vec![77, 5383]);
        assert_eq!(last, vec![(203, 100001)]);
    }

    #[test]
    fn results_filter_by_case_and_outcome_and_sort_newest_first() {
        let info = RunInfo { name: "r".into(), is_automated: false, plan_id: Some(1) };
        let mk = |id: i64, run: i64, case: i64, outcome: &str, date: Option<&str>| summary_from(&json!({ "id": id, "outcome": outcome, "testCase": { "id": case }, "completedDate": date }), run, &info).unwrap();
        let q = ResultQuery { test_case_id: Some(5376), outcome: Some("FAILED".into()), limit: 10, ..Default::default() };
        assert!(matches(&mk(1, 203, 5376, "Failed", None), &q));
        assert!(!matches(&mk(1, 201, 5376, "Passed", None), &q));
        assert!(!matches(&mk(1, 203, 99, "Failed", None), &q));
        let mut v = vec![mk(1, 201, 5376, "Passed", Some("2026-10-26T00:00:00Z")), mk(2, 203, 5376, "Failed", Some("2026-10-27T00:00:00Z")), mk(3, 204, 5376, "Failed", Some("0001-01-01T00:00:00"))];
        sort_newest(&mut v);
        assert_eq!(v.iter().map(|r| r.run_id).collect::<Vec<_>>(), vec![203, 201, 204]);
    }
}
