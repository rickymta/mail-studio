//! OAuth 2 sign-in for providers that refuse passwords over IMAP/SMTP (Google, Microsoft):
//! authorization-code flow with PKCE and a loopback redirect, as RFC 8252 describes for native
//! apps. The user supplies their own OAuth client id in Settings; refresh tokens are kept in the
//! OS credential store, access tokens only in memory.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::db::{self, Account};
use crate::error::{Error, Result};
use crate::secrets;

struct Endpoints {
    auth: &'static str,
    token: &'static str,
    scope: &'static str,
    /// Host used in the redirect URI (each provider documents a different loopback form).
    redirect_host: &'static str,
}

fn endpoints(provider: &str) -> Result<Endpoints> {
    match provider {
        "google" => Ok(Endpoints {
            auth: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            scope: "https://mail.google.com/",
            redirect_host: "127.0.0.1",
        }),
        "microsoft" => Ok(Endpoints {
            auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            scope: "https://outlook.office.com/IMAP.AccessAsUser.All \
                    https://outlook.office.com/SMTP.Send offline_access",
            redirect_host: "localhost",
        }),
        other => Err(Error::invalid(format!(
            "OAuth is not available for {other:?}"
        ))),
    }
}

/// MailStudio's own Google OAuth client (type "Desktop app"), used when the user has not set one.
const GOOGLE_CLIENT_ID: &str =
    "973790687203-3rfcg9dth8aj9e26ecoie9ef4gq3hqu5.apps.googleusercontent.com";
/// Its secret is read from the build environment (a GitHub Actions secret for releases). Google
/// treats an installed app's secret as public, since it ships inside the app anyway, but it is
/// kept out of the repository. Builds without it simply have no built-in Google client.
const GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("MAILSTUDIO_GOOGLE_CLIENT_SECRET");

/// The client this build ships for a provider, if any.
fn builtin(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "google" => GOOGLE_CLIENT_SECRET
            .filter(|s| !s.trim().is_empty())
            .map(|s| (GOOGLE_CLIENT_ID, s.trim())),
        _ => None,
    }
}

/// Whether this build ships its own client for `provider`, so sign-in works with no setup.
pub fn has_builtin_client(provider: &str) -> bool {
    builtin(provider).is_some()
}

/// `(client id, client secret)` for a provider: the one the user configured, else the built-in one.
fn client(provider: &str) -> Result<(String, Option<String>)> {
    let configured = db::with(|c| db::kv_get(c, &format!("oauth.{provider}.clientId")))?
        .filter(|v| !v.trim().is_empty());
    if let Some(id) = configured {
        let secret = secrets::get(&secrets::client_secret_key(provider))?.filter(|v| !v.is_empty());
        return Ok((id.trim().to_string(), secret));
    }
    let (id, secret) = builtin(provider).ok_or_else(|| {
        Error::invalid(
            "No OAuth client ID is configured for this provider. Add one in Settings → \
             Sign-in (OAuth).",
        )
    })?;
    Ok((id.to_string(), Some(secret.to_string())))
}

#[derive(Debug, Clone)]
pub struct Grant {
    pub provider: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
}

struct Pending {
    provider: String,
    verifier: String,
    state: String,
    redirect_uri: String,
    listener: TcpListener,
}

#[derive(Default)]
struct State {
    pending: HashMap<String, Pending>,
    grants: HashMap<String, Grant>,
    /// account id → (access token, expiry)
    access: HashMap<i64, (String, i64)>,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(Default::default)
}

fn lock() -> std::sync::MutexGuard<'static, State> {
    state().lock().unwrap_or_else(|p| p.into_inner())
}

fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                        continue;
                    }
                    None => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn random() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Start a sign-in: returns `{ flowId, url }`; the UI opens `url` in the browser and then calls
/// [`wait`].
pub async fn start(provider: &str, login_hint: &str) -> Result<Value> {
    let ep = endpoints(provider)?;
    let (client_id, _) = client(provider)?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://{}:{port}", ep.redirect_host);
    let verifier = random();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let st = random();
    let mut url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}\
         &code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        ep.auth,
        enc(&client_id),
        enc(&redirect_uri),
        enc(ep.scope),
        enc(&st),
        enc(&challenge),
    );
    if !login_hint.is_empty() {
        url.push_str(&format!("&login_hint={}", enc(login_hint)));
    }
    let flow_id = random();
    lock().pending.insert(
        flow_id.clone(),
        Pending {
            provider: provider.to_string(),
            verifier,
            state: st,
            redirect_uri,
            listener,
        },
    );
    Ok(json!({ "flowId": flow_id, "url": url }))
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>MailStudio</title>\
<body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh\">\
<div><h2>MailStudio</h2><p>MESSAGE</p></div>";

/// Read the browser's redirect and return its query parameters.
async fn receive(listener: &TcpListener) -> Result<HashMap<String, String>> {
    loop {
        let (mut sock, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let n = sock.read(&mut buf).await.unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]).into_owned();
        let target = head.split_whitespace().nth(1).unwrap_or_default();
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or_default();
        let params: HashMap<String, String> = query
            .split('&')
            .filter_map(|kv| kv.split_once('='))
            .map(|(k, v)| (dec(k), dec(v)))
            .collect();
        let relevant = params.contains_key("code") || params.contains_key("error");
        let msg = if params.contains_key("code") {
            "Signed in. You can close this tab and return to MailStudio."
        } else if relevant {
            "Sign-in was cancelled or failed. Return to MailStudio and try again."
        } else {
            "Waiting for the sign-in to finish…"
        };
        let body = DONE_PAGE.replace("MESSAGE", msg);
        let res = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\n\
             connection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = sock.write_all(res.as_bytes()).await;
        let _ = sock.shutdown().await;
        // Browsers also ask for /favicon.ico; only the redirect itself ends the wait.
        if relevant {
            return Ok(params);
        }
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn token_request(provider: &str, form: &[(&str, &str)]) -> Result<TokenResponse> {
    let ep = endpoints(provider)?;
    let (client_id, secret) = client(provider)?;
    let mut form: Vec<(&str, &str)> = form.to_vec();
    form.push(("client_id", &client_id));
    if let Some(s) = secret.as_deref() {
        form.push(("client_secret", s));
    }
    let res: TokenResponse = reqwest::Client::new()
        .post(ep.token)
        .form(&form)
        .timeout(Duration::from_secs(30))
        .send()
        .await?
        .json()
        .await?;
    if let Some(e) = &res.error {
        return Err(Error::Auth(format!(
            "The provider refused the sign-in: {}",
            res.error_description.as_deref().unwrap_or(e)
        )));
    }
    Ok(res)
}

/// Wait (up to five minutes) for the browser to come back, then trade the code for tokens. The
/// grant is kept until `account.save` / `account.test` picks it up with [`grant`].
pub async fn wait(flow_id: &str) -> Result<()> {
    let p = lock()
        .pending
        .remove(flow_id)
        .ok_or_else(|| Error::invalid("This sign-in attempt has expired. Start again."))?;
    let params = tokio::time::timeout(Duration::from_secs(300), receive(&p.listener))
        .await
        .map_err(|_| Error::Auth("The sign-in was not completed in time.".into()))??;
    if let Some(e) = params.get("error") {
        let detail = params.get("error_description").unwrap_or(e);
        return Err(Error::Auth(format!("Sign-in failed: {detail}")));
    }
    if params.get("state") != Some(&p.state) {
        return Err(Error::Auth(
            "Sign-in failed: the response did not match the request.".into(),
        ));
    }
    let code = params.get("code").cloned().unwrap_or_default();
    let res = token_request(
        &p.provider,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &p.redirect_uri),
            ("code_verifier", &p.verifier),
        ],
    )
    .await?;
    let access_token = res
        .access_token
        .ok_or_else(|| Error::Auth("The provider returned no access token.".into()))?;
    lock().grants.insert(
        flow_id.to_string(),
        Grant {
            provider: p.provider,
            access_token,
            refresh_token: res.refresh_token,
            expires_at: db::now() + res.expires_in.unwrap_or(3600),
        },
    );
    Ok(())
}

pub fn grant(flow_id: &str) -> Result<Grant> {
    lock()
        .grants
        .get(flow_id)
        .cloned()
        .ok_or_else(|| Error::invalid("Sign in with the provider first."))
}

/// Bind a finished sign-in to a saved account.
pub fn adopt(flow_id: &str, account_id: i64) -> Result<()> {
    let g = lock()
        .grants
        .remove(flow_id)
        .ok_or_else(|| Error::invalid("Sign in with the provider first."))?;
    let refresh = g.refresh_token.as_deref().ok_or_else(|| {
        Error::Auth(
            "The provider returned no refresh token; sign in again and grant access.".into(),
        )
    })?;
    secrets::set(&secrets::refresh_key(account_id), refresh)?;
    lock()
        .access
        .insert(account_id, (g.access_token, g.expires_at));
    Ok(())
}

pub fn forget(account_id: i64) {
    lock().access.remove(&account_id);
}

/// A valid access token for an OAuth account, refreshed when it is about to expire.
pub async fn access_token(account: &Account) -> Result<String> {
    if let Some((token, expires)) = lock().access.get(&account.id).cloned()
        && expires - 60 > db::now()
    {
        return Ok(token);
    }
    let refresh = secrets::get(&secrets::refresh_key(account.id))?.ok_or_else(|| {
        Error::Auth(format!(
            "Sign in to {} again: no stored sign-in was found.",
            account.email
        ))
    })?;
    let res = token_request(
        &account.oauth_provider,
        &[("grant_type", "refresh_token"), ("refresh_token", &refresh)],
    )
    .await?;
    if let Some(new_refresh) = res.refresh_token.as_deref() {
        secrets::set(&secrets::refresh_key(account.id), new_refresh)?;
    }
    let token = res
        .access_token
        .ok_or_else(|| Error::Auth("The provider returned no access token.".into()))?;
    lock().access.insert(
        account.id,
        (token.clone(), db::now() + res.expires_in.unwrap_or(3600)),
    );
    Ok(token)
}

/// The SASL XOAUTH2 initial response (before base64).
pub fn xoauth2(user: &str, token: &str) -> String {
    format!("user={user}\x01auth=Bearer {token}\x01\x01")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_coding_round_trips() {
        let s = "https://mail.google.com/ a+b&c=d é";
        assert_eq!(dec(&enc(s)), s);
        assert_eq!(enc("a b/c"), "a%20b%2Fc");
        assert_eq!(dec("a+b%2"), "a b%2");
    }

    #[test]
    fn xoauth2_shape() {
        assert_eq!(
            xoauth2("u@x.y", "tok"),
            "user=u@x.y\x01auth=Bearer tok\x01\x01"
        );
    }
}
