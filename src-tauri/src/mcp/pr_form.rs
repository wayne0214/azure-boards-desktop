//! open_pull_request_form: an AI tool fills in Boards' New pull request form; the user reviews it and
//! clicks Create. Nothing is created here. The project, repository and branches are checked first, so
//! a wrong name comes back to the AI tool instead of an empty form.

use super::tools::str_arg;
use crate::ado::client::AdoClient;
use crate::ado::pr;
use crate::error::AppError;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

pub fn schema() -> Value {
    json!({
        "project": { "type": "string", "description": "Project name; omit for the current project" },
        "repository": { "type": "string", "description": "Repository name" },
        "sourceBranch": { "type": "string", "description": "Branch to merge from, e.g. feature/login (must be pushed)" },
        "targetBranch": { "type": "string", "description": "Branch to merge into; omit for the repository's default branch" },
        "title": { "type": "string" },
        "description": { "type": "string", "description": "Pull request message; markdown" },
        "workItemIds": { "type": "array", "items": { "type": "integer" }, "description": "Work items to link, besides those Boards finds from the branch" },
        "draft": { "type": "boolean", "description": "Tick \"Create as draft\"" },
    })
}

pub async fn open(app: &AppHandle, client: &AdoClient, current_project: Option<String>, args: &Value) -> Result<Value, AppError> {
    let required = |key: &str, what: &str| str_arg(args, key).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).ok_or_else(|| AppError::validation(format!("Give the {what}.")));
    let project = str_arg(args, "project").filter(|p| !p.trim().is_empty()).or(current_project).ok_or_else(|| AppError::validation("No project is open in Boards; pass `project`."))?;
    let repo_name = required("repository", "repository")?;
    let source = full_ref(&required("sourceBranch", "branch to merge from (sourceBranch)")?);
    let title = required("title", "title")?;

    let repos = pr::list_repos(client, &project).await?;
    let repo = find_repo(&repos, &repo_name)?;
    let repo_id = repo.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    let branches: Vec<String> = pr::list_branches(client, &repo_id).await?.iter().filter_map(|b| b.get("name").and_then(Value::as_str).map(str::to_string)).collect();
    let target = match str_arg(args, "targetBranch").filter(|t| !t.trim().is_empty()) {
        Some(t) => full_ref(&t),
        None => repo.get("defaultBranch").and_then(Value::as_str).map(str::to_string).ok_or_else(|| AppError::validation("The repository has no default branch; give targetBranch."))?,
    };
    check_branch(&branches, &source, &repo_name)?;
    check_branch(&branches, &target, &repo_name)?;
    if source == target {
        return Err(AppError::validation("The branches to merge from and into are the same."));
    }
    let work_item_ids: Vec<i64> = args.get("workItemIds").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();

    app.emit_to("main", "mcp-open-pr", json!({
        "projectId": repo.pointer("/project/id"),
        "repoId": repo_id,
        "source": source,
        "target": target,
        "title": title,
        "description": str_arg(args, "description").unwrap_or_default(),
        "isDraft": args.get("draft").and_then(Value::as_bool).unwrap_or(false),
        "workItemIds": work_item_ids,
    }))
    .map_err(|e| AppError::internal(e.to_string()))?;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(json!({
        "opened": true,
        "project": project,
        "repository": repo.get("name"),
        "sourceBranch": source,
        "targetBranch": target,
        "next": "Nothing is created yet. Tell the user the New pull request form is open in Boards with these values, to review it and click Create.",
    }))
}

/// `feature/x`, `heads/feature/x` and `refs/heads/feature/x` all mean the same branch.
fn full_ref(branch: &str) -> String {
    let b = branch.trim();
    let b = b.strip_prefix("refs/").unwrap_or(b);
    let b = b.strip_prefix("heads/").unwrap_or(b);
    format!("refs/heads/{b}")
}

fn find_repo<'a>(repos: &'a [Value], want: &str) -> Result<&'a Value, AppError> {
    let name = |r: &Value| r.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    repos
        .iter()
        .find(|r| name(r).eq_ignore_ascii_case(want) || r.get("id").and_then(Value::as_str) == Some(want))
        .ok_or_else(|| {
            let names: Vec<String> = repos.iter().map(name).collect();
            AppError::validation(format!("No repository \"{want}\" in this project. Repositories: {}.", names.join(", ")))
        })
}

fn check_branch(branches: &[String], branch: &str, repo: &str) -> Result<(), AppError> {
    if branches.iter().any(|b| b == branch) {
        return Ok(());
    }
    let short = branch.trim_start_matches("refs/heads/");
    let leaf = short.rsplit('/').next().unwrap_or(short).to_lowercase();
    let near: Vec<&str> = branches.iter().map(|b| b.trim_start_matches("refs/heads/")).filter(|b| b.to_lowercase().contains(&leaf)).take(5).collect();
    let hint = if near.is_empty() { "Push it first.".to_string() } else { format!("Did you mean {}?", near.join(", ")) };
    Err(AppError::validation(format!("Branch \"{short}\" is not in {repo}. {hint}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branches_may_be_named_short_or_in_full() {
        assert_eq!(full_ref("feature/login"), "refs/heads/feature/login");
        assert_eq!(full_ref(" refs/heads/main "), "refs/heads/main");
        assert_eq!(full_ref("heads/develop"), "refs/heads/develop");
    }

    #[test]
    fn repositories_match_by_name_or_id_and_list_the_others_when_not_found() {
        let repos = vec![json!({ "id": "r1", "name": "Boards" }), json!({ "id": "r2", "name": "Api" })];
        assert_eq!(find_repo(&repos, "boards").unwrap()["id"], "r1");
        assert_eq!(find_repo(&repos, "r2").unwrap()["name"], "Api");
        assert!(find_repo(&repos, "web").err().unwrap().message.contains("Boards, Api"));
    }

    #[test]
    fn a_missing_branch_suggests_close_names() {
        let branches = vec!["refs/heads/develop".to_string(), "refs/heads/feature/login-form".to_string()];
        assert!(check_branch(&branches, "refs/heads/develop", "Boards").is_ok());
        let e = check_branch(&branches, "refs/heads/login", "Boards").err().unwrap().message;
        assert!(e.contains("Did you mean feature/login-form?"), "{e}");
        assert!(check_branch(&branches, "refs/heads/zzz", "Boards").err().unwrap().message.contains("Push it first"));
    }
}
