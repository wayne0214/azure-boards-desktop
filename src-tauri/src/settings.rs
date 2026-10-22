use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub org: String,
    pub user_id: String,
    pub user_name: String,
    #[serde(default)]
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub active_org: Option<String>,
    #[serde(default)]
    pub recent: Vec<RecentTarget>,
    #[serde(default)]
    pub pinned_projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentTarget {
    pub org: String,
    pub project_id: String,
    pub project_name: String,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    pub board_id: Option<String>,
}

pub struct SettingsStore {
    path: PathBuf,
    data: Mutex<Settings>,
}

impl SettingsStore {
    /// Loads settings.json. A file that cannot be parsed is kept as `settings.json.bad-<secs>`
    /// and the app starts from defaults instead of silently overwriting it.
    pub fn open(dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&dir)?;
        let path = dir.join("settings.json");
        let data = if path.exists() {
            let raw = fs::read_to_string(&path)?;
            match serde_json::from_str(&raw) {
                Ok(s) => s,
                Err(_) => {
                    fs::rename(&path, dir.join(format!("settings.json.bad-{}", unix_secs())))?;
                    Settings::default()
                }
            }
        } else {
            Settings::default()
        };
        Ok(Self { path, data: Mutex::new(data) })
    }

    pub fn get(&self) -> AppResult<Settings> {
        Ok(self.lock()?.clone())
    }

    pub fn update<F: FnOnce(&mut Settings)>(&self, f: F) -> AppResult<Settings> {
        let mut guard = self.lock()?;
        let mut next = guard.clone();
        f(&mut next);
        write_atomic(&self.path, &serde_json::to_string_pretty(&next)?)?;
        *guard = next;
        Ok(guard.clone())
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Settings>> {
        self.data.lock().map_err(|_| AppError::internal("Settings are unavailable after an earlier failure. Restart the app."))
    }
}

/// Writes `path.tmp` beside the target, then renames it over, so a crash never leaves half a file.
fn write_atomic(path: &Path, contents: &str) -> AppResult<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("boards-settings-{name}-{}-{}", std::process::id(), unix_secs()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn corrupt_settings_are_kept_aside_and_defaults_used() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), "{ not json").unwrap();
        let store = SettingsStore::open(dir.clone()).unwrap();
        assert!(store.get().unwrap().accounts.is_empty());
        assert!(!dir.join("settings.json").exists());
        let kept: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.bad-"))
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(fs::read_to_string(kept[0].path()).unwrap(), "{ not json");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn updates_are_written_and_reloaded() {
        let dir = temp_dir("roundtrip");
        let store = SettingsStore::open(dir.clone()).unwrap();
        store.update(|s| s.active_org = Some("contoso".into())).unwrap();
        assert!(!dir.join("settings.json.tmp").exists());
        let reopened = SettingsStore::open(dir.clone()).unwrap();
        assert_eq!(reopened.get().unwrap().active_org.as_deref(), Some("contoso"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
