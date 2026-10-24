//! Commands for the project overview's versioning check and its fixes.
use crate::ado::versioning;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn versioning_facts(
    state: State<'_, AppState>,
    org: String,
    project_id: String,
    project: String,
    repo_id: String,
    workflow_path: String,
    secure_file: Option<String>,
) -> AppResult<Value> {
    let c = state.client(&org).await?;
    versioning::facts(&c, &project_id, &project, &repo_id, &workflow_path, secure_file.as_deref()).await
}

#[derive(Debug, Deserialize)]
#[serde(tag = "step", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Fix {
    Bootstrap { stable: String, files: Vec<(String, String)> },
    Develop { from: String },
    Files { target: String, files: Vec<(String, String)>, title: String, description: String },
    Run { pipeline_id: i64, branch: String },
    SecureFile { name: String, bot_name: String, bot_email: String },
    Pipeline { repo_name: String, workflow_path: String },
    Authorize { pipeline_id: i64, secure_file_id: Option<String> },
    BuildService,
}

#[tauri::command]
pub async fn versioning_fix(state: State<'_, AppState>, org: String, project_id: String, project: String, repo_id: String, fix: Fix) -> AppResult<Value> {
    let c = state.client(&org).await?;
    match fix {
        Fix::Bootstrap { stable, files } => {
            if files.is_empty() {
                return Err(AppError::validation("No files to add."));
            }
            versioning::fix_bootstrap(&c, &repo_id, &stable, &files).await
        }
        Fix::Develop { from } => versioning::fix_develop(&c, &repo_id, &from).await,
        Fix::Files { target, files, title, description } => {
            if files.is_empty() {
                return Err(AppError::validation("No files to add."));
            }
            versioning::fix_files(&c, &repo_id, &target, &files, &title, &description).await
        }
        Fix::Run { pipeline_id, branch } => versioning::fix_run(&c, &project, pipeline_id, &branch).await,
        Fix::SecureFile { name, bot_name, bot_email } => versioning::fix_secure_file(&c, &project, &name, &bot_name, &bot_email).await,
        Fix::Pipeline { repo_name, workflow_path } => versioning::fix_pipeline(&c, &project, &repo_id, &repo_name, &workflow_path).await,
        Fix::Authorize { pipeline_id, secure_file_id } => versioning::fix_authorize(&c, &project_id, &project, &repo_id, pipeline_id, secure_file_id.as_deref()).await,
        Fix::BuildService => versioning::fix_build_service(&c, &project_id, &project, &repo_id).await,
    }
}
