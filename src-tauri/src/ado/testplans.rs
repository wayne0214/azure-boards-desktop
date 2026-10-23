//! Copies a run recorded in Test Cases' Run mode to the project's test plan in Azure Test Plans, tagged with the
//! version, when the test case has a single point in it. The run is always recorded on the test case first.

use crate::ado::client::{enc, AdoClient};
use crate::ado::plans::{publish_run, PointResult, RunFile, RunInput};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorInput {
    /// The project's test plan, chosen by the app; none means there is nowhere to copy to.
    #[serde(default)]
    pub plan_id: Option<i64>,
    /// The version tested; it becomes the run's build number.
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



/// What became of a run copied to Test Plans.
enum Mirrored {
    Yes,
    /// No plan for the release: nothing to copy to, and nothing worth reporting.
    NoPlan,
    /// The plan exists but the run could not go to one clear point.
    Skipped(String),
}

/// The one point a run can go to, or why there is none: Run mode does not know the configuration.
pub fn choose_point(points: &[(i64, String)]) -> Result<i64, String> {
    match points {
        [] => Err("This test case is not in the project's test plan.".to_string()),
        [(id, _)] => Ok(*id),
        many => {
            let mut names: Vec<&str> = many.iter().map(|(_, c)| c.as_str()).filter(|c| !c.is_empty()).collect();
            names.sort_unstable();
            names.dedup();
            Err(format!("It has {} test points in the plan{}; run it in Test Plans to choose one.", many.len(), if names.is_empty() { String::new() } else { format!(" ({})", names.join(", ")) }))
        }
    }
}

/// The test case's points in one plan, as (point id, configuration name).
async fn points_in_plan(client: &AdoClient, p: &str, plan: i64, test_case_id: i64) -> AppResult<Vec<(i64, String)>> {
    let suites: Value = client.get(&client.url(&format!("/_apis/testplan/suites?testCaseId={test_case_id}"))).await?;
    let in_plan: Vec<i64> = suites
        .get("value")
        .and_then(|v| v.as_array())
        .map(|list| list.iter().filter(|s| s.get("plan").and_then(|x| x.get("id")).and_then(|x| x.as_i64()) == Some(plan)).filter_map(|s| s.get("id")?.as_i64()).collect())
        .unwrap_or_default();
    let mut out = Vec::new();
    for suite in in_plan {
        let points: Value = client.get(&client.url(&format!("/{p}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestPoint?testCaseId={test_case_id}"))).await?;
        for pt in points.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            if let Some(id) = pt.get("id").and_then(|x| x.as_i64()) {
                let cfg = pt.get("configuration").and_then(|c| c.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                out.push((id, cfg));
            }
        }
    }
    Ok(out)
}

async fn mirror(client: &AdoClient, project: &str, input: &MirrorInput) -> AppResult<Mirrored> {
    let p = enc(project);
    // Plans are made on purpose in Test Plans, with their suites and configurations; Run mode only adds to one.
    let Some(plan) = input.plan_id else { return Ok(Mirrored::NoPlan) };
    let point = match choose_point(&points_in_plan(client, &p, plan, input.test_case_id).await?) {
        Ok(id) => id,
        Err(why) => return Ok(Mirrored::Skipped(why)),
    };
    let run = RunInput {
        plan_id: plan,
        name: format!("SDV run {}", input.release),
        automated: false,
        build_number: Some(input.release.clone()),
        results: vec![PointResult {
            point_id: point,
            outcome: input.outcome.clone(),
            comment: Some(input.comment.clone()),
            error_message: None,
            stack_trace: None,
            duration_ms: None,
            automated_test_name: None,
            automated_test_storage: None,
            attachments: input.attachments.iter().map(|f| RunFile { name: f.name.clone(), data_base64: f.data_base64.clone() }).collect(),
        }],
    };
    publish_run(client, project, &run).await?;
    Ok(Mirrored::Yes)
}

/// Mirror one run. Never an error to the caller: a refusal or failure comes back as a reason.
pub async fn mirror_result(client: &AdoClient, project: &str, input: &MirrorInput) -> MirrorResult {
    match mirror(client, project, input).await {
        Ok(Mirrored::Yes) => MirrorResult { mirrored: true, reason: None },
        Ok(Mirrored::NoPlan) => MirrorResult { mirrored: false, reason: None },
        Ok(Mirrored::Skipped(why)) => MirrorResult { mirrored: false, reason: Some(why) },
        Err(e) if is_access_refusal(e.status.unwrap_or(0), &e.message) => MirrorResult { mirrored: false, reason: Some("No Test Plans access".into()) },
        Err(e) => MirrorResult { mirrored: false, reason: Some(e.message) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn a_run_goes_only_to_a_single_point() {
        assert_eq!(choose_point(&[(5, "macOS".into())]), Ok(5));
        assert_eq!(choose_point(&[]).unwrap_err(), "This test case is not in the project's test plan.");
        let many = choose_point(&[(5, "macOS".into()), (6, "Windows 11".into()), (7, "macOS".into())]).unwrap_err();
        assert_eq!(many, "It has 3 test points in the plan (Windows 11, macOS); run it in Test Plans to choose one.");
    }

}
