use crate::ado::plans::{self, CreatedPlan, NewPlan, NewSuite, PointUpdate, RunInput, RunOutcome, TpConfiguration, TpPlan, TpPoint, TpResult, TpRun, TpSuite};
use crate::ado::results::{self, ResultDetail, ResultQuery, ResultSummary};
use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn tp_plans(state: State<'_, AppState>, org: String, project: String, active_only: Option<bool>) -> AppResult<Vec<TpPlan>> {
    let c = state.client(&org).await?;
    plans::plans(&c, &project, active_only.unwrap_or(false)).await
}

#[tauri::command]
pub async fn tp_create_plan(state: State<'_, AppState>, org: String, project: String, input: NewPlan) -> AppResult<CreatedPlan> {
    let c = state.client(&org).await?;
    plans::create_plan(&c, &project, &input).await
}

#[tauri::command]
pub async fn tp_suites(state: State<'_, AppState>, org: String, project: String, plan_id: i64) -> AppResult<Vec<TpSuite>> {
    let c = state.client(&org).await?;
    plans::suites(&c, &project, plan_id).await
}

#[tauri::command]
pub async fn tp_create_suite(state: State<'_, AppState>, org: String, project: String, plan_id: i64, input: NewSuite) -> AppResult<TpSuite> {
    let c = state.client(&org).await?;
    plans::create_suite(&c, &project, plan_id, &input).await
}

#[tauri::command]
pub async fn tp_add_cases(state: State<'_, AppState>, org: String, project: String, plan_id: i64, suite_id: i64, ids: Vec<i64>, configuration_ids: Option<Vec<i64>>) -> AppResult<()> {
    let c = state.client(&org).await?;
    plans::add_cases(&c, &project, plan_id, suite_id, &ids, &configuration_ids.unwrap_or_default()).await
}

#[tauri::command]
pub async fn tp_remove_cases(state: State<'_, AppState>, org: String, project: String, plan_id: i64, suite_id: i64, ids: Vec<i64>) -> AppResult<()> {
    let c = state.client(&org).await?;
    plans::remove_cases(&c, &project, plan_id, suite_id, &ids).await
}

#[tauri::command]
pub async fn tp_configurations(state: State<'_, AppState>, org: String, project: String) -> AppResult<Vec<TpConfiguration>> {
    let c = state.client(&org).await?;
    plans::configurations(&c, &project).await
}

#[tauri::command]
pub async fn tp_points(state: State<'_, AppState>, org: String, project: String, plan_id: i64, suite_id: i64) -> AppResult<Vec<TpPoint>> {
    let c = state.client(&org).await?;
    plans::points(&c, &project, plan_id, suite_id).await
}

#[tauri::command]
pub async fn tp_update_points(state: State<'_, AppState>, org: String, project: String, plan_id: i64, suite_id: i64, updates: Vec<PointUpdate>) -> AppResult<Vec<TpPoint>> {
    let c = state.client(&org).await?;
    plans::update_points(&c, &project, plan_id, suite_id, &updates).await
}

#[tauri::command]
pub async fn tp_publish_run(state: State<'_, AppState>, org: String, project: String, input: RunInput) -> AppResult<RunOutcome> {
    let c = state.client(&org).await?;
    plans::publish_run(&c, &project, &input).await
}

#[tauri::command]
pub async fn tp_runs(state: State<'_, AppState>, org: String, project: String, plan_id: i64) -> AppResult<Vec<TpRun>> {
    let c = state.client(&org).await?;
    plans::runs(&c, &project, plan_id).await
}

#[tauri::command]
pub async fn tp_run_results(state: State<'_, AppState>, org: String, project: String, run_ids: Vec<i64>) -> AppResult<Vec<TpResult>> {
    let c = state.client(&org).await?;
    plans::results_of_runs(&c, &project, &run_ids).await
}

#[tauri::command]
pub async fn tp_set_plan_state(state: State<'_, AppState>, org: String, project: String, plan_id: i64, plan_state: String) -> AppResult<TpPlan> {
    let c = state.client(&org).await?;
    plans::set_plan_state(&c, &project, plan_id, &plan_state).await
}

#[tauri::command]
pub async fn tp_list_results(state: State<'_, AppState>, org: String, project: String, query: ResultQuery) -> AppResult<Vec<ResultSummary>> {
    let c = state.client(&org).await?;
    let limit = if query.limit == 0 { 50 } else { query.limit.min(500) };
    results::list_results(&c, &project, &ResultQuery { limit, ..query }).await
}

#[tauri::command]
pub async fn tp_result(state: State<'_, AppState>, org: String, project: String, run_id: i64, result_id: i64) -> AppResult<ResultDetail> {
    let c = state.client(&org).await?;
    results::result(&c, &project, run_id, result_id).await
}

/// An attachment's bytes as base64; the UI shows images and text and saves the rest.
#[tauri::command]
pub async fn tp_result_attachment(state: State<'_, AppState>, org: String, project: String, run_id: i64, result_id: i64, attachment_id: i64) -> AppResult<String> {
    use base64::Engine;
    let c = state.client(&org).await?;
    let bytes = results::attachment(&c, &project, run_id, result_id, attachment_id).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Download an attachment straight to a path the user picked in the save dialog.
#[tauri::command]
pub async fn tp_save_result_attachment(state: State<'_, AppState>, org: String, project: String, run_id: i64, result_id: i64, attachment_id: i64, path: String) -> AppResult<()> {
    state.check_path(std::path::Path::new(&path))?;
    let c = state.client(&org).await?;
    let bytes = results::attachment(&c, &project, run_id, result_id, attachment_id).await?;
    std::fs::write(&path, bytes)?;
    Ok(())
}
