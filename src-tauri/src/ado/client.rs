use crate::error::{AppError, AppResult, ErrorKind};
use base64::Engine;
use reqwest::{header, redirect, Client, Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const API_VERSION: &str = "7.1";
/// Attempts for a request Azure DevOps throttled (429).
const MAX_THROTTLED_ATTEMPTS: u32 = 4;
/// Attempts for a GET that hit a server error or a network failure.
const MAX_GET_ATTEMPTS: u32 = 3;
/// Header Azure DevOps uses to hand out the next page of a list.
const CONTINUATION_HEADER: &str = "x-ms-continuationtoken";

/// The organization hosts that receive the user's token: dev.azure.com and *.visualstudio.com.
pub fn is_ado_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    h == "dev.azure.com" || (h.ends_with(".visualstudio.com") && h.len() > ".visualstudio.com".len())
}

/// True for an https URL on an Azure DevOps organization host; only those may be fetched with the token.
pub fn is_ado_url(url: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(u) => u.scheme() == "https" && u.host_str().is_some_and(is_ado_host),
        Err(_) => false,
    }
}

/// Hosts a request may be redirected to: Azure DevOps itself and the storage it serves files from.
/// reqwest drops the Authorization header whenever a redirect changes host.
fn redirect_allowed(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    let h = host.to_ascii_lowercase();
    url.scheme() == "https"
        && (is_ado_host(&h) || h.ends_with(".vsassets.io") || h.ends_with(".blob.core.windows.net"))
}

fn redirect_policy() -> redirect::Policy {
    redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            attempt.error("too many redirects")
        } else if redirect_allowed(attempt.url()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

/// Seconds or an HTTP date, as `Retry-After` allows; a date in the past means "now".
pub fn parse_retry_after(value: &str, now: SystemTime) -> Option<Duration> {
    let v = value.trim();
    if let Ok(secs) = v.parse::<u64>() {
        return Some(Duration::from_secs(secs));
    }
    let at = chrono::DateTime::parse_from_rfc2822(v).ok()?;
    let at_secs = u64::try_from(at.timestamp()).ok()?;
    let now_secs = now.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(at_secs.saturating_sub(now_secs)))
}

/// 0.5s, 1.5s, 3.5s... plus up to 250 ms of jitter so parallel requests do not retry in step.
fn backoff(attempt: u32) -> Duration {
    let base = 500u64 * ((1u64 << attempt.min(6)) - 1);
    let jitter = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::from(d.subsec_nanos()) % 250).unwrap_or(0);
    Duration::from_millis(base + jitter)
}

fn retry_after(resp: &Response) -> Option<Duration> {
    resp.headers()
        .get(header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_retry_after(v, SystemTime::now()))
}

#[derive(Clone)]
pub struct AdoClient {
    http: Client,
    org: String,
    auth_header: String,
}

impl AdoClient {
    pub fn new(org: &str, pat: &str) -> AppResult<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(45))
            .user_agent("azure-boards-desktop/1.0")
            .redirect(redirect_policy())
            .build()?;
        let token = base64::engine::general_purpose::STANDARD.encode(format!(":{pat}"));
        Ok(Self { http, org: org.to_string(), auth_header: format!("Basic {token}") })
    }

    pub fn org(&self) -> &str {
        &self.org
    }

    pub fn base(&self) -> String {
        format!("https://dev.azure.com/{}", self.org)
    }

    /// Build a URL under the org. `path` must start with "/". The api-version is appended
    /// unless the caller already included one.
    pub fn url(&self, path: &str) -> String {
        let full = format!("{}{}", self.base(), path);
        if full.contains("api-version=") {
            full
        } else if full.contains('?') {
            format!("{full}&api-version={API_VERSION}")
        } else {
            format!("{full}?api-version={API_VERSION}")
        }
    }

    /// Sends with retries: any request Azure DevOps throttled, and GETs (idempotent) that hit
    /// a 5xx gateway/server error or a connect/timeout failure.
    async fn send(&self, method: Method, url: &str, body: Option<(&str, String)>) -> AppResult<Response> {
        let idempotent = method == Method::GET;
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let mut req = self
                .http
                .request(method.clone(), url)
                .header(header::AUTHORIZATION, &self.auth_header)
                .header(header::ACCEPT, "application/json");
            if let Some((ct, b)) = &body {
                req = req.header(header::CONTENT_TYPE, *ct).body(b.clone());
            }
            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) if idempotent && (e.is_connect() || e.is_timeout()) && attempt < MAX_GET_ATTEMPTS => {
                    tokio::time::sleep(backoff(attempt)).await;
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            let status = resp.status();
            if status == StatusCode::TOO_MANY_REQUESTS && attempt < MAX_THROTTLED_ATTEMPTS {
                let wait = retry_after(&resp).unwrap_or(Duration::from_secs(2)).min(Duration::from_secs(30));
                tokio::time::sleep(wait).await;
                continue;
            }
            if idempotent && matches!(status.as_u16(), 500 | 502 | 503 | 504) && attempt < MAX_GET_ATTEMPTS {
                let wait = retry_after(&resp).unwrap_or_else(|| backoff(attempt)).min(Duration::from_secs(30));
                tokio::time::sleep(wait).await;
                continue;
            }
            return Ok(resp);
        }
    }

    /// Parses the body, and returns the `x-ms-continuationtoken` header when the list has more pages.
    async fn handle<T: DeserializeOwned>(&self, resp: Response) -> AppResult<(T, Option<String>)> {
        let status = resp.status();
        let token = resp
            .headers()
            .get(CONTINUATION_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty());
        let text = resp.text().await?;
        if status.is_success() {
            let body = if text.trim().is_empty() { "null" } else { text.as_str() };
            return Ok((serde_json::from_str::<T>(body)?, token));
        }
        // Azure DevOps returns an HTML sign-in page for bad credentials on some endpoints.
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| match status.as_u16() {
                401 => "The token was rejected. It may be expired or revoked.".to_string(),
                403 => "This token does not have permission for that action.".to_string(),
                404 => "Not found. The organization or project name may be wrong.".to_string(),
                _ => format!("Azure DevOps returned {}", status),
            });
        let kind = match status.as_u16() {
            401 => ErrorKind::Unauthorized,
            403 => ErrorKind::Forbidden,
            404 => ErrorKind::NotFound,
            409 | 412 => ErrorKind::Conflict,
            429 => ErrorKind::RateLimited,
            400 => ErrorKind::Validation,
            _ => ErrorKind::Internal,
        };
        Err(AppError::new(kind, message).with_status(status.as_u16()))
    }

    /// Sends the request; if Azure DevOps says the endpoint is still in preview for this
    /// api-version, retries once with the "-preview" flag added.
    async fn request_paged<T: DeserializeOwned>(
        &self,
        method: Method,
        url: &str,
        body: Option<(&str, String)>,
    ) -> AppResult<(T, Option<String>)> {
        let resp = self.send(method.clone(), url, body.clone()).await?;
        match self.handle::<T>(resp).await {
            Err(e) if e.status == Some(400) && e.message.contains("preview flag") && !url.contains("-preview") => {
                let retry_url = url.replace(&format!("api-version={API_VERSION}"), &format!("api-version={API_VERSION}-preview"));
                let resp = self.send(method, &retry_url, body).await?;
                self.handle(resp).await
            }
            other => other,
        }
    }

    async fn request<T: DeserializeOwned>(&self, method: Method, url: &str, body: Option<(&str, String)>) -> AppResult<T> {
        self.request_paged(method, url, body).await.map(|(v, _)| v)
    }

    /// GET that also returns the continuation token for the next page, if any.
    pub async fn get_page<T: DeserializeOwned>(&self, url: &str) -> AppResult<(T, Option<String>)> {
        self.request_paged(Method::GET, url, None).await
    }

    pub async fn get<T: DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        self.request(Method::GET, url, None).await
    }

    pub async fn post_json<T: DeserializeOwned>(&self, url: &str, body: &Value) -> AppResult<T> {
        self.request(Method::POST, url, Some(("application/json", body.to_string()))).await
    }

    pub async fn patch_json<T: DeserializeOwned>(&self, url: &str, body: &Value) -> AppResult<T> {
        self.request(Method::PATCH, url, Some(("application/json", body.to_string()))).await
    }

    pub async fn put_json<T: DeserializeOwned>(&self, url: &str, body: &Value) -> AppResult<T> {
        self.request(Method::PUT, url, Some(("application/json", body.to_string()))).await
    }

    pub async fn post_patch<T: DeserializeOwned>(&self, url: &str, body: &Value) -> AppResult<T> {
        self.request(Method::POST, url, Some(("application/json-patch+json", body.to_string()))).await
    }

    pub async fn patch_patch<T: DeserializeOwned>(&self, url: &str, body: &Value) -> AppResult<T> {
        self.request(Method::PATCH, url, Some(("application/json-patch+json", body.to_string()))).await
    }

    /// Download a binary resource (e.g. an attachment image) with the user's credentials.
    pub async fn get_bytes(&self, url: &str) -> AppResult<(String, Vec<u8>)> {
        let resp = self.send(Method::GET, url, None).await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(AppError::new(ErrorKind::NotFound, format!("Attachment request failed ({status})")).with_status(status.as_u16()));
        }
        let ct = resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = resp.bytes().await?.to_vec();
        Ok((ct, bytes))
    }

    /// Upload a binary body (e.g. an attachment). Not retried: the body is not cloned.
    pub async fn post_bytes<T: DeserializeOwned>(&self, url: &str, bytes: Vec<u8>) -> AppResult<T> {
        let resp = self
            .http
            .post(url)
            .header(header::AUTHORIZATION, &self.auth_header)
            .header(header::ACCEPT, "application/json")
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(bytes)
            .send()
            .await?;
        self.handle(resp).await.map(|(v, _)| v)
    }

    pub async fn delete<T: DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        self.request(Method::DELETE, url, None).await
    }
}

pub fn enc(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ado_urls_are_recognised_by_host() {
        assert!(is_ado_url("https://dev.azure.com/org/_apis/wit/attachments/abc?fileName=x.png"));
        assert!(is_ado_url("https://org.visualstudio.com/_apis/wit/attachments/abc"));
        assert!(is_ado_url("https://DEV.Azure.com/org/x"));
    }

    #[test]
    fn lookalike_urls_are_rejected() {
        assert!(!is_ado_url("https://evil.com?.visualstudio.com/x"));
        assert!(!is_ado_url("https://evil.com/x.visualstudio.com/"));
        assert!(!is_ado_url("https://dev.azure.com.evil.com/"));
        assert!(!is_ado_url("http://dev.azure.com/"));
        assert!(!is_ado_url("https://dev.azure.com@evil.com/"));
        assert!(!is_ado_url("https://.visualstudio.com/"));
        assert!(!is_ado_url("not a url"));
    }

    #[test]
    fn redirects_stay_on_azure_hosts() {
        let ok = |s: &str| redirect_allowed(&reqwest::Url::parse(s).unwrap());
        assert!(ok("https://org.vsblob.visualstudio.com/x"));
        assert!(ok("https://x.vsassets.io/a"));
        assert!(ok("https://acct.blob.core.windows.net/c/b"));
        assert!(!ok("https://evil.com/"));
        assert!(!ok("http://dev.azure.com/"));
    }

    #[test]
    fn retry_after_reads_seconds_and_dates() {
        let now = UNIX_EPOCH + Duration::from_secs(784_111_717); // Sun, 06 Nov 1994 08:48:37 GMT
        assert_eq!(parse_retry_after("7", now), Some(Duration::from_secs(7)));
        assert_eq!(parse_retry_after(" 0 ", now), Some(Duration::ZERO));
        assert_eq!(parse_retry_after("Sun, 06 Nov 1994 08:49:37 GMT", now), Some(Duration::from_secs(60)));
        assert_eq!(parse_retry_after("Sun, 06 Nov 1994 08:00:00 GMT", now), Some(Duration::ZERO));
        assert_eq!(parse_retry_after("soon", now), None);
    }

    #[test]
    fn backoff_grows() {
        assert!(backoff(1) >= Duration::from_millis(500) && backoff(1) < Duration::from_millis(750));
        assert!(backoff(2) >= Duration::from_millis(1500));
        assert!(backoff(3) >= Duration::from_millis(3500));
    }
}
