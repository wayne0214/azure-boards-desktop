use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Cache {
    conn: Mutex<Connection>,
}

impl Cache {
    pub fn open(dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&dir)?;
        let conn = Connection::open(dir.join("cache.sqlite"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS kv (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| AppError::internal("The cache is unavailable after an earlier failure. Restart the app."))
    }

    pub fn get(&self, key: &str) -> AppResult<Option<(String, i64)>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT value, updated_at FROM kv WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some((row.get(0)?, row.get(1)?)))
        } else {
            Ok(None)
        }
    }

    pub fn set(&self, key: &str, value: &str) -> AppResult<()> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn clear(&self) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM kv", [])?;
        Ok(())
    }
}
