//! Keeps the main window on the app itself. Links inside rendered work item or pull request
//! HTML open in the system browser instead of replacing the app.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

const MAIN: &str = "main";

/// What to do with a navigation of the main window.
#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    Allow,
    OpenExternally,
    Block,
}

/// The app's own pages: the bundled frontend, the dev server, blank pages and IPC.
fn is_app_origin(url: &Url) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" => host == "localhost",
        "ipc" => true,
        "about" => url.path() == "blank",
        "http" | "https" if host == "tauri.localhost" || host == "ipc.localhost" => true,
        "http" => cfg!(debug_assertions) && (host == "localhost" || host == "127.0.0.1") && url.port() == Some(1420),
        _ => false,
    }
}

pub fn decide(url: &Url) -> Nav {
    if is_app_origin(url) {
        Nav::Allow
    } else if matches!(url.scheme(), "http" | "https") {
        Nav::OpenExternally
    } else {
        Nav::Block
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nav-guard")
        .on_navigation(|webview, url| {
            if webview.label() != MAIN {
                return true;
            }
            match decide(url) {
                Nav::Allow => true,
                Nav::OpenExternally => {
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                }
                Nav::Block => false,
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Nav {
        decide(&Url::parse(s).unwrap())
    }

    #[test]
    fn app_pages_stay_in_the_window() {
        assert_eq!(d("tauri://localhost/index.html"), Nav::Allow);
        assert_eq!(d("http://tauri.localhost/"), Nav::Allow);
        assert_eq!(d("https://tauri.localhost/#/board"), Nav::Allow);
        assert_eq!(d("about:blank"), Nav::Allow);
        assert_eq!(d("http://localhost:1420/") == Nav::Allow, cfg!(debug_assertions));
    }

    #[test]
    fn web_links_open_in_the_browser_and_others_are_blocked() {
        assert_eq!(d("https://dev.azure.com/org/project/_workitems/edit/1"), Nav::OpenExternally);
        assert_eq!(d("http://localhost:3000/"), Nav::OpenExternally);
        assert_eq!(d("https://tauri.localhost.evil.com/"), Nav::OpenExternally);
        assert_eq!(d("file:///etc/passwd"), Nav::Block);
        assert_eq!(d("javascript:alert(1)"), Nav::Block);
        assert_eq!(d("ms-settings:privacy"), Nav::Block);
    }
}
