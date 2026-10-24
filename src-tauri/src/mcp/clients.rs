//! One-click setup of the AI tools that use the server: Claude Code (through its own CLI)
//! and Codex (its `~/.codex/config.toml`, backed up before the first change).

use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const SERVER_NAME: &str = "boards";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SetupState {
    /// Set up with the current address and token.
    Ready,
    /// Set up, but with an old token or address.
    Outdated,
    Missing,
    /// The tool is not on this computer.
    NotInstalled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub state: SetupState,
    pub detail: Option<String>,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

// ----- Claude Code -----

fn claude_json() -> Option<PathBuf> {
    home().map(|h| h.join(".claude.json"))
}

fn claude_state(url: &str, token: &str) -> SetupState {
    let installed = crate::tools::find_program("claude").is_some();
    let entry = claude_json()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.get("mcpServers").and_then(|m| m.get(SERVER_NAME)).cloned());
    match entry {
        Some(e) => {
            let same_url = e.get("url").and_then(Value::as_str) == Some(url);
            let same_token = e.pointer("/headers/Authorization").and_then(Value::as_str) == Some(&format!("Bearer {token}"));
            if same_url && same_token { SetupState::Ready } else { SetupState::Outdated }
        }
        None if installed => SetupState::Missing,
        None => SetupState::NotInstalled,
    }
}

/// Runs the Claude Code CLI with the login PATH; gives up after 30 seconds.
fn claude(args: &[&str]) -> AppResult<(bool, String)> {
    let (program, path) = crate::tools::find_program("claude").ok_or_else(|| {
        AppError::validation("Claude Code's `claude` command was not found. Install Claude Code, or copy the command instead.")
    })?;
    let mut child = Command::new(program)
        .args(args)
        .env("PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::internal(format!("Could not start claude: {e}")))?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| AppError::internal(e.to_string()))? {
            let out = child.wait_with_output().map_err(|e| AppError::internal(e.to_string()))?;
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            return Ok((status.success(), text.trim().to_string()));
        }
        if started.elapsed() > Duration::from_secs(30) {
            let _ = child.kill();
            return Err(AppError::internal("claude did not finish within 30 seconds."));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn claude_setup(url: &str, token: &str) -> AppResult<()> {
    // Replace any older entry; "not found" is fine.
    let _ = claude(&["mcp", "remove", "--scope", "user", SERVER_NAME]);
    let header = format!("Authorization: Bearer {token}");
    let (ok, out) = claude(&["mcp", "add", "--scope", "user", "--transport", "http", SERVER_NAME, url, "--header", &header])?;
    if ok { Ok(()) } else { Err(AppError::internal(format!("claude mcp add failed: {out}"))) }
}

fn claude_remove() -> AppResult<()> {
    let (ok, out) = claude(&["mcp", "remove", "--scope", "user", SERVER_NAME])?;
    if ok || out.to_lowercase().contains("no ") { Ok(()) } else { Err(AppError::internal(format!("claude mcp remove failed: {out}"))) }
}

// ----- Codex -----

fn codex_dir() -> Option<PathBuf> {
    home().map(|h| h.join(".codex"))
}

fn codex_config() -> Option<PathBuf> {
    codex_dir().map(|d| d.join("config.toml"))
}

fn codex_block(url: &str, token: &str) -> String {
    format!("[mcp_servers.{SERVER_NAME}]\nurl = \"{url}\"\nhttp_headers = {{ Authorization = \"Bearer {token}\" }}\n")
}

/// Is this line the header of our table or one of its sub-tables?
fn is_our_header(line: &str) -> bool {
    let t = line.trim();
    let ours = format!("[mcp_servers.{SERVER_NAME}");
    t.starts_with(&ours) && matches!(t[ours.len()..].chars().next(), Some(']') | Some('.'))
}

/// `config` without our table (and its sub-tables); everything else kept byte for byte.
pub fn strip_block(config: &str) -> String {
    let mut out = String::with_capacity(config.len());
    let mut skipping = false;
    for line in config.split_inclusive('\n') {
        let t = line.trim_start();
        if t.starts_with('[') {
            skipping = is_our_header(t);
        }
        if !skipping {
            out.push_str(line);
        }
    }
    out
}

/// Our table's text, if present.
pub fn our_block(config: &str) -> Option<String> {
    let stripped = strip_block(config);
    (stripped.len() != config.len()).then(|| {
        let mut block = String::new();
        let mut inside = false;
        for line in config.split_inclusive('\n') {
            let t = line.trim_start();
            if t.starts_with('[') {
                inside = is_our_header(t);
            }
            if inside {
                block.push_str(line);
            }
        }
        block
    })
}

pub fn with_block(config: &str, url: &str, token: &str) -> String {
    let mut out = strip_block(config).trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(&codex_block(url, token));
    out
}

fn codex_state(url: &str, token: &str) -> SetupState {
    let installed = codex_dir().is_some_and(|d| d.is_dir()) || crate::tools::find_program("codex").is_some();
    let config = codex_config().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    match our_block(&config) {
        Some(b) if b.contains(&format!("url = \"{url}\"")) && b.contains(&format!("Bearer {token}\"")) => SetupState::Ready,
        Some(_) => SetupState::Outdated,
        None if installed => SetupState::Missing,
        None => SetupState::NotInstalled,
    }
}

/// Writes through a temporary file, so a crash never leaves half a config. Backs up the first time.
fn write_codex(next: &str) -> AppResult<()> {
    let path = codex_config().ok_or_else(|| AppError::internal("No home folder."))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let backup = path.with_extension("toml.before-boards");
    if path.exists() && !backup.exists() {
        std::fs::copy(&path, &backup)?;
    }
    let tmp = path.with_extension("toml.boards-tmp");
    std::fs::write(&tmp, next)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

fn codex_setup(url: &str, token: &str) -> AppResult<()> {
    let current = codex_config().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    write_codex(&with_block(&current, url, token))
}

fn codex_remove() -> AppResult<()> {
    let Some(current) = codex_config().and_then(|p| std::fs::read_to_string(p).ok()) else { return Ok(()) };
    if our_block(&current).is_none() {
        return Ok(());
    }
    write_codex(&strip_block(&current))
}

// ----- shared -----

pub fn statuses(url: &str, token: &str) -> Vec<ClientStatus> {
    vec![
        ClientStatus { id: "claude", name: "Claude Code", state: claude_state(url, token), detail: None },
        ClientStatus { id: "codex", name: "Codex", state: codex_state(url, token), detail: None },
    ]
}

pub fn setup(id: &str, url: &str, token: &str) -> AppResult<()> {
    match id {
        "claude" => claude_setup(url, token),
        "codex" => codex_setup(url, token),
        _ => Err(AppError::validation(format!("Unknown tool: {id}"))),
    }
}

pub fn remove(id: &str) -> AppResult<()> {
    match id {
        "claude" => claude_remove(),
        "codex" => codex_remove(),
        _ => Err(AppError::validation(format!("Unknown tool: {id}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = "model = \"x\"\n\n[mcp_servers.pencil]\ncommand = \"p\"\n\n[mcp_servers.boards]\nurl = \"old\"\n\n[mcp_servers.boards.env]\nA = \"1\"\n\n[mcp_servers.boardsx]\ncommand = \"keep\"\n\n[projects.\"/a\"]\ntrust_level = \"trusted\"\n";

    #[test]
    fn strips_only_our_table_and_its_subtables() {
        let s = strip_block(CONFIG);
        assert!(!s.contains("url = \"old\"") && !s.contains("A = \"1\""));
        assert!(s.contains("[mcp_servers.pencil]") && s.contains("[mcp_servers.boardsx]") && s.contains("trust_level"));
        assert_eq!(strip_block("model = 1\n"), "model = 1\n");
    }

    /// Sets up and removes both tools for real, in a throwaway home folder.
    /// Changes HOME for the process, so it only runs on request: `cargo test -- --ignored setup_round_trip`.
    #[test]
    #[ignore]
    fn setup_round_trip() {
        let home = std::env::temp_dir().join(format!("boards-mcp-home-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(home.join(".codex/config.toml"), CONFIG).unwrap();
        std::env::set_var("HOME", &home);
        let (url, token) = ("http://127.0.0.1:47615/mcp", "tok123");
        let state = |id: &str| statuses(url, token).into_iter().find(|c| c.id == id).unwrap().state;

        assert_eq!(state("codex"), SetupState::Outdated);
        setup("codex", url, token).unwrap();
        assert_eq!(state("codex"), SetupState::Ready);
        assert!(home.join(".codex/config.toml.before-boards").exists());
        let written = std::fs::read_to_string(home.join(".codex/config.toml")).unwrap();
        assert!(written.contains("[mcp_servers.pencil]") && written.contains("trust_level"));
        assert_eq!(statuses(url, "other").into_iter().find(|c| c.id == "codex").unwrap().state, SetupState::Outdated);
        remove("codex").unwrap();
        assert_eq!(state("codex"), SetupState::Missing);

        if crate::tools::find_program("claude").is_some() {
            assert_eq!(state("claude"), SetupState::Missing);
            setup("claude", url, token).unwrap();
            assert_eq!(state("claude"), SetupState::Ready);
            setup("claude", url, token).unwrap(); // again: replaces, does not fail
            remove("claude").unwrap();
            assert_eq!(state("claude"), SetupState::Missing);
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn writes_one_fresh_block() {
        let next = with_block(CONFIG, "http://127.0.0.1:1/mcp", "tok");
        assert_eq!(next.matches("[mcp_servers.boards]").count(), 1);
        assert!(next.ends_with("[mcp_servers.boards]\nurl = \"http://127.0.0.1:1/mcp\"\nhttp_headers = { Authorization = \"Bearer tok\" }\n"));
        assert!(next.contains("[mcp_servers.pencil]"));
        assert_eq!(with_block("", "u", "t"), codex_block("u", "t"));
        let block = our_block(&next).unwrap();
        assert!(block.contains("Bearer tok"));
        assert!(our_block("model = 1\n").is_none());
    }
}
