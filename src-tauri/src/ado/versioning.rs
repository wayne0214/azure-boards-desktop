//! Versioning setup for an Azure Repos repository: the git-tools version-bump pipeline (classic Git Flow),
//! following git-tools' docs/azure-devops/setup.md: bootstrap commit on master, pipeline, secure file,
//! authorization, build service permissions, first run on master, then develop from the bumped master.
//!
//! `facts` only reads; the frontend decides from them what is set up and what is missing.
//! Each `fix_*` makes one change and is called only after the user confirms it.
use super::client::{enc, AdoClient};
use super::pr;
use crate::error::{AppError, AppResult, ErrorKind};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Security namespace of Git repositories.
const GIT_NAMESPACE: &str = "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87";
/// Read, Contribute, Create branch, Create tag. Never "Bypass policies when pushing": the setup guide
/// leaves that to an administrator's explicit exception.
pub const BUILD_SERVICE_BITS: i64 = 2 | 4 | 16 | 32;
const ZERO: &str = "0000000000000000000000000000000000000000";
const PREVIEW: &str = "api-version=7.1-preview.1";
/// Branch the setup files are proposed on.
const SETUP_BRANCH: &str = "chore/versioning-setup";

fn repo_base(repo_id: &str) -> String {
    format!("/_apis/git/repositories/{}", enc(repo_id))
}

fn list(v: Value) -> Vec<Value> {
    match v.get("value") {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// Text of a file on a branch, or None when it is not there.
async fn branch_file(client: &AdoClient, repo_id: &str, path: &str, branch: &str) -> AppResult<Option<String>> {
    let url = client.url(&format!(
        "{}/items?path={}&versionDescriptor.version={}&versionDescriptor.versionType=branch&includeContent=true&$format=json",
        repo_base(repo_id),
        enc(path),
        enc(branch)
    ));
    match client.get::<Value>(&url).await {
        Ok(v) => Ok(v.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())),
        Err(e) if e.kind == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn branch_tip(branches: &[Value], name: &str) -> Option<String> {
    let full = format!("refs/heads/{name}");
    branches
        .iter()
        .find(|b| b.get("name").and_then(|n| n.as_str()) == Some(full.as_str()))
        .and_then(|b| b.get("objectId").and_then(|o| o.as_str()))
        .map(|s| s.to_string())
}

/// "<project> Build Service (<org>)": the identity the pipeline pushes as.
async fn build_service(client: &AdoClient, project_id: &str, project: &str) -> AppResult<Option<Value>> {
    // The project build service is `Build\{project id}`: look it up by descriptor, which does not
    // depend on the display name search matching.
    let conn = client.get::<Value>(&client.url(&format!("/_apis/connectionData?{PREVIEW}"))).await.ok();
    if let Some(host) = conn.as_ref().and_then(|c| c.get("instanceId")).and_then(|v| v.as_str()) {
        let url = format!(
            "https://vssps.dev.azure.com/{}/_apis/identities?descriptors={}&queryMembership=None&api-version=7.1",
            enc(client.org()),
            enc(&build_descriptor(host, project_id))
        );
        let by_id = client.get::<Value>(&url).await.map(list).unwrap_or_default();
        if let Some(found) = by_id.into_iter().find(|i| i.get("descriptor").is_some()) {
            return Ok(Some(found));
        }
    }
    let name = format!("{project} Build Service ({})", client.org());
    let url = format!(
        "https://vssps.dev.azure.com/{}/_apis/identities?searchFilter=General&filterValue={}&queryMembership=None&api-version=7.1",
        enc(client.org()),
        enc(&name)
    );
    let found = list(client.get::<Value>(&url).await?);
    Ok(found.into_iter().find(|i| is_build_service(i, project_id, &name)))
}

fn build_descriptor(host: &str, project_id: &str) -> String {
    format!("Microsoft.TeamFoundation.ServiceIdentity;{host}:Build:{project_id}")
}

fn is_build_service(identity: &Value, project_id: &str, name: &str) -> bool {
    let descriptor = identity.get("descriptor").and_then(|d| d.as_str()).unwrap_or("");
    let display = identity.get("providerDisplayName").and_then(|n| n.as_str()).unwrap_or("");
    descriptor.to_ascii_lowercase().ends_with(&format!(":build:{}", project_id.to_ascii_lowercase())) || display.eq_ignore_ascii_case(name)
}

/// The effective allow bits `descriptor` has on the repository. A repository with no entry of its own
/// inherits from the project's "all repositories" entry, so that is read as well.
async fn effective_allow(client: &AdoClient, project_id: &str, repo_id: &str, descriptor: &str) -> AppResult<i64> {
    let mut allow = 0i64;
    for token in [format!("repoV2/{project_id}"), format!("repoV2/{project_id}/{repo_id}")] {
        let url = client.url(&format!(
            "/_apis/accesscontrollists/{GIT_NAMESPACE}?token={}&descriptors={}&includeExtendedInfo=true",
            enc(&token),
            enc(descriptor)
        ));
        for acl in list(client.get::<Value>(&url).await?) {
            if let Some(Value::Object(aces)) = acl.get("acesDictionary") {
                for ace in aces.values() {
                    let bits = ace
                        .pointer("/extendedInfo/effectiveAllow")
                        .or_else(|| ace.get("allow"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    allow |= bits;
                }
            }
        }
    }
    Ok(allow)
}

async fn pipeline_permission(client: &AdoClient, project: &str, kind: &str, id: &str) -> AppResult<Value> {
    let url = client.url(&format!("/{}/_apis/pipelines/pipelinepermissions/{}/{}?{PREVIEW}", enc(project), kind, enc(id)));
    client.get(&url).await
}

fn authorized_for(perm: &Value, pipeline_id: i64) -> bool {
    perm.pointer("/allPipelines/authorized").and_then(|v| v.as_bool()).unwrap_or(false)
        || perm
            .get("pipelines")
            .and_then(|p| p.as_array())
            .map(|a| a.iter().any(|p| p.get("id").and_then(|i| i.as_i64()) == Some(pipeline_id) && p.get("authorized").and_then(|v| v.as_bool()).unwrap_or(false)))
            .unwrap_or(false)
}

/// A top-level `KEY: value` from the workflow, without quotes or a trailing comment.
fn yaml_var(yaml: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let line = yaml.lines().map(|l| l.trim()).find(|l| l.starts_with(&prefix))?;
    let v = line[prefix.len()..].trim();
    let v = match v.chars().next() {
        Some(q @ ('"' | '\'')) => v[1..].split(q).next().unwrap_or("").to_string(),
        _ => v.split(" #").next().unwrap_or("").trim().to_string(),
    };
    (!v.is_empty()).then_some(v)
}

/// The stable branch: master, else main.
fn stable_of(names: &[String]) -> Option<&'static str> {
    ["master", "main"].into_iter().find(|b| names.iter().any(|n| n == b))
}

/// Everything the check needs about one repository. A section that could not be read is left out
/// and its error is put under `errors`, so one missing token scope does not hide the rest.
pub async fn facts(client: &AdoClient, project_id: &str, project: &str, repo_id: &str, workflow_path: &str, secure_file: Option<&str>) -> AppResult<Value> {
    let mut out = Map::new();
    let mut errors = Map::new();
    let mut note = |what: &str, e: AppError| {
        errors.insert(what.to_string(), json!({ "message": e.message, "status": e.status }));
    };

    let branches = match pr::list_branches(client, repo_id).await {
        Ok(b) => b,
        Err(e) => {
            note("branches", e);
            Vec::new()
        }
    };
    let names: Vec<String> = branches.iter().filter_map(|b| b.get("name").and_then(|n| n.as_str())).map(|n| n.trim_start_matches("refs/heads/").to_string()).collect();
    out.insert("branches".into(), json!(names));
    let stable = stable_of(&names);
    out.insert("stable".into(), json!(stable));

    let tags_url = client.url(&format!("{}/refs?filter=tags/&$top=1", repo_base(repo_id)));
    match client.get::<Value>(&tags_url).await {
        Ok(v) => {
            out.insert("hasTags".into(), json!(!list(v).is_empty()));
        }
        Err(e) => note("tags", e),
    }

    let mut workflow: Option<String> = None;
    if let Some(stable) = stable {
        for (key, path) in [("czToml", "/.cz.toml"), ("workflow", workflow_path)] {
            match branch_file(client, repo_id, path, stable).await {
                Ok(f) => {
                    if key == "workflow" {
                        workflow = f.clone();
                    }
                    out.insert(key.into(), json!(f));
                }
                Err(e) => note("files", e),
            }
        }
    }
    // The workflow names its secure file; the project default is only for a repository without one.
    let named = workflow.as_deref().and_then(|w| yaml_var(w, "GPG_SECURE_FILE"));
    let secure_file = named.as_deref().or(secure_file);

    let defs_url = client.url(&format!("/{}/_apis/build/definitions?repositoryId={}&repositoryType=TfsGit&includeAllProperties=true", enc(project), enc(repo_id)));
    let mut pipeline_id: Option<i64> = None;
    match client.get::<Value>(&defs_url).await {
        Ok(v) => {
            let want = workflow_path.trim_start_matches('/');
            let found = list(v).into_iter().find(|d| d.pointer("/process/yamlFilename").and_then(|f| f.as_str()).map(|f| f.trim_start_matches('/') == want).unwrap_or(false));
            pipeline_id = found.as_ref().and_then(|d| d.get("id").and_then(|i| i.as_i64()));
            out.insert("pipeline".into(), found.map(|d| json!({ "id": d.get("id"), "name": d.get("name") })).unwrap_or(Value::Null));
        }
        Err(e) => note("pipeline", e),
    }
    if let Some(pid) = pipeline_id {
        let url = client.url(&format!("/{}/_apis/pipelines/{}/runs", enc(project), pid));
        match client.get::<Value>(&url).await {
            Ok(v) => {
                let last = list(v).into_iter().next().map(|r| json!({ "id": r.get("id"), "state": r.get("state"), "result": r.get("result"), "createdDate": r.get("createdDate") }));
                out.insert("lastRun".into(), last.unwrap_or(Value::Null));
            }
            Err(e) => note("lastRun", e),
        }
    }

    if let Some(name) = secure_file {
        let url = client.url(&format!("/{}/_apis/distributedtask/securefiles?{PREVIEW}", enc(project)));
        match client.get::<Value>(&url).await {
            Ok(v) => {
                let file = list(v).into_iter().find(|f| f.get("name").and_then(|n| n.as_str()) == Some(name));
                let file_id = file.as_ref().and_then(|f| f.get("id").and_then(|i| i.as_str())).map(|s| s.to_string());
                out.insert("secureFile".into(), file_id.as_ref().map(|id| json!({ "id": id, "name": name })).unwrap_or(Value::Null));
                if let (Some(id), Some(pid)) = (file_id, pipeline_id) {
                    match pipeline_permission(client, project, "securefile", &id).await {
                        Ok(p) => {
                            out.insert("secureFileAuthorized".into(), json!(authorized_for(&p, pid)));
                        }
                        Err(e) => note("secureFileAuthorized", e),
                    }
                }
            }
            Err(e) => note("secureFile", e),
        }
    }

    if let Some(pid) = pipeline_id {
        match pipeline_permission(client, project, "repository", &format!("{project_id}.{repo_id}")).await {
            Ok(p) => {
                out.insert("repoAuthorized".into(), json!(authorized_for(&p, pid)));
            }
            Err(e) => note("repoAuthorized", e),
        }
    }

    match build_service(client, project_id, project).await {
        Ok(Some(identity)) => {
            let descriptor = identity.get("descriptor").and_then(|d| d.as_str()).unwrap_or("").to_string();
            let name = identity.get("providerDisplayName").cloned().unwrap_or(Value::Null);
            match effective_allow(client, project_id, repo_id, &descriptor).await {
                Ok(allow) => {
                    out.insert("buildService".into(), json!({ "name": name, "allow": allow }));
                }
                Err(e) => note("buildService", e),
            }
        }
        // The identity only exists once a pipeline in the project has run.
        Ok(None) => {
            out.insert("buildService".into(), Value::Null);
        }
        Err(e) => note("buildService", e),
    }

    let mut policies = Map::new();
    for branch in ["develop", "master", "main"] {
        if !names.iter().any(|n| n == branch) {
            continue;
        }
        let url = client.url(&format!("/{}/_apis/policy/configurations?repositoryId={}&refName={}", enc(project), enc(repo_id), enc(&format!("refs/heads/{branch}"))));
        match client.get::<Value>(&url).await {
            Ok(v) => {
                let kinds: Vec<Value> = list(v)
                    .into_iter()
                    .filter(|p| p.get("isEnabled").and_then(|e| e.as_bool()).unwrap_or(false))
                    .filter_map(|p| p.pointer("/type/displayName").cloned())
                    .collect();
                policies.insert(branch.into(), json!(kinds));
            }
            Err(e) => note("policies", e),
        }
    }
    out.insert("policies".into(), Value::Object(policies));
    out.insert("errors".into(), Value::Object(errors));
    Ok(Value::Object(out))
}

fn changes_for(files: &[(String, String)], existing: &[bool]) -> Vec<Value> {
    files
        .iter()
        .zip(existing)
        .map(|((path, content), exists)| {
            json!({
                "changeType": if *exists { "edit" } else { "add" },
                "item": { "path": path },
                "newContent": { "content": content, "contentType": "rawtext" },
            })
        })
        .collect()
}

/// The bootstrap commit, pushed straight to the stable branch (which it creates in an empty repository)
/// with the subject "Release 0.1.0" that the engine turns into the first stable version.
pub async fn fix_bootstrap(client: &AdoClient, repo_id: &str, stable: &str, files: &[(String, String)]) -> AppResult<Value> {
    let branches = pr::list_branches(client, repo_id).await?;
    let tip = branch_tip(&branches, stable);
    let mut files = files.to_vec();
    // Private-key exports must never be committed; the rule is added to whatever .gitignore already holds.
    let gitignore = match &tip {
        Some(_) => branch_file(client, repo_id, "/.gitignore", stable).await?,
        None => None,
    };
    files.push(("/.gitignore".to_string(), with_key_rule(gitignore.as_deref())));
    let mut existing = Vec::new();
    for (path, _) in &files {
        existing.push(match &tip {
            Some(_) if path == "/.gitignore" => gitignore.is_some(),
            Some(_) => branch_file(client, repo_id, path, stable).await?.is_some(),
            None => false,
        });
    }
    let commit = match &tip {
        Some(t) => json!({ "comment": "Release 0.1.0", "changes": changes_for(&files, &existing), "parents": [t] }),
        None => json!({ "comment": "Release 0.1.0", "changes": changes_for(&files, &existing) }),
    };
    let body = json!({ "refUpdates": [{ "name": format!("refs/heads/{stable}"), "oldObjectId": tip.clone().unwrap_or_else(|| ZERO.to_string()) }], "commits": [commit] });
    let url = client.url(&format!("{}/pushes", repo_base(repo_id)));
    match client.post_json::<Value>(&url, &body).await {
        Ok(_) => Ok(json!({ "branch": stable })),
        Err(e) if matches!(e.kind, ErrorKind::Forbidden | ErrorKind::Conflict) => Err(AppError::validation(format!(
            "Azure DevOps would not take a direct push to {stable} ({}). A branch policy may require pull requests; push the bootstrap commit once by hand or ask an administrator.",
            e.message
        ))),
        Err(e) => Err(e),
    }
}

const KEY_RULE: &str = "*-gpg-private.asc";

fn with_key_rule(existing: Option<&str>) -> String {
    let current = existing.unwrap_or("");
    if current.lines().any(|l| l.trim() == KEY_RULE) {
        return current.to_string();
    }
    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
    format!("{current}{sep}{KEY_RULE}\n")
}

/// Queue a run of the pipeline on `branch`.
pub async fn fix_run(client: &AdoClient, project: &str, pipeline_id: i64, branch: &str) -> AppResult<Value> {
    let url = client.url(&format!("/{}/_apis/pipelines/{}/runs", enc(project), pipeline_id));
    let body = json!({ "resources": { "repositories": { "self": { "refName": format!("refs/heads/{branch}") } } } });
    let run: Value = client.post_json(&url, &body).await?;
    Ok(json!({ "id": run.get("id"), "state": run.get("state") }))
}

/// Create `develop` from the stable branch, after its first bump.
pub async fn fix_develop(client: &AdoClient, repo_id: &str, from: &str) -> AppResult<Value> {
    let name = pr::create_branch(client, repo_id, "develop", from).await?;
    Ok(json!({ "branch": name }))
}

/// Propose files on a branch off `target` and open a pull request into it (for a repository that is already initialized).
pub async fn fix_files(client: &AdoClient, repo_id: &str, target: &str, files: &[(String, String)], title: &str, description: &str) -> AppResult<Value> {
    let branches = pr::list_branches(client, repo_id).await?;
    let target_tip = branch_tip(&branches, target).ok_or_else(|| AppError::validation(format!("The branch {target} was not found.")))?;
    // A first push starts the branch at the target; a later one adds a commit on top of it.
    let (old, parent, base) = match branch_tip(&branches, SETUP_BRANCH) {
        Some(tip) => (tip.clone(), tip, SETUP_BRANCH),
        None => (ZERO.to_string(), target_tip, target),
    };
    let mut existing = Vec::new();
    for (path, _) in files {
        existing.push(branch_file(client, repo_id, path, base).await?.is_some());
    }
    let body = json!({
        "refUpdates": [{ "name": format!("refs/heads/{SETUP_BRANCH}"), "oldObjectId": old }],
        "commits": [{ "comment": "chore: set up git-tools versioning", "changes": changes_for(files, &existing), "parents": [parent] }],
    });
    let url = client.url(&format!("{}/pushes", repo_base(repo_id)));
    client.post_json::<Value>(&url, &body).await?;
    let created = pr::create_pr(
        client,
        repo_id,
        &json!({ "sourceRefName": format!("refs/heads/{SETUP_BRANCH}"), "targetRefName": format!("refs/heads/{target}"), "title": title, "description": description }),
    )
    .await;
    match created {
        Ok(p) => Ok(json!({ "pullRequestId": p.get("pullRequestId"), "branch": SETUP_BRANCH })),
        // Pushing again to a branch that already has its pull request open just updates it.
        Err(e) if e.kind == ErrorKind::Conflict => Ok(json!({ "pullRequestId": Value::Null, "branch": SETUP_BRANCH, "updated": true })),
        Err(e) => Err(e),
    }
}

/// Import the YAML as a pipeline, named <repo>-version-bump-classic as the setup guide suggests.
pub async fn fix_pipeline(client: &AdoClient, project: &str, repo_id: &str, repo_name: &str, workflow_path: &str) -> AppResult<Value> {
    let url = client.url(&format!("/{}/_apis/pipelines", enc(project)));
    let body = json!({
        "name": format!("{}-version-bump-classic", repo_name.to_lowercase().replace(' ', "-")),
        "folder": "\\",
        "configuration": { "type": "yaml", "path": workflow_path, "repository": { "id": repo_id, "type": "azureReposGit" } },
    });
    let p: Value = client.post_json(&url, &body).await?;
    Ok(json!({ "id": p.get("id"), "name": p.get("name") }))
}

/// Let the pipeline use the repository and the secure file without a manual first run.
pub async fn fix_authorize(client: &AdoClient, project_id: &str, project: &str, repo_id: &str, pipeline_id: i64, secure_file_id: Option<&str>) -> AppResult<Value> {
    let body = json!({ "pipelines": [{ "id": pipeline_id, "authorized": true }] });
    let repo = format!("{project_id}.{repo_id}");
    let mut targets = vec![("repository", repo.as_str())];
    if let Some(id) = secure_file_id {
        targets.push(("securefile", id));
    }
    for (kind, id) in targets {
        let url = client.url(&format!("/{}/_apis/pipelines/pipelinepermissions/{}/{}?{PREVIEW}", enc(project), kind, enc(id)));
        client.patch_json::<Value>(&url, &body).await?;
    }
    Ok(json!({ "authorized": true }))
}

/// Give the project build service Read, Contribute, Create branch and Create tag on this repository.
pub async fn fix_build_service(client: &AdoClient, project_id: &str, project: &str, repo_id: &str) -> AppResult<Value> {
    let identity = build_service(client, project_id, project)
        .await?
        .ok_or_else(|| AppError::validation(format!("Could not find \"{project} Build Service ({})\".", client.org())))?;
    let descriptor = identity.get("descriptor").and_then(|d| d.as_str()).unwrap_or("");
    let url = client.url(&format!("/_apis/accesscontrolentries/{GIT_NAMESPACE}"));
    let body = json!({
        "token": format!("repoV2/{project_id}/{repo_id}"),
        "merge": true,
        "accessControlEntries": [{ "descriptor": descriptor, "allow": BUILD_SERVICE_BITS, "deny": 0, "extendedInfo": {} }],
    });
    client.post_json::<Value>(&url, &body).await?;
    Ok(json!({ "allow": BUILD_SERVICE_BITS }))
}

/// A throwaway keyring folder, removed (with its agent stopped) when dropped.
struct TempKeyring(PathBuf, PathBuf);

impl TempKeyring {
    fn new(gpgconf: PathBuf) -> AppResult<Self> {
        let mut rnd = [0u8; 8];
        getrandom::getrandom(&mut rnd).map_err(|e| AppError::internal(format!("No randomness: {e}")))?;
        let dir = std::env::temp_dir().join(format!("boards-gpg-{}", rnd.iter().map(|b| format!("{b:02x}")).collect::<String>()));
        std::fs::create_dir(&dir).map_err(|e| AppError::internal(format!("Could not make a keyring folder: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        Ok(Self(dir, gpgconf))
    }
}

impl Drop for TempKeyring {
    fn drop(&mut self) {
        let _ = Command::new(&self.1).args(["--kill", "gpg-agent"]).env("GNUPGHOME", &self.0).stdin(Stdio::null()).output();
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn gpg(bin: &Path, home: &Path, path: &std::ffi::OsStr, args: &[&str]) -> AppResult<String> {
    let out = Command::new(bin)
        .args(["--batch", "--pinentry-mode", "loopback", "--passphrase", ""])
        .args(args)
        .env("GNUPGHOME", home)
        .env("PATH", path)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| AppError::internal(format!("Could not run gpg: {e}")))?;
    if !out.status.success() {
        return Err(AppError::internal(format!("gpg failed: {}", String::from_utf8_lossy(&out.stderr).trim())));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Make a passphrase-less signing key for the bot in a throwaway keyring and upload its private half
/// as a secure file. The key never leaves this process except as the upload; the keyring is deleted.
pub async fn fix_secure_file(client: &AdoClient, project: &str, name: &str, bot_name: &str, bot_email: &str) -> AppResult<Value> {
    let (bin, path) = crate::tools::find_program("gpg").ok_or_else(|| AppError::validation("gpg is not installed. Install GnuPG (for example `brew install gnupg`) and try again."))?;
    let gpgconf = crate::tools::find_program("gpgconf").map(|(p, _)| p).unwrap_or_else(|| PathBuf::from("gpgconf"));
    let (armored, fingerprint) = {
        let keyring = TempKeyring::new(gpgconf)?;
        let uid = format!("{bot_name} <{bot_email}>");
        gpg(&bin, &keyring.0, path, &["--quick-gen-key", &uid, "rsa3072", "sign", "2y"])?;
        let listing = gpg(&bin, &keyring.0, path, &["--list-secret-keys", "--with-colons"])?;
        let fingerprint = listing.lines().find(|l| l.starts_with("fpr:")).and_then(|l| l.split(':').nth(9)).unwrap_or("").to_string();
        let armored = gpg(&bin, &keyring.0, path, &["--armor", "--export-secret-keys", &fingerprint])?;
        (armored, fingerprint)
    };
    if !armored.contains("BEGIN PGP PRIVATE KEY BLOCK") {
        return Err(AppError::internal("gpg did not export the key."));
    }
    let url = client.url(&format!("/{}/_apis/distributedtask/securefiles?name={}&{PREVIEW}", enc(project), enc(name)));
    let file: Value = client.post_bytes(&url, armored.into_bytes()).await?;
    Ok(json!({ "id": file.get("id"), "name": name, "fingerprint": fingerprint }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorized_for_reads_all_pipelines_or_the_one() {
        assert!(authorized_for(&json!({ "allPipelines": { "authorized": true } }), 7));
        assert!(authorized_for(&json!({ "pipelines": [{ "id": 7, "authorized": true }] }), 7));
        assert!(!authorized_for(&json!({ "pipelines": [{ "id": 8, "authorized": true }] }), 7));
        assert!(!authorized_for(&json!({}), 7));
    }

    #[test]
    fn yaml_var_reads_plain_quoted_and_commented() {
        let y = "variables:\n  GPG_SECURE_FILE: a-gpg-private.asc  # <-- note\n  GIT_BOT_NAME: \"My Bot\"\n";
        assert_eq!(yaml_var(y, "GPG_SECURE_FILE").as_deref(), Some("a-gpg-private.asc"));
        assert_eq!(yaml_var(y, "GIT_BOT_NAME").as_deref(), Some("My Bot"));
        assert_eq!(yaml_var(y, "MISSING"), None);
    }

    #[test]
    fn key_rule_is_added_once() {
        assert_eq!(with_key_rule(None), "*-gpg-private.asc\n");
        assert_eq!(with_key_rule(Some("node_modules")), "node_modules\n*-gpg-private.asc\n");
        assert_eq!(with_key_rule(Some("dist\n*-gpg-private.asc\n")), "dist\n*-gpg-private.asc\n");
    }

    #[test]
    fn branch_tip_matches_the_whole_name() {
        let b = vec![json!({ "name": "refs/heads/develop-old", "objectId": "a" }), json!({ "name": "refs/heads/develop", "objectId": "b" })];
        assert_eq!(branch_tip(&b, "develop").as_deref(), Some("b"));
        assert_eq!(branch_tip(&b, "main"), None);
    }

    #[test]
    fn build_service_is_found_by_project_id_or_name() {
        let pid = "A44A834E-d17b-49bc-9bb8-448454d350b9";
        let name = "Test Project Build Service (dxdhub)";
        assert_eq!(build_descriptor("h1", pid), format!("Microsoft.TeamFoundation.ServiceIdentity;h1:Build:{pid}"));
        let by_id = json!({ "descriptor": "Microsoft.TeamFoundation.ServiceIdentity;h1:Build:a44a834e-d17b-49bc-9bb8-448454d350b9", "providerDisplayName": "Renamed" });
        let by_name = json!({ "descriptor": "x", "providerDisplayName": "test project build service (DXDHUB)" });
        let collection = json!({ "descriptor": "Microsoft.TeamFoundation.ServiceIdentity;h1:Build:h1", "providerDisplayName": "Project Collection Build Service (dxdhub)" });
        assert!(is_build_service(&by_id, pid, name));
        assert!(is_build_service(&by_name, pid, name));
        assert!(!is_build_service(&collection, pid, name));
    }
}
