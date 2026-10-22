//! Mirrors a recorded test run to Azure Test Plans, for users whose access level includes it.
//! The run is always recorded on the test case first; anything refused here is only reported.

use crate::ado::client::{enc, AdoClient};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Most plans read while looking for the release plan.
const PLAN_CAP: usize = 5000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorInput {
    pub release: String,
    pub test_case_id: i64,
    /// "Passed" or "Failed".
    pub outcome: String,
    pub comment: String,
    pub attachments: Vec<MirrorFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorFile {
    pub name: String,
    pub data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorResult {
    pub mirrored: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Azure DevOps refusing Test Plans to this user (access level or permissions), as opposed to a real failure.
pub fn is_access_refusal(status: u16, body: &str) -> bool {
    if status == 401 || status == 403 {
        return true;
    }
    let b = body.to_lowercase();
    b.contains("tf400813") || b.contains("not authorized") || (b.contains("license") && b.contains("test plans")) || b.contains("access level")
}

/// The plan named "Release {release}" and its root suite.
pub fn plan_for(plans: &Value, release: &str) -> Option<(i64, i64)> {
    let name = format!("Release {release}");
    plans.get("value")?.as_array()?.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name.as_str())).and_then(|p| {
        Some((p.get("id")?.as_i64()?, p.get("rootSuite")?.get("id")?.as_i64()?))
    })
}

fn first_id(v: &Value) -> Option<i64> {
    v.get("value")?.as_array()?.first()?.get("id")?.as_i64()
}

/// Every test plan in the project, following the continuation token, as `{ "value": [...] }`.
async fn all_plans(client: &AdoClient, p: &str) -> AppResult<Value> {
    let base = format!("/{p}/_apis/testplan/plans");
    let mut plans: Vec<Value> = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let path = match &token {
            Some(t) => format!("{base}?continuationToken={}", enc(t)),
            None => base.clone(),
        };
        let (page, next): (Value, Option<String>) = client.get_page(&client.url(&path)).await?;
        plans.extend(page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default());
        match next {
            Some(n) if plans.len() < PLAN_CAP && token.as_deref() != Some(n.as_str()) => token = Some(n),
            _ => return Ok(json!({ "value": plans })),
        }
    }
}

async fn mirror(client: &AdoClient, project: &str, input: &MirrorInput) -> AppResult<()> {
    let p = enc(project);
    let plans = all_plans(client, &p).await?;
    let (plan, suite) = match plan_for(&plans, &input.release) {
        Some(x) => x,
        None => {
            let created: Value = client
                .post_json(&client.url(&format!("/{p}/_apis/testplan/plans")), &json!({ "name": format!("Release {}", input.release), "areaPath": project, "iteration": project }))
                .await?;
            let id = created.get("id").and_then(|x| x.as_i64()).ok_or_else(|| AppError::internal("Test Plans did not return the new plan's id."))?;
            let root = created
                .get("rootSuite")
                .and_then(|r| r.get("id"))
                .and_then(|x| x.as_i64())
                .ok_or_else(|| AppError::internal("Test Plans did not return the new plan's root suite."))?;
            (id, root)
        }
    };
    let add = client
        .post_json::<Value>(&client.url(&format!("/{p}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestCase")), &json!([{ "workItem": { "id": input.test_case_id } }]))
        .await;
    // Adding a test case that is already in the suite is fine.
    if let Err(e) = add {
        if !e.message.to_lowercase().contains("already") {
            return Err(e);
        }
    }
    let points: Value = client.get(&client.url(&format!("/{p}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestPoint?testCaseId={}", input.test_case_id))).await?;
    let point = first_id(&points).ok_or_else(|| AppError::internal("Test Plans has no test point for this test case."))?;
    let run: Value = client
        .post_json(&client.url(&format!("/{p}/_apis/test/runs")), &json!({ "name": format!("SDV run {}", input.release), "plan": { "id": plan.to_string() }, "pointIds": [point], "automated": false }))
        .await?;
    let run_id = run.get("id").and_then(|x| x.as_i64()).ok_or_else(|| AppError::internal("Test Plans did not return the new run's id."))?;
    if let Err(e) = record_run(client, &p, run_id, input).await {
        // Leave no half-finished run behind; the original failure is what the caller sees.
        let _: AppResult<Value> = client.patch_json(&client.url(&format!("/{p}/_apis/test/runs/{run_id}")), &json!({ "state": "Aborted" })).await;
        return Err(e);
    }
    Ok(())
}

/// Sets the outcome, attaches the files and completes a freshly created run.
async fn record_run(client: &AdoClient, p: &str, run_id: i64, input: &MirrorInput) -> AppResult<()> {
    let results: Value = client.get(&client.url(&format!("/{p}/_apis/test/Runs/{run_id}/results"))).await?;
    let result_id = first_id(&results).ok_or_else(|| AppError::internal("Test Plans created no result for the run."))?;
    let _: Value = client
        .patch_json(&client.url(&format!("/{p}/_apis/test/Runs/{run_id}/results")), &json!([{ "id": result_id, "outcome": input.outcome, "state": "Completed", "comment": input.comment }]))
        .await?;
    for f in &input.attachments {
        let _: Value = client
            .post_json(&client.url(&format!("/{p}/_apis/test/Runs/{run_id}/Results/{result_id}/attachments")), &json!({ "stream": f.data_base64, "fileName": f.name, "attachmentType": "GeneralAttachment" }))
            .await?;
    }
    let _: Value = client.patch_json(&client.url(&format!("/{p}/_apis/test/runs/{run_id}")), &json!({ "state": "Completed" })).await?;
    Ok(())
}

/// Mirror one run. Never an error to the caller: a refusal or failure comes back as a reason.
pub async fn mirror_result(client: &AdoClient, project: &str, input: &MirrorInput) -> MirrorResult {
    match mirror(client, project, input).await {
        Ok(()) => MirrorResult { mirrored: true, reason: None },
        Err(e) if is_access_refusal(e.status.unwrap_or(0), &e.message) => MirrorResult { mirrored: false, reason: Some("No Test Plans access".into()) },
        Err(e) => MirrorResult { mirrored: false, reason: Some(e.message) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn refusals_are_recognised() {
        assert!(is_access_refusal(403, ""));
        assert!(is_access_refusal(401, ""));
        assert!(is_access_refusal(400, "TF400813: The user 'x' is not authorized to access this resource."));
        assert!(is_access_refusal(400, "You do not have the license required to use Test Plans."));
        assert!(!is_access_refusal(500, "timeout"));
        assert!(!is_access_refusal(400, "The test case is not in the suite."));
    }

    #[test]
    fn finds_the_release_plan_by_name() {
        let plans = json!({ "value": [{ "id": 3, "name": "Release v2.0", "rootSuite": { "id": 30 } }, { "id": 7, "name": "Release v2.1.0 RC1", "rootSuite": { "id": 70 } }] });
        assert_eq!(plan_for(&plans, "v2.1.0 RC1"), Some((7, 70)));
        assert_eq!(plan_for(&plans, "v9"), None);
    }
}
