use crate::ado::api::{self, FieldMap};
use crate::ado::client::AdoClient;
use crate::cache::Cache;
use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::settings::SettingsStore;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

pub struct AppState {
    pub settings: SettingsStore,
    pub cache: Cache,
    clients: Mutex<HashMap<String, AdoClient>>,
    fields: Mutex<HashMap<String, FieldMap>>,
    /// Files the user chose in a native dialog; only these may be read or written for the UI.
    picked_paths: std::sync::Mutex<HashSet<PathBuf>>,
}

impl AppState {
    pub fn new(settings: SettingsStore, cache: Cache) -> Self {
        Self {
            settings,
            cache,
            clients: Mutex::new(HashMap::new()),
            fields: Mutex::new(HashMap::new()),
            picked_paths: std::sync::Mutex::new(HashSet::new()),
        }
    }

    /// The cached client for `org`, or a new one built from the keychain token. The keychain read
    /// blocks, so it runs off the async workers and without holding the clients lock.
    pub async fn client(&self, org: &str) -> AppResult<AdoClient> {
        if let Some(c) = self.clients.lock().await.get(org) {
            return Ok(c.clone());
        }
        let org_owned = org.to_string();
        let pat = tokio::task::spawn_blocking(move || secrets::load_pat(&org_owned))
            .await
            .map_err(|e| AppError::internal(format!("Keychain read failed: {e}")))??;
        let client = AdoClient::new(org, &pat)?;
        // Another call may have built one meanwhile; keep the first so callers share it.
        let mut clients = self.clients.lock().await;
        Ok(clients.entry(org.to_string()).or_insert(client).clone())
    }

    pub async fn forget_client(&self, org: &str) {
        self.clients.lock().await.remove(org);
        self.fields.lock().await.remove(org);
    }

    pub async fn fields(&self, client: &AdoClient) -> AppResult<FieldMap> {
        let org = client.org().to_string();
        if let Some(f) = self.fields.lock().await.get(&org) {
            return Ok(f.clone());
        }
        let fetched = api::org_fields(client).await?;
        self.fields.lock().await.insert(org, fetched.clone());
        Ok(fetched)
    }

    /// Remembers a path the user picked in a dialog.
    pub fn allow_path(&self, path: PathBuf) -> AppResult<()> {
        self.picked_paths.lock().map_err(|_| AppError::internal("File access is unavailable. Restart the app."))?.insert(path);
        Ok(())
    }

    /// Fails unless the user picked `path` in a dialog during this session.
    pub fn check_path(&self, path: &Path) -> AppResult<()> {
        let picked = self.picked_paths.lock().map_err(|_| AppError::internal("File access is unavailable. Restart the app."))?;
        if picked.contains(path) {
            Ok(())
        } else {
            Err(AppError::validation("Choose the file again; only files picked in this session can be used."))
        }
    }
}
