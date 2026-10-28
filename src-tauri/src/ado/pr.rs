//! Pull requests: Azure Repos Git REST API.
use super::client::{enc, AdoClient};
use crate::error::{AppError, AppResult, ErrorKind};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
struct ListResponse<T> {
    #[serde(default = "Vec::new")]
    value: Vec<T>,
}

fn repo_base(repo_id: &str) -> String {
    format!("/_apis/git/repositories/{}", enc(repo_id))
}

pub async fn list_repos(client: &AdoClient, project: &str) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("/{}/_apis/git/repositories", enc(project)));
    let res: ListResponse<Value> = client.get(&url).await?;
    let mut v = res.value;
    v.sort_by_key(|r| r.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase());
    Ok(v)
}

/// Pull request states the list can filter on.
const PR_STATUSES: &[&str] = &["active", "completed", "abandoned", "all"];
/// Most branches listed for a repository.
const BRANCH_CAP: u32 = 1000;

/// status: active | completed | abandoned | all. An empty project lists across the whole organization.
pub async fn list_prs(
    client: &AdoClient,
    project: &str,
    status: &str,
    creator_id: Option<&str>,
    reviewer_id: Option<&str>,
    repo_id: Option<&str>,
    top: u32,
) -> AppResult<Vec<Value>> {
    if !PR_STATUSES.contains(&status) {
        return Err(AppError::validation("Unknown pull request status."));
    }
    let mut q = vec![format!("searchCriteria.status={status}"), format!("$top={top}")];
    if let Some(c) = creator_id {
        q.push(format!("searchCriteria.creatorId={}", enc(c)));
    }
    if let Some(r) = reviewer_id {
        q.push(format!("searchCriteria.reviewerId={}", enc(r)));
    }
    if let Some(r) = repo_id {
        q.push(format!("searchCriteria.repositoryId={}", enc(r)));
    }
    let scope = if project.is_empty() { String::new() } else { format!("/{}", enc(project)) };
    let url = client.url(&format!("{scope}/_apis/git/pullrequests?{}", q.join("&")));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn get_pr(client: &AdoClient, repo_id: &str, pr_id: i64) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}?includeWorkItemRefs=true&includeCommits=true", repo_base(repo_id), pr_id));
    client.get(&url).await
}

pub async fn pr_iterations(client: &AdoClient, repo_id: &str, pr_id: i64) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("{}/pullrequests/{}/iterations?includeCommits=false", repo_base(repo_id), pr_id));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn pr_iteration_changes(client: &AdoClient, repo_id: &str, pr_id: i64, iteration: i64, compare_to: i64) -> AppResult<Value> {
    let url = client.url(&format!(
        "{}/pullrequests/{}/iterations/{}/changes?$top=5000&compareTo={}",
        repo_base(repo_id),
        pr_id,
        iteration,
        compare_to
    ));
    client.get(&url).await
}

pub async fn pr_threads(client: &AdoClient, repo_id: &str, pr_id: i64) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("{}/pullrequests/{}/threads", repo_base(repo_id), pr_id));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn create_thread(client: &AdoClient, repo_id: &str, pr_id: i64, body: &Value) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}/threads", repo_base(repo_id), pr_id));
    client.post_json(&url, body).await
}

pub async fn reply_thread(client: &AdoClient, repo_id: &str, pr_id: i64, thread_id: i64, content: &str, parent: i64) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}/threads/{}/comments", repo_base(repo_id), pr_id, thread_id));
    client.post_json(&url, &json!({ "content": content, "parentCommentId": parent, "commentType": 1 })).await
}

pub async fn update_thread(client: &AdoClient, repo_id: &str, pr_id: i64, thread_id: i64, body: &Value) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}/threads/{}", repo_base(repo_id), pr_id, thread_id));
    client.patch_json(&url, body).await
}

pub async fn update_comment(client: &AdoClient, repo_id: &str, pr_id: i64, thread_id: i64, comment_id: i64, content: &str) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}/threads/{}/comments/{}", repo_base(repo_id), pr_id, thread_id, comment_id));
    client.patch_json(&url, &json!({ "content": content })).await
}

pub async fn delete_comment(client: &AdoClient, repo_id: &str, pr_id: i64, thread_id: i64, comment_id: i64) -> AppResult<()> {
    let url = client.url(&format!("{}/pullrequests/{}/threads/{}/comments/{}", repo_base(repo_id), pr_id, thread_id, comment_id));
    let _: Value = client.delete(&url).await?;
    Ok(())
}

pub async fn set_vote(client: &AdoClient, repo_id: &str, pr_id: i64, reviewer_id: &str, vote: i64) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}/reviewers/{}", repo_base(repo_id), pr_id, enc(reviewer_id)));
    client.put_json(&url, &json!({ "vote": vote })).await
}

pub async fn add_reviewer(client: &AdoClient, repo_id: &str, pr_id: i64, reviewer_id: &str, required: bool) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}/reviewers/{}", repo_base(repo_id), pr_id, enc(reviewer_id)));
    client.put_json(&url, &json!({ "vote": 0, "isRequired": required })).await
}

pub async fn remove_reviewer(client: &AdoClient, repo_id: &str, pr_id: i64, reviewer_id: &str) -> AppResult<()> {
    let url = client.url(&format!("{}/pullrequests/{}/reviewers/{}", repo_base(repo_id), pr_id, enc(reviewer_id)));
    let _: Value = client.delete(&url).await?;
    Ok(())
}

/// Generic PR update: title, description, status (completed/abandoned/active), isDraft,
/// autoCompleteSetBy, completionOptions, lastMergeSourceCommit.
pub async fn update_pr(client: &AdoClient, repo_id: &str, pr_id: i64, body: &Value) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests/{}", repo_base(repo_id), pr_id));
    client.patch_json(&url, body).await.map_err(|e| {
        if e.kind == ErrorKind::Validation || e.kind == ErrorKind::Conflict {
            AppError::new(e.kind, e.message)
        } else {
            e
        }
    })
}

pub async fn create_pr(client: &AdoClient, repo_id: &str, body: &Value) -> AppResult<Value> {
    let url = client.url(&format!("{}/pullrequests", repo_base(repo_id)));
    client.post_json(&url, body).await
}

pub async fn pr_commits(client: &AdoClient, repo_id: &str, pr_id: i64) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("{}/pullrequests/{}/commits?$top=200", repo_base(repo_id), pr_id));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn pr_work_items(client: &AdoClient, repo_id: &str, pr_id: i64) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("{}/pullrequests/{}/workitems", repo_base(repo_id), pr_id));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn pr_statuses(client: &AdoClient, repo_id: &str, pr_id: i64) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("{}/pullrequests/{}/statuses?api-version=7.1-preview.1", repo_base(repo_id), pr_id));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn policy_evaluations(client: &AdoClient, project_id: &str, pr_id: i64) -> AppResult<Vec<Value>> {
    let artifact = format!("vstfs:///CodeReview/CodeReviewId/{}/{}", project_id, pr_id);
    let url = client.url(&format!(
        "/{}/_apis/policy/evaluations?artifactId={}&api-version=7.1-preview.1",
        enc(project_id),
        enc(&artifact)
    ));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

pub async fn list_branches(client: &AdoClient, repo_id: &str) -> AppResult<Vec<Value>> {
    let url = client.url(&format!("{}/refs?filter=heads/&$top={BRANCH_CAP}", repo_base(repo_id)));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value)
}

/// Tag names in a repository ("v1.4.0"), without "refs/tags/". Reading them needs Code (Read) on the token.
pub async fn list_tags(client: &AdoClient, repo_id: &str) -> AppResult<Vec<String>> {
    let url = client.url(&format!("{}/refs?filter=tags/&$top={BRANCH_CAP}", repo_base(repo_id)));
    let res: ListResponse<Value> = client.get(&url).await?;
    Ok(res.value.iter().filter_map(|r| r.get("name").and_then(|n| n.as_str())).map(|n| n.trim_start_matches("refs/tags/").to_string()).collect())
}

/// Text content of a file at a commit. Returns null for binary or oversized files.
pub async fn file_content(client: &AdoClient, repo_id: &str, path: &str, commit: &str) -> AppResult<Option<String>> {
    let url = client.url(&format!(
        "{}/items?path={}&versionDescriptor.version={}&versionDescriptor.versionType=commit&includeContent=true&resolveLfs=true&$format=json",
        repo_base(repo_id),
        enc(path),
        enc(commit)
    ));
    let v: Value = match client.get(&url).await {
        Ok(v) => v,
        Err(e) if e.kind == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let content = v.get("content").and_then(|c| c.as_str()).map(|s| s.to_string());
    match content {
        Some(c) if c.len() <= 1_500_000 => Ok(Some(c)),
        Some(_) => Ok(None),
        None => Ok(None),
    }
}

/// Work item ids written in commit messages: "#123" or "AB#123".
pub fn mentioned_ids(message: &str) -> Vec<i64> {
    let bytes = message.as_bytes();
    let mut out = Vec::new();
    for (i, _) in message.match_indices('#') {
        // "abc#12" is not a mention; "AB#12" and "(#12" are.
        let before = &message[..i];
        let ok = before.is_empty() || before.ends_with("AB") || !bytes[i - 1].is_ascii_alphanumeric();
        let digits: String = message[i + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if ok && !digits.is_empty() && digits.len() <= 9 {
            if let Ok(id) = digits.parse::<i64>() {
                if !out.contains(&id) {
                    out.push(id);
                }
            }
        }
    }
    out
}

/// Commits on `source` that `target` does not have yet, with the work items linked to each (newest first, at most 200).
pub async fn branch_commits(client: &AdoClient, repo_id: &str, source: &str, target: &str) -> AppResult<Vec<Value>> {
    let (src, tgt) = (enc(source.trim_start_matches("refs/heads/")), enc(target.trim_start_matches("refs/heads/")));
    let url = client.url(&format!(
        "{}/diffs/commits?baseVersion={tgt}&baseVersionType=branch&targetVersion={src}&targetVersionType=branch&$top=1",
        repo_base(repo_id)
    ));
    let diff: Value = client.get(&url).await?;
    let ahead = diff.get("aheadCount").and_then(|v| v.as_i64()).unwrap_or(0).clamp(0, 200);
    if ahead == 0 {
        return Ok(Vec::new());
    }
    let common = diff.get("commonCommit").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let url = client.url(&format!(
        "{}/commits?searchCriteria.itemVersion.version={src}&searchCriteria.itemVersion.versionType=branch&searchCriteria.compareVersion.version={tgt}&searchCriteria.compareVersion.versionType=branch&searchCriteria.includeWorkItems=true&searchCriteria.$top={ahead}",
        repo_base(repo_id)
    ));
    let res: ListResponse<Value> = client.get(&url).await?;
    // Stop at the merge base in case the range is read as the whole branch history.
    Ok(res
        .value
        .into_iter()
        .take_while(|c| common.is_empty() || c.get("commitId").and_then(|v| v.as_str()) != Some(common.as_str()))
        .collect())
}

/// Ids of the work items linked to a branch (e.g. made with "Create branch" on a work item).
pub async fn branch_linked_ids(client: &AdoClient, project_id: &str, repo_id: &str, branch: &str) -> AppResult<Vec<i64>> {
    let uri = branch_artifact_uri(project_id, repo_id, branch);
    let url = client.url("/_apis/wit/artifacturiquery?api-version=7.1");
    let res: Value = client.post_json(&url, &json!({ "artifactUris": [uri] })).await?;
    Ok(res
        .get("artifactUrisQueryResult")
        .and_then(|m| m.as_object())
        .map(|m| {
            m.values()
                .filter_map(|v| v.as_array())
                .flatten()
                .filter_map(|r| r.get("id").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))))
                .collect()
        })
        .unwrap_or_default())
}

pub fn branch_artifact_uri(project_id: &str, repo_id: &str, branch: &str) -> String {
    format!("vstfs:///Git/Ref/{}%2F{}%2FGB{}", project_id, repo_id, enc(branch.trim_start_matches("refs/heads/")))
}

const ZERO_OBJECT_ID: &str = "0000000000000000000000000000000000000000";

/// Create branch `name` at the tip of `base`. Both may be given with or without "refs/heads/".
pub async fn create_branch(client: &AdoClient, repo_id: &str, name: &str, base: &str) -> AppResult<String> {
    let base = base.trim_start_matches("refs/heads/");
    let full_base = format!("refs/heads/{base}");
    let url = client.url(&format!("{}/refs?filter=heads/{}", repo_base(repo_id), enc(base)));
    let res: ListResponse<Value> = client.get(&url).await?;
    // The filter is a prefix match, so "main" also finds "main-old".
    let object_id = res
        .value
        .iter()
        .find(|r| r.get("name").and_then(|n| n.as_str()) == Some(full_base.as_str()))
        .and_then(|r| r.get("objectId").and_then(|o| o.as_str()))
        .ok_or_else(|| AppError::validation(format!("The base branch {base} was not found.")))?
        .to_string();
    let full = format!("refs/heads/{}", name.trim_start_matches("refs/heads/"));
    let url = client.url(&format!("{}/refs", repo_base(repo_id)));
    let res: ListResponse<Value> = client
        .post_json(&url, &json!([{ "name": full, "oldObjectId": ZERO_OBJECT_ID, "newObjectId": object_id }]))
        .await?;
    let status = res.value.first().and_then(|r| r.get("updateStatus")).and_then(|s| s.as_str()).unwrap_or("");
    let ok = res.value.first().and_then(|r| r.get("success")).and_then(|s| s.as_bool()).unwrap_or(false);
    if !ok {
        return Err(AppError::validation(ref_update_message(status, name)));
    }
    Ok(full)
}

fn ref_update_message(status: &str, name: &str) -> String {
    match status {
        "staleOldObjectId" => format!("A branch named {name} already exists."),
        "createBranchPermissionRequired" => "You do not have permission to create branches in this repository.".into(),
        "invalidRefName" => format!("{name} is not a valid branch name."),
        "refNameConflict" => format!("{name} clashes with an existing branch (a branch cannot be both a name and a folder)."),
        "" => "Azure DevOps did not create the branch.".into(),
        other => format!("Azure DevOps did not create the branch ({other})."),
    }
}

/// Link a work item to a branch, unless it already is.
pub async fn link_branch(client: &AdoClient, project_id: &str, repo_id: &str, branch: &str, work_item_id: i64) -> AppResult<()> {
    let url = client.url(&format!("/_apis/wit/workitems/{}?$expand=relations", work_item_id));
    let current: Value = client.get(&url).await?;
    let target = branch_artifact_uri(project_id, repo_id, branch);
    if super::api::relation_index(&current, "ArtifactLink", &target).is_some() {
        return Ok(());
    }
    let ops = json!([{ "op": "add", "path": "/relations/-", "value": { "rel": "ArtifactLink", "url": target, "attributes": { "name": "Branch" } } }]);
    let _: Value = client.patch_patch(&url, &ops).await?;
    Ok(())
}

pub fn pr_artifact_uri(project_id: &str, repo_id: &str, pr_id: i64) -> String {
    format!("vstfs:///Git/PullRequestId/{}%2F{}%2F{}", project_id, repo_id, pr_id)
}

/// Link a work item to a pull request, or remove that link; does nothing when it is already so.
pub async fn set_work_item_link(client: &AdoClient, project_id: &str, repo_id: &str, pr_id: i64, work_item_id: i64, linked: bool) -> AppResult<()> {
    let url = client.url(&format!("/_apis/wit/workitems/{}?$expand=relations", work_item_id));
    let current: Value = client.get(&url).await?;
    let target = pr_artifact_uri(project_id, repo_id, pr_id);
    let index = super::api::relation_index(&current, "ArtifactLink", &target);
    let ops = match (linked, index) {
        (true, None) => json!([{ "op": "add", "path": "/relations/-", "value": { "rel": "ArtifactLink", "url": target, "attributes": { "name": "Pull Request" } } }]),
        (false, Some(i)) => json!([{ "op": "test", "path": "/rev", "value": current.get("rev").cloned().unwrap_or(Value::Null) }, { "op": "remove", "path": format!("/relations/{i}") }]),
        _ => return Ok(()),
    };
    let _: Value = client.patch_patch(&url, &ops).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentioned_ids_reads_hash_and_ab_mentions() {
        assert_eq!(mentioned_ids("Fix upload #12 and AB#345, see (#12)"), vec![12, 345]);
    }

    #[test]
    fn branch_uri_encodes_the_name_without_refs_heads() {
        assert_eq!(branch_artifact_uri("p", "r", "refs/heads/feature/7-login"), "vstfs:///Git/Ref/p%2Fr%2FGBfeature%2F7-login");
    }

    #[test]
    fn ref_update_failures_read_plainly() {
        assert!(ref_update_message("staleOldObjectId", "feature/1").contains("already exists"));
        assert!(ref_update_message("createBranchPermissionRequired", "x").contains("permission"));
        assert!(ref_update_message("weird", "x").contains("weird"));
    }

    #[test]
    fn mentioned_ids_skips_words_and_bare_hashes() {
        assert!(mentioned_ids("color abc#12, C# code, # 5").is_empty());
    }
}
