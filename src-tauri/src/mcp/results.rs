//! Test result tools: AI tools read what happened when test cases ran (outcome, failing step and error,
//! screenshots and logs). Read-only; a Bug from a failed result is made with create_work_item.

use super::steps::{self, Step, STEPS_FIELD};
use super::tools::{field, tool};
use crate::ado::client::AdoClient;
use crate::ado::results::{self, ResultQuery, StepResult};
use crate::error::AppError;
use serde_json::{json, Value};
use std::path::PathBuf;

const MAX_LIMIT: usize = 200;

pub fn definitions() -> Vec<Value> {
    let project = json!({ "type": "string", "description": "Project name; omit for the current project" });
    vec![
        tool("list_test_results", "Results of test runs from Azure Test Plans (automated and manual), newest first: run, date, outcome, configuration, error. Give a test case, plan or run ID. Open one with get_test_result.", json!({
            "testCaseId": { "type": "integer", "description": "Test Case work item ID: its run history across the plans it is in" },
            "planId": { "type": "integer" },
            "runId": { "type": "integer" },
            "outcome": { "type": "string", "description": "Only this outcome, e.g. \"Failed\", \"Passed\", \"NotExecuted\"" },
            "limit": { "type": "integer", "description": "At most this many (default 20, up to 200)" },
            "project": project,
        }), &[], true),
        tool("get_test_result", "One test result as recorded: outcome, duration, error and stack trace, each step of the test case (action, expected) with its outcome and error, and the attachment list (screenshots, logs). Fetch a file with get_test_attachment.", json!({
            "runId": { "type": "integer" },
            "resultId": { "type": "integer" },
            "project": project,
        }), &["runId", "resultId"], true),
        tool("get_test_attachment", "Save a test result's attachment (e.g. a failure screenshot or a log) to a local file and return its path, to read or look at.", json!({
            "runId": { "type": "integer" },
            "resultId": { "type": "integer" },
            "attachmentId": { "type": "integer", "description": "From get_test_result's attachments" },
            "project": project,
        }), &["runId", "resultId", "attachmentId"], true),
    ]
}

pub fn handles(name: &str) -> bool {
    matches!(name, "list_test_results" | "get_test_result" | "get_test_attachment")
}

fn int(args: &Value, key: &str) -> Option<i64> {
    args.get(key).and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().trim_start_matches('#').parse().ok())))
}

fn need(args: &Value, key: &str) -> Result<i64, AppError> {
    int(args, key).ok_or_else(|| AppError::validation(format!("`{key}` is required.")))
}

pub async fn call(client: &AdoClient, project: Option<String>, name: &str, args: &Value) -> Result<Value, AppError> {
    let project = super::tools::str_arg(args, "project").filter(|p| !p.trim().is_empty()).or(project).ok_or_else(|| AppError::validation("No project is open in Boards; pass `project`."))?;
    match name {
        "list_test_results" => {
            let q = ResultQuery {
                test_case_id: int(args, "testCaseId"),
                plan_id: int(args, "planId"),
                run_id: int(args, "runId"),
                outcome: super::tools::str_arg(args, "outcome").filter(|o| !o.trim().is_empty()),
                limit: int(args, "limit").map(|n| n.clamp(1, MAX_LIMIT as i64) as usize).unwrap_or(20),
            };
            let list = results::list_results(client, &project, &q).await?;
            Ok(json!({ "count": list.len(), "results": list }))
        }
        "get_test_result" => {
            let d = results::result(client, &project, need(args, "runId")?, need(args, "resultId")?).await?;
            let case_steps = if d.summary.test_case_id > 0 {
                let item: Value = client.get(&client.url(&format!("/_apis/wit/workitems/{}?fields={STEPS_FIELD}", d.summary.test_case_id))).await.unwrap_or(Value::Null);
                field(&item, STEPS_FIELD).and_then(|v| v.as_str()).map(steps::parse_with_ids).unwrap_or_default()
            } else {
                vec![]
            };
            let mut out = serde_json::to_value(&d).map_err(|e| AppError::validation(e.to_string()))?;
            out["steps"] = json!(join_steps(&case_steps, &d.steps));
            Ok(out)
        }
        "get_test_attachment" => {
            let (run, res, id) = (need(args, "runId")?, need(args, "resultId")?, need(args, "attachmentId")?);
            let detail = results::result(client, &project, run, res).await?;
            let file = detail.attachments.iter().find(|a| a.id == id).ok_or_else(|| AppError::validation(format!("Result {res} of run {run} has no attachment {id}.")))?;
            let bytes = results::attachment(client, &project, run, res, id).await?;
            let path = save(run, res, id, &file.file_name, &bytes)?;
            Ok(json!({ "path": path.to_string_lossy(), "fileName": file.file_name, "size": bytes.len(), "kind": file.kind }))
        }
        other => Err(AppError::validation(format!("Unknown tool: {other}"))),
    }
}

/// A file name that is safe to write: no folders, nothing hidden.
fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' }).collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() { "attachment".into() } else { clean }
}

fn save(run: i64, res: i64, id: i64, name: &str, bytes: &[u8]) -> Result<PathBuf, AppError> {
    let dir = std::env::temp_dir().join("boards-test-attachments");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::validation(format!("Could not save the attachment: {e}")))?;
    let path = dir.join(format!("{run}-{res}-{id}-{}", safe_name(name)));
    // A fresh file, never one already there: a planted link in a shared temp folder must not redirect the write.
    let _ = std::fs::remove_file(&path);
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| AppError::validation(format!("Could not save the attachment: {e}")))?;
    std::io::Write::write_all(&mut file, bytes).map_err(|e| AppError::validation(format!("Could not save the attachment: {e}")))?;
    Ok(path)
}

/// The test case's steps in order, each with its recorded result. A step without one says so; step
/// results the test case no longer has (it changed since the run) follow at the end.
pub fn join_steps(case_steps: &[(Option<String>, Step)], recorded: &[StepResult]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut used = vec![false; recorded.len()];
    for (n, (id, step)) in case_steps.iter().enumerate() {
        let hit = id.as_ref().and_then(|id| recorded.iter().position(|r| &r.step_id == id));
        if let Some(i) = hit {
            used[i] = true;
        }
        let r = hit.map(|i| &recorded[i]);
        let mut row = match step {
            Step::Step { action, expected } => json!({ "step": n + 1, "stepId": id, "action": action, "expected": expected }),
            Step::Shared(wi) => json!({ "step": n + 1, "stepId": id, "sharedSteps": wi, "note": "Steps inside shared steps are in that work item." }),
        };
        match r {
            Some(r) => {
                row["outcome"] = json!(r.outcome);
                if let Some(d) = r.duration_ms {
                    row["durationMs"] = json!(d);
                }
                if let Some(e) = &r.error_message {
                    row["errorMessage"] = json!(e);
                }
                if let Some(c) = &r.comment {
                    row["comment"] = json!(c);
                }
            }
            None => row["outcome"] = json!("noResultRecorded"),
        }
        out.push(row);
    }
    for (r, _) in recorded.iter().zip(used).filter(|(_, u)| !u) {
        out.push(json!({ "stepId": r.step_id, "outcome": r.outcome, "durationMs": r.duration_ms, "errorMessage": r.error_message, "note": "Not a step of the test case now (inside shared steps, or removed since the run)." }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(id: &str, outcome: &str, err: Option<&str>) -> StepResult {
        StepResult { step_id: id.into(), outcome: outcome.into(), duration_ms: None, error_message: err.map(str::to_string), comment: None }
    }

    #[test]
    fn steps_meet_their_results() {
        let case = vec![
            (Some("1".to_string()), Step::Step { action: "Open the app".into(), expected: String::new() }),
            (Some("2".to_string()), Step::Step { action: "Sign in as QA admin".into(), expected: "Profile shows the email".into() }),
            (Some("3".to_string()), Step::Step { action: "Sign out".into(), expected: String::new() }),
            (Some("4".to_string()), Step::Shared(812)),
        ];
        let recorded = vec![rec("2", "failed", Some("expected value \"QA Administrator\"")), rec("3", "notExecuted", None), rec("4;1", "passed", None)];
        let rows = join_steps(&case, &recorded);
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0]["outcome"], "noResultRecorded");
        assert_eq!((rows[1]["outcome"].as_str(), rows[1]["expected"].as_str()), (Some("failed"), Some("Profile shows the email")));
        assert!(rows[1]["errorMessage"].as_str().unwrap().contains("QA Administrator"));
        assert_eq!(rows[2]["outcome"], "notExecuted");
        assert_eq!(rows[3]["sharedSteps"], 812);
        assert_eq!((rows[4]["stepId"].as_str(), rows[4]["outcome"].as_str()), (Some("4;1"), Some("passed")));
    }

    #[test]
    fn saved_names_stay_in_their_folder() {
        assert_eq!(safe_name("1-screenshot.png"), "1-screenshot.png");
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("..\\x\\.hidden"), "hidden");
        assert_eq!(safe_name("a:b*c.log"), "a_b_c.log");
        assert_eq!(safe_name(""), "attachment");
    }
}
