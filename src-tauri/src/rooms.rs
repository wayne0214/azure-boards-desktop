//! Meeting rooms, booked through the Teamup calendar API. Each sub-calendar is one room.
//! Responses are passed through as JSON; the UI decides what to show.

use crate::error::{AppError, AppResult, ErrorKind};
use reqwest::{Method, StatusCode};
use serde_json::Value;
use std::time::Duration;

const BASE: &str = "https://api.teamup.com";

fn check_calendar(calendar: &str) -> AppResult<&str> {
    let c = calendar.trim();
    if c.is_empty() || !c.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(AppError::validation("The Teamup calendar key should look like \"ks1a2b3c4d5e6f7g8h\"."));
    }
    Ok(c)
}

fn check_date(d: &str) -> AppResult<&str> {
    let ok = d.len() == 10 && d.chars().enumerate().all(|(i, ch)| if i == 4 || i == 7 { ch == '-' } else { ch.is_ascii_digit() });
    if !ok {
        return Err(AppError::validation("Dates must be YYYY-MM-DD."));
    }
    Ok(d)
}

/// Set at build time by build.rs (TEAMUP_API_KEY or src-tauri/teamup.key).
const TEAMUP_API_KEY: &str = env!("TEAMUP_API_KEY");

fn api_key() -> AppResult<&'static str> {
    if TEAMUP_API_KEY.is_empty() {
        return Err(AppError::new(ErrorKind::Unauthorized, "This build has no Teamup API key. Put it in src-tauri/teamup.key and rebuild."));
    }
    Ok(TEAMUP_API_KEY)
}

async fn call(method: Method, path: &str, query: &[(&str, &str)], body: Option<&Value>) -> AppResult<Value> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()?;
    let mut req = client
        .request(method, format!("{BASE}{path}"))
        .header("Teamup-Token", api_key()?)
        .header("Accept", "application/json")
        .query(query);
    if let Some(b) = body {
        req = req.json(b);
    }
    let res = req.send().await.map_err(|e| {
        if e.is_connect() { AppError::new(ErrorKind::Network, "Could not reach Teamup. Check your connection.") } else { e.into() }
    })?;
    let status = res.status();
    let text = res.text().await?;
    if status.is_success() {
        return Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text)? });
    }
    // Teamup errors look like {"error":{"id":"...","title":"...","message":"..."}}.
    let detail = serde_json::from_str::<Value>(&text).ok().and_then(|v| {
        let e = v.get("error")?;
        e.get("message").or_else(|| e.get("title")).and_then(Value::as_str).map(str::to_string)
    });
    let (kind, fallback) = match status {
        StatusCode::UNAUTHORIZED => (ErrorKind::Unauthorized, "Teamup did not accept the API key."),
        StatusCode::FORBIDDEN => (ErrorKind::Forbidden, "This calendar link does not allow booking. Use a calendar key with modify rights."),
        StatusCode::NOT_FOUND => (ErrorKind::NotFound, "Teamup could not find that calendar or booking."),
        StatusCode::CONFLICT => (ErrorKind::Conflict, "The room was just booked by someone else."),
        StatusCode::TOO_MANY_REQUESTS => (ErrorKind::RateLimited, "Teamup is rate limiting requests. Try again in a minute."),
        _ => (ErrorKind::Network, "Teamup returned an error."),
    };
    let msg = detail.map(|d| strip_tags(&d)).unwrap_or_else(|| fallback.to_string());
    Err(AppError::new(kind, msg).with_status(status.as_u16()))
}

/// Teamup messages sometimes carry simple HTML; show them as plain text.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

#[tauri::command]
pub fn rooms_has_key() -> bool {
    !TEAMUP_API_KEY.is_empty()
}

#[tauri::command]
pub async fn rooms_list(calendar: String) -> AppResult<Value> {
    let calendar = check_calendar(&calendar)?;
    call(Method::GET, &format!("/{calendar}/subcalendars"), &[], None).await
}

/// Custom event fields (e.g. "Type of meeting"). Needs an admin calendar key; the UI falls back when refused.
#[tauri::command]
pub async fn rooms_fields(calendar: String) -> AppResult<Value> {
    let calendar = check_calendar(&calendar)?;
    call(Method::GET, &format!("/{calendar}/field-definitions"), &[], None).await
}

#[tauri::command]
pub async fn rooms_events(calendar: String, start_date: String, end_date: String) -> AppResult<Value> {
    let calendar = check_calendar(&calendar)?;
    let (s, e) = (check_date(&start_date)?, check_date(&end_date)?);
    call(Method::GET, &format!("/{calendar}/events"), &[("startDate", s), ("endDate", e)], None).await
}

#[tauri::command]
pub async fn rooms_book(calendar: String, event: Value) -> AppResult<Value> {
    let calendar = check_calendar(&calendar)?;
    call(Method::POST, &format!("/{calendar}/events"), &[], Some(&event)).await
}

#[tauri::command]
pub async fn rooms_cancel(calendar: String, event_id: String, version: Option<String>) -> AppResult<()> {
    let calendar = check_calendar(&calendar)?;
    if event_id.is_empty() || !event_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::validation("Unknown booking."));
    }
    let v = version.unwrap_or_default();
    let q: Vec<(&str, &str)> = if v.is_empty() { vec![] } else { vec![("version", v.as_str())] };
    call(Method::DELETE, &format!("/{calendar}/events/{event_id}"), &q, None).await?;
    Ok(())
}
