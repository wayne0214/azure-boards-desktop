//! The updater is switched on by the release build, which adds the signing public key and the
//! update feed to the config. Builds without them (local and dev builds) skip update checks.
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn updater_configured<R: Runtime>(app: AppHandle<R>) -> bool {
    is_configured(app.config().plugins.0.get("updater"))
}

fn is_configured(cfg: Option<&serde_json::Value>) -> bool {
    let Some(cfg) = cfg else { return false };
    let has_key = cfg.get("pubkey").and_then(|k| k.as_str()).is_some_and(|k| !k.trim().is_empty());
    let has_feed = cfg.get("endpoints").and_then(|e| e.as_array()).is_some_and(|e| !e.is_empty());
    has_key && has_feed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn needs_both_a_key_and_a_feed() {
        assert!(!is_configured(None));
        assert!(!is_configured(Some(&json!({ "pubkey": "", "endpoints": [] }))));
        assert!(!is_configured(Some(&json!({ "pubkey": "abc", "endpoints": [] }))));
        assert!(!is_configured(Some(&json!({ "pubkey": " ", "endpoints": ["https://x/latest.json"] }))));
        assert!(is_configured(Some(&json!({ "pubkey": "abc", "endpoints": ["https://x/latest.json"] }))));
    }
}
