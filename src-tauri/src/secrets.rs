use crate::error::{AppError, AppResult, ErrorKind};
use keyring::Entry;

const SERVICE: &str = "com.jiahaolai.azureboardsdesktop";

fn entry(org: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, &format!("pat:{org}"))?)
}

pub fn save_pat(org: &str, pat: &str) -> AppResult<()> {
    entry(org)?.set_password(pat)?;
    Ok(())
}

pub fn load_pat(org: &str) -> AppResult<String> {
    match entry(org)?.get_password() {
        Ok(p) => Ok(p),
        Err(keyring::Error::NoEntry) => Err(AppError::new(
            ErrorKind::Unauthorized,
            "No saved token for this organization. Sign in again.",
        )),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_pat(org: &str) -> AppResult<()> {
    match entry(org)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

