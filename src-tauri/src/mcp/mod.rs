//! A local MCP server, so Claude Code, Codex and other AI tools can read and change work items
//! through the account Boards is signed in to.
//!
//! Self-contained: everything lives in this folder plus `src/lib/mcp.ts` and
//! `src/components/sheets/McpSettings.tsx`. See README.md here for how to remove it.
//!
//! Transport: MCP "Streamable HTTP" (JSON responses, no streaming) on 127.0.0.1 only,
//! behind a bearer token stored in `mcp.json` in the app's config folder. Off until the user turns it on.

mod protocol;
mod tools;

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

pub const DEFAULT_PORT: u16 = 47615;
const MAX_BODY: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub token: String,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

impl Default for McpConfig {
    fn default() -> Self {
        Self { enabled: false, read_only: false, port: DEFAULT_PORT, token: String::new() }
    }
}

/// What the Settings section shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    #[serde(flatten)]
    pub config: McpConfig,
    pub running: bool,
    pub url: String,
    pub error: Option<String>,
}

struct Running {
    server: Arc<tiny_http::Server>,
    port: u16,
}

static SERVER: Mutex<Option<Running>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
/// What the user has open in the window, sent by the UI (`mcp_set_context`).
static CONTEXT: Mutex<Option<Value>> = Mutex::new(None);
static CONFIG: Mutex<Option<McpConfig>> = Mutex::new(None);

pub(crate) fn context() -> Value {
    CONTEXT.lock().ok().and_then(|c| c.clone()).unwrap_or_else(|| json!({}))
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_config_dir().map_err(|e| AppError::internal(e.to_string()))?.join("mcp.json"))
}

fn load_config(app: &AppHandle) -> McpConfig {
    let mut cfg: McpConfig = config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    if cfg.token.is_empty() {
        cfg.token = new_token();
        let _ = save_config(app, &cfg);
    }
    cfg
}

fn save_config(app: &AppHandle, cfg: &McpConfig) -> AppResult<()> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(cfg)?)?;
    // The token lets a local program act as the user; keep the file to the user alone.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn current_config() -> McpConfig {
    CONFIG.lock().ok().and_then(|c| c.clone()).unwrap_or_default()
}

fn new_token() -> String {
    let mut bytes = [0u8; 24];
    if getrandom::getrandom(&mut bytes).is_err() {
        // No OS randomness: fall back to the process's hash seeds, still unguessable from outside.
        use std::hash::{BuildHasher, Hasher};
        for chunk in bytes.chunks_mut(8) {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
            chunk.copy_from_slice(&h.finish().to_le_bytes()[..chunk.len()]);
        }
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Called once from the app's setup: loads the config and starts the server if it is turned on.
pub fn init(app: &AppHandle) {
    let cfg = load_config(app);
    if let Ok(mut c) = CONFIG.lock() {
        *c = Some(cfg.clone());
    }
    if cfg.enabled {
        start(app, cfg.port);
    }
}

fn set_error(e: Option<String>) {
    if let Ok(mut le) = LAST_ERROR.lock() {
        *le = e;
    }
}

fn stop() {
    if let Ok(mut s) = SERVER.lock() {
        if let Some(r) = s.take() {
            r.server.unblock();
        }
    }
}

fn start(app: &AppHandle, port: u16) {
    stop();
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            set_error(Some(format!("Could not listen on port {port}: {e}")));
            return;
        }
    };
    set_error(None);
    if let Ok(mut s) = SERVER.lock() {
        *s = Some(Running { server: server.clone(), port });
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let app = app.clone();
            // Tool calls wait on Azure DevOps; one slow call must not hold up the next.
            std::thread::spawn(move || serve(&app, port, request));
        }
    });
}

fn respond(request: tiny_http::Request, status: u16, body: Option<Value>) {
    let mut res = tiny_http::Response::from_string(body.map(|b| b.to_string()).unwrap_or_default()).with_status_code(status);
    if let Ok(h) = tiny_http::Header::from_bytes("Content-Type", "application/json") {
        res = res.with_header(h);
    }
    let _ = request.respond(res);
}

fn header<'a>(request: &'a tiny_http::Request, name: &'static str) -> Option<&'a str> {
    request.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

/// Same length and bytes, compared without stopping at the first difference.
fn token_matches(given: &str, expected: &str) -> bool {
    !expected.is_empty() && given.len() == expected.len() && given.bytes().zip(expected.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// Only this machine, by its loopback names: guards against DNS rebinding from a web page.
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    [format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}")].iter().any(|h| h.eq_ignore_ascii_case(host))
}

/// Browsers send an Origin; AI tools do not. A page on another site may not call in.
pub fn origin_allowed(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => ["http://127.0.0.1", "http://localhost", "tauri://localhost"].iter().any(|p| o == *p || o.starts_with(&format!("{p}:"))),
    }
}

fn serve(app: &AppHandle, port: u16, mut request: tiny_http::Request) {
    let path = request.url().split('?').next().unwrap_or("").to_string();
    if path != "/mcp" {
        return respond(request, 404, Some(json!({ "error": "Not found. The MCP endpoint is /mcp." })));
    }
    if !host_allowed(header(&request, "Host"), port) || !origin_allowed(header(&request, "Origin")) {
        return respond(request, 403, Some(json!({ "error": "Forbidden" })));
    }
    let cfg = current_config();
    let auth = header(&request, "Authorization").and_then(|a| a.strip_prefix("Bearer ")).unwrap_or("");
    if !token_matches(auth.trim(), &cfg.token) {
        return respond(request, 401, Some(json!({ "error": "Missing or wrong token. Copy the command again from Boards → Settings → AI tools (MCP)." })));
    }
    match request.method() {
        tiny_http::Method::Post => {}
        // No server-to-client stream and no sessions to end.
        _ => return respond(request, 405, None),
    }
    let mut body = String::new();
    if request.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return respond(request, 400, Some(json!({ "error": "Unreadable body" })));
    }
    let defs = tools::definitions(cfg.read_only);
    let call = |name: &str, args: Value| tauri::async_runtime::block_on(tools::call(app, &cfg, name, args));
    match protocol::handle_body(&body, &defs, &call) {
        Some(reply) => respond(request, 200, Some(reply)),
        None => respond(request, 202, None),
    }
}

fn status() -> McpStatus {
    let config = current_config();
    let running = SERVER.lock().ok().and_then(|s| s.as_ref().map(|r| r.port)).is_some();
    McpStatus {
        url: format!("http://127.0.0.1:{}/mcp", config.port),
        config,
        running,
        error: LAST_ERROR.lock().ok().and_then(|e| e.clone()),
    }
}

// ----- commands for the Settings section and the UI bridge -----

#[tauri::command]
pub fn mcp_status() -> McpStatus {
    status()
}

#[tauri::command]
pub fn mcp_configure(app: AppHandle, enabled: bool, read_only: bool, port: Option<u16>) -> AppResult<McpStatus> {
    let mut cfg = current_config();
    let port = port.unwrap_or(cfg.port);
    if port < 1024 {
        return Err(AppError::validation("Pick a port from 1024 to 65535."));
    }
    let restart = enabled && (!cfg.enabled || port != cfg.port);
    cfg.enabled = enabled;
    cfg.read_only = read_only;
    cfg.port = port;
    save_config(&app, &cfg)?;
    if let Ok(mut c) = CONFIG.lock() {
        *c = Some(cfg);
    }
    if !enabled {
        stop();
        set_error(None);
    } else if restart || status().error.is_some() || !status().running {
        start(&app, port);
    }
    Ok(status())
}

/// A new token; tools set up with the old one stop working until their command is copied again.
#[tauri::command]
pub fn mcp_new_token(app: AppHandle) -> AppResult<McpStatus> {
    let mut cfg = current_config();
    cfg.token = new_token();
    save_config(&app, &cfg)?;
    if let Ok(mut c) = CONFIG.lock() {
        *c = Some(cfg);
    }
    Ok(status())
}

#[tauri::command]
pub fn mcp_set_context(context: Value) {
    if let Ok(mut c) = CONTEXT.lock() {
        *c = Some(context);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_hosts_and_origins() {
        assert!(host_allowed(Some("127.0.0.1:47615"), 47615));
        assert!(host_allowed(Some("localhost:47615"), 47615));
        assert!(!host_allowed(Some("evil.com:47615"), 47615));
        assert!(!host_allowed(Some("127.0.0.1:1"), 47615));
        assert!(!host_allowed(None, 47615));
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("http://localhost:3000")));
        assert!(!origin_allowed(Some("https://evil.com")));
        assert!(!origin_allowed(Some("http://localhost.evil.com")));
    }

    #[test]
    fn tokens_compare_exactly() {
        assert!(token_matches("abc", "abc"));
        assert!(!token_matches("abd", "abc"));
        assert!(!token_matches("ab", "abc"));
        assert!(!token_matches("", ""));
        assert_eq!(new_token().len(), 48);
        assert_ne!(new_token(), new_token());
    }
}
