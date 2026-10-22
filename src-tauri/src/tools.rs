//! Runs the user's locally installed `git-tools` CLI (https://github.com/davidyytan/git-tools)
//! inside a repository checkout and returns what it produced.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::io::Read;
use std::process::{Command, Output, Stdio};
use tauri::ipc::Channel;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRun {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    /// Clipboard text after the run, when it changed (git-tools copies its result there).
    pub clipboard: Option<String>,
}

/// Program names `run_git_tools` accepts, as the last component of `bin`.
const GIT_TOOLS_NAMES: &[&str] = &["git-tools", "git-tools.exe", "git-tools.cmd"];

/// True when the last path component of `bin` is the git-tools executable.
pub fn is_git_tools_name(bin: &str) -> bool {
    let Some(name) = Path::new(bin).file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if cfg!(windows) {
        GIT_TOOLS_NAMES.iter().any(|n| n.eq_ignore_ascii_case(name))
    } else {
        GIT_TOOLS_NAMES.contains(&name)
    }
}

/// The PATH programs are looked up in. A GUI app on macOS does not inherit the login shell's
/// PATH (uv tools, Homebrew), so it is read once from `$SHELL -l`; the command string is fixed.
fn search_path() -> &'static OsString {
    static PATH: OnceLock<OsString> = OnceLock::new();
    PATH.get_or_init(|| {
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        #[cfg(not(windows))]
        {
            let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
            let login = Command::new(shell)
                .args(["-lc", "printf %s \"$PATH\""])
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .ok()
                .filter(|o| o.status.success())
                // Profile scripts may print first; the PATH is whatever follows the last newline.
                .and_then(|o| String::from_utf8_lossy(&o.stdout).rsplit('\n').next().map(|s| s.trim().to_string()))
                .filter(|p| !p.is_empty());
            if let Some(p) = login {
                let mut joined = OsString::from(p);
                if !inherited.is_empty() {
                    joined.push(":");
                    joined.push(&inherited);
                }
                return joined;
            }
        }
        inherited
    })
}

#[cfg(not(windows))]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

/// File names to try for `name` in one PATH directory (adds PATHEXT extensions on Windows).
fn candidates(name: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        if Path::new(name).extension().is_some() {
            return vec![name.to_string()];
        }
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        exts.split(';').filter(|e| !e.is_empty()).map(|e| format!("{name}{}", e.to_ascii_lowercase())).collect()
    }
    #[cfg(not(windows))]
    {
        vec![name.to_string()]
    }
}

/// An absolute program path as given, or a bare name found on `path`.
fn resolve(program: &str, path: &OsStr) -> AppResult<PathBuf> {
    let p = Path::new(program);
    if p.components().count() > 1 {
        if p.is_absolute() && is_executable(p) {
            return Ok(p.to_path_buf());
        }
        return Err(AppError::validation(format!("{program} is not an executable file. Give its full path or just its name.")));
    }
    std::env::split_paths(path)
        .flat_map(|dir| candidates(program).into_iter().map(move |c| dir.join(c)))
        .find(|c| is_executable(c))
        .ok_or_else(|| AppError::validation(format!("Could not find {program} on your PATH.")))
}

/// A program run directly (no shell), with the login PATH, in `cwd`.
fn command(program: &Path, args: &[String], cwd: &Path) -> Command {
    let mut c = Command::new(program);
    c.args(args)
        .current_dir(cwd)
        .env("PATH", search_path())
        // No terminal to answer a credential prompt; fail instead of waiting forever.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());
    c
}

fn start_error(program: &Path, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::InvalidInput {
        // Windows refuses arguments it cannot pass safely to a .cmd/.bat file.
        AppError::validation(format!("Those arguments cannot be passed to {}: {e}", program.display()))
    } else {
        AppError::internal(format!("Could not start {}: {e}", program.display()))
    }
}

fn run(program: &Path, args: &[String], cwd: &Path) -> AppResult<Output> {
    command(program, args, cwd).output().map_err(|e| start_error(program, e))
}

/// One line a running tool printed, as it printed it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolLine {
    pub stream: &'static str,
    pub text: String,
}

/// Collects everything a stream prints, handing each line to `emit` as it arrives.
fn pump(mut from: impl Read, stream: &'static str, emit: &(impl Fn(ToolLine) + Sync)) -> Vec<u8> {
    let mut all = Vec::new();
    let mut pending = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = match from.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        all.extend_from_slice(&buf[..n]);
        pending.extend_from_slice(&buf[..n]);
        while let Some(i) = pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = pending.drain(..=i).collect();
            emit(ToolLine { stream, text: String::from_utf8_lossy(&line[..i]).to_string() });
        }
    }
    if !pending.is_empty() {
        emit(ToolLine { stream, text: String::from_utf8_lossy(&pending).to_string() });
    }
    all
}

/// Look up the login PATH now, so the first tool run does not wait for the login shell.
pub fn warm_up() {
    let _ = search_path();
}

/// Like `run`, but reports output line by line while the program runs. `on_spawn` gets the process id;
/// on Unix the program leads its own process group, so stopping it also stops whatever it started.
fn run_streaming(program: &Path, args: &[String], cwd: &Path, on_spawn: impl FnOnce(u32), emit: impl Fn(ToolLine) + Sync) -> AppResult<Output> {
    let mut cmd = command(program, args, cwd);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| start_error(program, e))?;
    on_spawn(child.id());
    let out = child.stdout.take();
    let err = child.stderr.take();
    // Both pipes are drained at once, so a tool that fills one while we wait on the other cannot stall.
    let (stdout, stderr) = std::thread::scope(|s| {
        let e = s.spawn(|| err.map(|r| pump(r, "stderr", &emit)).unwrap_or_default());
        let o = out.map(|r| pump(r, "stdout", &emit)).unwrap_or_default();
        (o, e.join().unwrap_or_default())
    });
    let status = child.wait().map_err(|e| AppError::internal(format!("{} did not finish: {e}", program.display())))?;
    Ok(Output { status, stdout, stderr })
}

#[tauri::command]
pub async fn git_current_branch(repo_path: String) -> AppResult<String> {
    let p = Path::new(&repo_path).to_path_buf();
    if !p.is_dir() {
        return Err(AppError::validation("That folder is not a Git repository."));
    }
    let out = tokio::task::spawn_blocking(move || -> AppResult<Output> {
        let git = resolve("git", search_path())?;
        run(&git, &["rev-parse".into(), "--abbrev-ref".into(), "HEAD".into()], &p)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))??;
    if !out.status.success() {
        return Err(AppError::validation(format!("git failed: {}", String::from_utf8_lossy(&out.stderr).trim())));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git(git: &Path, args: &[&str], cwd: &Path) -> AppResult<Output> {
    run(git, &args.iter().map(|a| a.to_string()).collect::<Vec<_>>(), cwd)
}

fn git_ok(git: &Path, args: &[&str], cwd: &Path) -> AppResult<()> {
    let out = self::git(git, args, cwd)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(AppError::validation(format!("git {} failed: {}", args[0], String::from_utf8_lossy(&out.stderr).trim())))
    }
}

/// Fetch `branch` from origin and check it out in the local repository, creating a tracking branch when needed.
#[tauri::command]
pub async fn git_checkout_branch(repo_path: String, branch: String) -> AppResult<String> {
    let branch = branch.trim_start_matches("refs/heads/").to_string();
    // Refuse anything git could read as an option before asking git whether it is a valid name.
    if branch.is_empty() || branch.starts_with('-') {
        return Err(AppError::validation("That is not a valid branch name."));
    }
    let p = Path::new(&repo_path).to_path_buf();
    if !p.is_dir() {
        return Err(AppError::validation("The repository folder does not exist."));
    }
    let task = tokio::task::spawn_blocking(move || -> AppResult<String> {
        let g = resolve("git", search_path())?;
        if !self::git(&g, &["check-ref-format", "--branch", &branch], &p)?.status.success() {
            return Err(AppError::validation("That is not a valid branch name."));
        }
        git_ok(&g, &["fetch", "origin", &format!("refs/heads/{branch}:refs/remotes/origin/{branch}")], &p)?;
        let exists = self::git(&g, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")], &p)?.status.success();
        if exists {
            git_ok(&g, &["switch", &branch], &p)?;
        } else {
            git_ok(&g, &["switch", "-c", &branch, "--track", &format!("origin/{branch}")], &p)?;
        }
        Ok(branch)
    });
    tokio::time::timeout(Duration::from_secs(120), task)
        .await
        .map_err(|_| AppError::internal("git took too long (over 2 minutes)."))?
        .map_err(|e| AppError::internal(e.to_string()))?
}

/// The git-tools process running now, so it can be stopped. One run at a time.
static RUNNING: Mutex<Option<u32>> = Mutex::new(None);
static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Stop the running git-tools and everything it started. Returns whether one was running.
fn stop_running() -> bool {
    let Some(pid) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).take() else { return false };
    #[cfg(unix)]
    let _ = Command::new("/bin/kill").args(["-TERM", &format!("-{pid}")]).stdin(Stdio::null()).output();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW).stdin(Stdio::null()).output();
    }
    true
}

/// Cancel the running git-tools; its `run_git_tools` call then fails with "cancelled".
#[tauri::command]
pub fn cancel_git_tools() -> bool {
    CANCELLED.store(true, Ordering::SeqCst);
    stop_running()
}

/// Runs `<bin> <args...>` in the repo. Only the git-tools command is allowed.
#[tauri::command]
pub async fn run_git_tools(repo_path: String, bin: Option<String>, args: Vec<String>, on_output: Channel<ToolLine>) -> AppResult<ToolRun> {
    let bin = bin.unwrap_or_else(|| "git-tools".into());
    if !is_git_tools_name(&bin) {
        return Err(AppError::validation("Only the git-tools command can be run from here."));
    }
    let p = Path::new(&repo_path).to_path_buf();
    if !p.is_dir() {
        return Err(AppError::validation("The repository folder does not exist."));
    }
    let before = arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok());
    CANCELLED.store(false, Ordering::SeqCst);
    let task = tokio::task::spawn_blocking(move || -> AppResult<Output> {
        let program = resolve(&bin, search_path())?;
        let out = run_streaming(&program, &args, &p, |pid| *RUNNING.lock().unwrap_or_else(|e| e.into_inner()) = Some(pid), |line| {
            let _ = on_output.send(line);
        });
        RUNNING.lock().unwrap_or_else(|e| e.into_inner()).take();
        out
    });
    let out = match tokio::time::timeout(Duration::from_secs(240), task).await {
        Ok(joined) => joined.map_err(|e| AppError::internal(e.to_string()))??,
        Err(_) => {
            stop_running();
            return Err(AppError::internal("git-tools took too long (over 4 minutes) and was stopped."));
        }
    };
    if CANCELLED.load(Ordering::SeqCst) {
        return Err(AppError::validation("cancelled"));
    }
    let after = arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok());
    let clipboard = match (before, after) {
        (Some(b), Some(a)) if a != b && !a.trim().is_empty() => Some(a),
        (None, Some(a)) if !a.trim().is_empty() => Some(a),
        _ => None,
    };
    Ok(ToolRun {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        clipboard,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_git_tools_may_run() {
        assert!(is_git_tools_name("git-tools"));
        assert!(is_git_tools_name("/Users/me/.local/bin/git-tools"));
        assert!(is_git_tools_name("git-tools.exe"));
        assert!(is_git_tools_name("git-tools.cmd"));
        assert!(!is_git_tools_name("evil; git-tools"));
        assert!(!is_git_tools_name("my-git-tools"));
        assert!(!is_git_tools_name("/bin/sh"));
        assert!(!is_git_tools_name("git-tools.bat"));
        assert!(!is_git_tools_name(""));
        assert_eq!(is_git_tools_name("GIT-TOOLS.EXE"), cfg!(windows));
    }

    #[test]
    fn pump_splits_lines_and_keeps_everything() {
        let lines = std::sync::Mutex::new(Vec::new());
        let all = pump(&b"one\ntwo\r\nthree"[..], "stdout", &|l: ToolLine| lines.lock().unwrap().push(l.text));
        assert_eq!(all, b"one\ntwo\r\nthree");
        assert_eq!(*lines.lock().unwrap(), vec!["one", "two\r", "three"]);
    }

    #[cfg(unix)]
    #[test]
    fn streaming_reports_both_streams_and_the_full_output() {
        let lines = std::sync::Mutex::new(Vec::new());
        let sh = resolve("sh", OsStr::new("/bin:/usr/bin")).unwrap();
        let args = vec!["-c".to_string(), "echo out; echo err 1>&2; exit 3".to_string()];
        let out = run_streaming(&sh, &args, Path::new("/"), |_| {}, |l| lines.lock().unwrap().push((l.stream, l.text))).unwrap();
        assert_eq!(out.status.code(), Some(3));
        assert_eq!(out.stdout, b"out\n");
        let got = lines.lock().unwrap().clone();
        assert!(got.contains(&("stdout", "out".to_string())));
        assert!(got.contains(&("stderr", "err".to_string())));
    }

    #[cfg(unix)]
    #[test]
    fn stopping_ends_the_whole_process_group() {
        let sh = resolve("sh", OsStr::new("/bin:/usr/bin")).unwrap();
        // The shell starts a child; both must go when the run is stopped.
        let args = vec!["-c".to_string(), "sleep 30 & wait".to_string()];
        let started = std::time::Instant::now();
        let out = run_streaming(&sh, &args, Path::new("/"), |pid| {
            *RUNNING.lock().unwrap() = Some(pid);
            std::thread::spawn(|| { std::thread::sleep(Duration::from_millis(300)); stop_running(); });
        }, |_| {}).unwrap();
        assert!(!out.status.success());
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn relative_paths_are_not_resolved() {
        assert!(resolve("./git-tools", OsStr::new("")).is_err());
        assert!(resolve("sub/git-tools", OsStr::new("")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn bare_names_are_found_on_the_path() {
        let found = resolve("sh", OsStr::new("/nonexistent:/bin:/usr/bin")).unwrap();
        assert!(found.ends_with("sh"));
        assert!(resolve("definitely-not-a-program-xyz", OsStr::new("/bin")).is_err());
    }
}
