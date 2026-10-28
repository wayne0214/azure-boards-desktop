use crate::ado::pr;
use crate::error::AppResult;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn pr_list_repos(state: State<'_, AppState>, org: String, project: String) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    pr::list_repos(&c, &project).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pr_list(
    state: State<'_, AppState>,
    org: String,
    project: String,
    status: String,
    creator_id: Option<String>,
    reviewer_id: Option<String>,
    repo_id: Option<String>,
    top: Option<u32>,
) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    pr::list_prs(&c, &project, &status, creator_id.as_deref(), reviewer_id.as_deref(), repo_id.as_deref(), top.unwrap_or(100)).await
}

#[tauri::command]
pub async fn pr_get(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::get_pr(&c, &repo_id, pr_id).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetail {
    pub pr: Value,
    pub iterations: Vec<Value>,
    pub threads: Vec<Value>,
    pub commits: Vec<Value>,
    pub work_items: Vec<Value>,
    pub statuses: Vec<Value>,
    pub policies: Vec<Value>,
}

#[tauri::command]
pub async fn pr_detail(state: State<'_, AppState>, org: String, project_id: String, repo_id: String, pr_id: i64) -> AppResult<PrDetail> {
    let c = state.client(&org).await?;
    let (pr, iterations, threads, commits, work_items, statuses, policies) = tokio::join!(
        pr::get_pr(&c, &repo_id, pr_id),
        pr::pr_iterations(&c, &repo_id, pr_id),
        pr::pr_threads(&c, &repo_id, pr_id),
        pr::pr_commits(&c, &repo_id, pr_id),
        pr::pr_work_items(&c, &repo_id, pr_id),
        pr::pr_statuses(&c, &repo_id, pr_id),
        pr::policy_evaluations(&c, &project_id, pr_id),
    );
    Ok(PrDetail {
        pr: pr?,
        iterations: iterations.unwrap_or_default(),
        threads: threads.unwrap_or_default(),
        commits: commits.unwrap_or_default(),
        work_items: work_items.unwrap_or_default(),
        statuses: statuses.unwrap_or_default(),
        policies: policies.unwrap_or_default(),
    })
}

/// Ids of the work items linked to a pull request.
#[tauri::command]
pub async fn pr_work_item_ids(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64) -> AppResult<Vec<i64>> {
    let c = state.client(&org).await?;
    let refs = pr::pr_work_items(&c, &repo_id, pr_id).await?;
    Ok(refs
        .iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64())))
        .collect())
}

/// Work items a new pull request from `source` into `target` would likely close: linked to the branch,
/// linked to its commits, or written as "#123" in its commit messages. Each item carries `linkedVia`.
#[tauri::command]
pub async fn pr_branch_work_items(state: State<'_, AppState>, org: String, project_id: String, repo_id: String, source: String, target: String) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    let (commits, branch) = tokio::join!(pr::branch_commits(&c, &repo_id, &source, &target), pr::branch_linked_ids(&c, &project_id, &repo_id, &source));
    let mut via: Vec<(i64, &str)> = branch.unwrap_or_default().into_iter().map(|id| (id, "branch")).collect();
    for commit in commits? {
        let linked = commit.get("workItems").and_then(|w| w.as_array()).cloned().unwrap_or_default();
        for r in linked {
            if let Some(id) = r.get("id").and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64())) {
                via.push((id, "commit"));
            }
        }
        for id in pr::mentioned_ids(commit.get("comment").and_then(|v| v.as_str()).unwrap_or("")) {
            via.push((id, "mention"));
        }
    }
    let mut ids: Vec<i64> = Vec::new();
    for (id, _) in &via {
        if !ids.contains(id) {
            ids.push(*id);
        }
    }
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let fields = crate::ado::api::select_fields(&state.fields(&c).await?, &[]);
    // Unknown ids (a "#3" that was never a work item) are left out by the batch call.
    let mut items = crate::ado::api::get_items_batch(&c, "", &ids, &fields).await?;
    for item in items.iter_mut() {
        let id = item.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let how: Vec<&str> = ["branch", "commit", "mention"].into_iter().filter(|h| via.contains(&(id, *h))).collect();
        item["linkedVia"] = serde_json::json!(how);
    }
    Ok(items)
}

/// Link a work item to a pull request (`linked` true) or remove the link.
#[tauri::command]
pub async fn pr_link_work_item(state: State<'_, AppState>, org: String, project_id: String, repo_id: String, pr_id: i64, work_item_id: i64, linked: bool) -> AppResult<()> {
    let c = state.client(&org).await?;
    pr::set_work_item_link(&c, &project_id, &repo_id, pr_id, work_item_id, linked).await
}

#[tauri::command]
pub async fn pr_changes(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, iteration: i64, compare_to: Option<i64>) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::pr_iteration_changes(&c, &repo_id, pr_id, iteration, compare_to.unwrap_or(0)).await
}

#[tauri::command]
pub async fn pr_threads(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    pr::pr_threads(&c, &repo_id, pr_id).await
}

#[tauri::command]
pub async fn pr_create_thread(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, body: Value) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::create_thread(&c, &repo_id, pr_id, &body).await
}

#[tauri::command]
pub async fn pr_reply(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, thread_id: i64, parent_id: i64, content: String) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::reply_thread(&c, &repo_id, pr_id, thread_id, &content, parent_id).await
}

#[tauri::command]
pub async fn pr_update_thread(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, thread_id: i64, body: Value) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::update_thread(&c, &repo_id, pr_id, thread_id, &body).await
}

#[tauri::command]
pub async fn pr_update_comment(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, thread_id: i64, comment_id: i64, content: String) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::update_comment(&c, &repo_id, pr_id, thread_id, comment_id, &content).await
}

#[tauri::command]
pub async fn pr_delete_comment(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, thread_id: i64, comment_id: i64) -> AppResult<()> {
    let c = state.client(&org).await?;
    pr::delete_comment(&c, &repo_id, pr_id, thread_id, comment_id).await
}

#[tauri::command]
pub async fn pr_vote(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, reviewer_id: String, vote: i64) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::set_vote(&c, &repo_id, pr_id, &reviewer_id, vote).await
}

#[tauri::command]
pub async fn pr_add_reviewer(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, reviewer_id: String, required: bool) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::add_reviewer(&c, &repo_id, pr_id, &reviewer_id, required).await
}

#[tauri::command]
pub async fn pr_remove_reviewer(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, reviewer_id: String) -> AppResult<()> {
    let c = state.client(&org).await?;
    pr::remove_reviewer(&c, &repo_id, pr_id, &reviewer_id).await
}

#[tauri::command]
pub async fn pr_update(state: State<'_, AppState>, org: String, repo_id: String, pr_id: i64, body: Value) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::update_pr(&c, &repo_id, pr_id, &body).await
}

#[tauri::command]
pub async fn pr_create(state: State<'_, AppState>, org: String, repo_id: String, body: Value) -> AppResult<Value> {
    let c = state.client(&org).await?;
    pr::create_pr(&c, &repo_id, &body).await
}

#[tauri::command]
pub async fn pr_branches(state: State<'_, AppState>, org: String, repo_id: String) -> AppResult<Vec<Value>> {
    let c = state.client(&org).await?;
    pr::list_branches(&c, &repo_id).await
}

/// A repository's tag names, offered as versions to test.
#[tauri::command]
pub async fn git_tags(state: State<'_, AppState>, org: String, repo_id: String) -> AppResult<Vec<String>> {
    let c = state.client(&org).await?;
    pr::list_tags(&c, &repo_id).await
}

/// Create a branch for a work item and link the two. A failed link does not undo the branch; the result says whether it linked.
#[tauri::command]
pub async fn pr_start_branch(state: State<'_, AppState>, org: String, project_id: String, repo_id: String, name: String, base: String, work_item_id: i64) -> AppResult<Value> {
    let c = state.client(&org).await?;
    let full = pr::create_branch(&c, &repo_id, &name, &base).await?;
    let link = pr::link_branch(&c, &project_id, &repo_id, &full, work_item_id).await;
    Ok(serde_json::json!({ "name": full, "linked": link.is_ok(), "linkError": link.err().map(|e| e.to_string()) }))
}

/// Status checks and policy results of a pull request, without the rest of its detail.
#[tauri::command]
pub async fn pr_checks(state: State<'_, AppState>, org: String, project_id: String, repo_id: String, pr_id: i64) -> AppResult<Value> {
    let c = state.client(&org).await?;
    let (statuses, policies) = tokio::join!(pr::pr_statuses(&c, &repo_id, pr_id), pr::policy_evaluations(&c, &project_id, pr_id));
    Ok(serde_json::json!({ "statuses": statuses?, "policies": policies? }))
}

#[tauri::command]
pub async fn pr_file(state: State<'_, AppState>, org: String, repo_id: String, path: String, commit: String) -> AppResult<Option<String>> {
    let c = state.client(&org).await?;
    pr::file_content(&c, &repo_id, &path, &commit).await
}

#[tauri::command]
pub async fn pr_project_members(state: State<'_, AppState>, org: String, project_id: String) -> AppResult<Vec<crate::ado::api::Identity>> {
    let c = state.client(&org).await?;
    crate::ado::api::project_members(&c, &project_id).await
}
