//! IMAP plumbing: connecting (implicit TLS, STARTTLS or plain), logging in (password or
//! XOAUTH2), a small per-account session pool, and the handful of commands the app needs.

use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use async_imap::types::{Fetch, Flag, NameAttribute};
use base64::Engine;
use futures::TryStreamExt;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};

use crate::db::{Account, ListedFolder, NewMessage};
use crate::error::{Error, Result};
use crate::{mime, oauth, secrets};

pub trait Stream: AsyncRead + AsyncWrite + Unpin + Send + Debug {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + Debug> Stream for T {}

pub type Session = async_imap::Session<Box<dyn Stream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// A pooled session idle for longer than this is checked with NOOP before reuse.
const TRUST_IDLE: Duration = Duration::from_secs(45);
const POOL_PER_ACCOUNT: usize = 2;

pub enum Credential {
    Password(String),
    /// An OAuth 2 access token.
    OAuth(String),
}

/// The credential stored for a saved account.
pub async fn credential(account: &Account) -> Result<Credential> {
    if account.auth == "oauth" {
        return Ok(Credential::OAuth(oauth::access_token(account).await?));
    }
    secrets::get(&secrets::password_key(account.id))?
        .map(Credential::Password)
        .ok_or_else(|| {
            Error::Auth(format!(
                "No password is stored for {}. Edit the account and enter it again.",
                account.email
            ))
        })
}

pub fn tls_connector() -> TlsConnector {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    let config = CONFIG.get_or_init(|| {
        let roots = RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
        Arc::new(
            ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .expect("ring supports the default TLS versions")
                .with_root_certificates(roots)
                .with_no_client_auth(),
        )
    });
    TlsConnector::from(config.clone())
}

struct XOAuth2 {
    response: Option<String>,
}

impl async_imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&mut self, _challenge: &[u8]) -> String {
        // First call: the token. A second call means the server sent an error document, which
        // is acknowledged with an empty line so it reports the failure.
        self.response.take().unwrap_or_default()
    }
}

fn net(what: &str, host: &str, e: impl std::fmt::Display) -> Error {
    Error::Network(format!("Could not {what} {host}: {e}"))
}

async fn open(account: &Account, cred: &Credential) -> Result<Session> {
    let host = account.imap_host.trim();
    if host.is_empty() {
        return Err(Error::invalid("The IMAP server is missing"));
    }
    let tcp = TcpStream::connect((host, account.imap_port))
        .await
        .map_err(|e| net("connect to", host, e))?;
    let _ = tcp.set_nodelay(true);
    let server_name =
        || ServerName::try_from(host.to_string()).map_err(|e| net("verify the name of", host, e));

    let client: async_imap::Client<Box<dyn Stream>> = match account.imap_security.as_str() {
        "tls" => {
            let tls = tls_connector()
                .connect(server_name()?, tcp)
                .await
                .map_err(|e| net("secure the connection to", host, e))?;
            let mut c = async_imap::Client::new(Box::new(tls) as Box<dyn Stream>);
            greeting(&mut c, host).await?;
            c
        }
        "starttls" => {
            let mut plain = async_imap::Client::new(tcp);
            greeting(&mut plain, host).await?;
            plain
                .run_command_and_check_ok("STARTTLS", None)
                .await
                .map_err(|e| Error::Network(format!("{host} does not offer STARTTLS: {e}")))?;
            let tls = tls_connector()
                .connect(server_name()?, plain.into_inner())
                .await
                .map_err(|e| net("secure the connection to", host, e))?;
            async_imap::Client::new(Box::new(tls) as Box<dyn Stream>)
        }
        "none" => {
            let mut c = async_imap::Client::new(Box::new(tcp) as Box<dyn Stream>);
            greeting(&mut c, host).await?;
            c
        }
        other => {
            return Err(Error::invalid(format!(
                "Unknown connection security {other:?}"
            )));
        }
    };

    let user = account.username.trim();
    let oauth = matches!(cred, Credential::OAuth(_));
    let login = match cred {
        Credential::Password(p) => client.login(user, p).await,
        Credential::OAuth(token) => {
            client
                .authenticate(
                    "XOAUTH2",
                    XOAuth2 {
                        response: Some(oauth::xoauth2(user, token)),
                    },
                )
                .await
        }
    };
    login.map_err(|(e, _)| match e {
        async_imap::error::Error::No(m) | async_imap::error::Error::Bad(m) => Error::Auth(
            sign_in_refused(host, user, &crate::error::server_text(&m), oauth),
        ),
        other => other.into(),
    })
}

/// Explain a refused sign-in in terms of what the user can do about it.
pub fn sign_in_refused(host: &str, user: &str, said: &str, oauth: bool) -> String {
    let lower = said.to_lowercase();
    if !oauth && (lower.contains("basic authentication is disabled") || lower.contains("basicauth"))
    {
        return format!(
            "{host} no longer accepts passwords. Choose the provider “Outlook / Microsoft 365” \
             and sign in with Microsoft (OAuth) instead."
        );
    }
    if oauth {
        return format!(
            "{host} refused the sign-in for {user}. IMAP may be turned off for this mailbox, \
             or the browser sign-in was made with a different account. (The server said: {said})"
        );
    }
    format!(
        "{host} did not accept the user name or password for {user}. Check both; many \
         providers want an app password instead of the normal one. (The server said: {said})"
    )
}

async fn greeting<T>(client: &mut async_imap::Client<T>, host: &str) -> Result<()>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    match client.read_response().await {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(Error::Network(format!("{host} closed the connection"))),
        Err(e) => Err(net("read the greeting of", host, e)),
    }
}

/// Connect and log in with an explicit credential (testing an account before it is saved).
pub async fn connect(account: &Account, cred: &Credential) -> Result<Session> {
    tokio::time::timeout(CONNECT_TIMEOUT, open(account, cred))
        .await
        .map_err(|_| Error::Network(format!("{} did not answer in time", account.imap_host)))?
}

// ---- session pool -------------------------------------------------------------------------------

type Pool = Mutex<HashMap<i64, Vec<(Session, Instant)>>>;

fn pool() -> &'static Pool {
    static POOL: OnceLock<Pool> = OnceLock::new();
    POOL.get_or_init(Default::default)
}

fn take(account_id: i64) -> Option<(Session, Instant)> {
    pool()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get_mut(&account_id)?
        .pop()
}

pub fn give(account_id: i64, session: Session) {
    let mut p = pool().lock().unwrap_or_else(|p| p.into_inner());
    let list = p.entry(account_id).or_default();
    if list.len() < POOL_PER_ACCOUNT {
        list.push((session, Instant::now()));
    }
}

/// Forget pooled sessions (the account changed or was removed).
pub fn forget(account_id: i64) {
    pool()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&account_id);
}

/// A logged-in session: a pooled one when it still answers, else a new connection.
pub async fn checkout(account: &Account) -> Result<Session> {
    while let Some((mut session, used)) = take(account.id) {
        if used.elapsed() < TRUST_IDLE {
            return Ok(session);
        }
        if let Ok(Ok(())) = tokio::time::timeout(Duration::from_secs(10), session.noop()).await {
            return Ok(session);
        }
    }
    let cred = credential(account).await?;
    connect(account, &cred).await
}

/// Bound a session operation; a server that stops answering must not hang the app.
pub async fn timed<T>(
    account: &Account,
    limit: Duration,
    work: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::time::timeout(limit, work)
        .await
        .map_err(|_| Error::Network(format!("{} stopped answering", account.imap_host)))?
}
// ---- mailbox names ------------------------------------------------------------------------------

/// Decode IMAP modified UTF-7 (RFC 3501 §5.1.3). Malformed input is returned unchanged.
pub fn utf7_decode(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let Some(end) = tail.find('-') else {
            return s.to_string();
        };
        let chunk = &tail[..end];
        if chunk.is_empty() {
            out.push('&');
        } else {
            let b64 = chunk.replace(',', "/");
            let Ok(bytes) = base64::engine::general_purpose::STANDARD_NO_PAD.decode(b64) else {
                return s.to_string();
            };
            let units: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| u16::from_be_bytes(*p))
                .collect();
            match String::from_utf16(&units) {
                Ok(text) => out.push_str(&text),
                Err(_) => return s.to_string(),
            }
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

pub fn utf7_encode(s: &str) -> String {
    fn flush(buf: &mut Vec<u16>, out: &mut String) {
        if buf.is_empty() {
            return;
        }
        let bytes: Vec<u8> = buf.iter().flat_map(|u| u.to_be_bytes()).collect();
        out.push('&');
        out.push_str(
            &base64::engine::general_purpose::STANDARD_NO_PAD
                .encode(bytes)
                .replace('/', ","),
        );
        out.push('-');
        buf.clear();
    }
    let mut out = String::new();
    let mut buf: Vec<u16> = Vec::new();
    for c in s.chars() {
        if (' '..='~').contains(&c) {
            flush(&mut buf, &mut out);
            if c == '&' {
                out.push_str("&-")
            } else {
                out.push(c)
            }
        } else {
            let mut units = [0u16; 2];
            buf.extend_from_slice(c.encode_utf16(&mut units));
        }
    }
    flush(&mut buf, &mut out);
    out
}

fn role_from_name(leaf: &str) -> &'static str {
    match leaf.to_lowercase().as_str() {
        "sent" | "sent items" | "sent mail" | "sent messages" | "đã gửi" | "thư đã gửi" => {
            "sent"
        }
        "drafts" | "draft" | "thư nháp" | "nháp" => "drafts",
        "trash" | "deleted items" | "deleted messages" | "bin" | "thùng rác" => "trash",
        "junk" | "spam" | "junk e-mail" | "junk email" | "bulk mail" | "thư rác" => "junk",
        "archive" | "archives" | "lưu trữ" => "archive",
        _ => "",
    }
}

/// Every folder of the account, with its special-use role (RFC 6154 attributes first, well-known
/// names as a fallback for servers that do not send them).
pub async fn list_folders(s: &mut Session) -> Result<Vec<ListedFolder>> {
    let names: Vec<_> = s.list(Some(""), Some("*")).await?.try_collect().await?;
    let mut out: Vec<ListedFolder> = Vec::new();
    for n in &names {
        let path = n.name().to_string();
        let mut role = "";
        let mut selectable = true;
        for a in n.attributes() {
            match a {
                NameAttribute::NoSelect => selectable = false,
                NameAttribute::Sent => role = "sent",
                NameAttribute::Drafts => role = "drafts",
                NameAttribute::Trash => role = "trash",
                NameAttribute::Junk => role = "junk",
                NameAttribute::Archive => role = "archive",
                NameAttribute::All => role = "all",
                NameAttribute::Flagged => role = "flagged",
                NameAttribute::Extension(x) if x.eq_ignore_ascii_case("\\Important") => {
                    role = "important"
                }
                NameAttribute::Extension(x) if x.eq_ignore_ascii_case("\\NonExistent") => {
                    selectable = false
                }
                _ => {}
            }
        }
        if path.eq_ignore_ascii_case("INBOX") {
            role = "inbox";
        }
        out.push(ListedFolder {
            name: utf7_decode(&path),
            path,
            delimiter: n.delimiter().unwrap_or("/").to_string(),
            role: role.to_string(),
            selectable,
        });
    }
    // Name-based fallback, only for roles nobody claimed through attributes.
    for i in 0..out.len() {
        if !out[i].role.is_empty() || !out[i].selectable {
            continue;
        }
        let leaf = out[i]
            .name
            .rsplit(out[i].delimiter.as_str())
            .next()
            .unwrap_or_default();
        let guess = role_from_name(leaf);
        if !guess.is_empty() && !out.iter().any(|f| f.role == guess) {
            out[i].role = guess.to_string();
        }
    }
    Ok(out)
}

// ---- fetching -----------------------------------------------------------------------------------

fn flags_of(f: &Fetch) -> (bool, bool, bool) {
    let (mut seen, mut flagged, mut answered) = (false, false, false);
    for flag in f.flags() {
        match flag {
            Flag::Seen => seen = true,
            Flag::Flagged => flagged = true,
            Flag::Answered => answered = true,
            _ => {}
        }
    }
    (seen, flagged, answered)
}

const HEADER_QUERY: &str = "(UID FLAGS RFC822.SIZE INTERNALDATE BODY.PEEK[HEADER])";

fn header_of(f: &Fetch) -> Option<NewMessage> {
    let uid = f.uid?;
    let mut m = mime::parse_headers(f.header().unwrap_or_default());
    let (seen, flagged, answered) = flags_of(f);
    let arrived = f.internal_date().map(|d| d.timestamp()).unwrap_or(0);
    // A missing, unparsable or future-dated Date header falls back to the arrival time.
    if m.date <= 0 || (arrived > 0 && m.date > arrived + 86_400) {
        m.date = arrived;
    }
    m.uid = uid;
    m.size = f.size.unwrap_or(0) as i64;
    m.seen = seen;
    m.flagged = flagged;
    m.answered = answered;
    Some(m)
}

/// Headers of the messages in `set`: sequence numbers, or UIDs when `by_uid`.
pub async fn fetch_headers(s: &mut Session, set: &str, by_uid: bool) -> Result<Vec<NewMessage>> {
    let fetched: Vec<Fetch> = if by_uid {
        s.uid_fetch(set, HEADER_QUERY).await?.try_collect().await?
    } else {
        s.fetch(set, HEADER_QUERY).await?.try_collect().await?
    };
    Ok(fetched.iter().filter_map(header_of).collect())
}

/// `(uid, seen, flagged, answered)` of every message in the UID range.
pub async fn fetch_flags(
    s: &mut Session,
    lo: u32,
    hi: u32,
) -> Result<Vec<(u32, bool, bool, bool)>> {
    let fetched: Vec<Fetch> = s
        .uid_fetch(format!("{lo}:{hi}"), "(UID FLAGS)")
        .await?
        .try_collect()
        .await?;
    Ok(fetched
        .iter()
        .filter_map(|f| {
            let (seen, flagged, answered) = flags_of(f);
            Some((f.uid?, seen, flagged, answered))
        })
        .collect())
}

/// The whole message, without marking it read.
pub async fn fetch_raw(s: &mut Session, uid: u32) -> Result<Vec<u8>> {
    let fetched: Vec<Fetch> = s
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .await?
        .try_collect()
        .await?;
    fetched
        .iter()
        .find(|f| f.uid == Some(uid))
        .and_then(|f| f.body())
        .map(<[u8]>::to_vec)
        .ok_or_else(|| Error::NotFound("The message is no longer on the server".into()))
}

pub fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// `UID STORE` on the selected folder, e.g. `+FLAGS (\Seen)`.
pub async fn store(s: &mut Session, uids: &[u32], change: &str) -> Result<()> {
    if uids.is_empty() {
        return Ok(());
    }
    let _: Vec<Fetch> = s
        .uid_store(uid_set(uids), change)
        .await?
        .try_collect()
        .await?;
    Ok(())
}

async fn has_capability(s: &mut Session, cap: &str) -> bool {
    s.capabilities()
        .await
        .map(|c| c.has_str(cap))
        .unwrap_or(false)
}

/// Remove messages from the selected folder for good.
pub async fn expunge(s: &mut Session, uids: &[u32]) -> Result<()> {
    if uids.is_empty() {
        return Ok(());
    }
    store(s, uids, "+FLAGS.SILENT (\\Deleted)").await?;
    if has_capability(s, "UIDPLUS").await {
        let _: Vec<_> = s.uid_expunge(uid_set(uids)).await?.try_collect().await?;
    } else {
        let _: Vec<_> = s.expunge().await?.try_collect().await?;
    }
    Ok(())
}

/// Move messages from the selected folder to `dest` (MOVE, or COPY + delete on old servers).
pub async fn move_to(s: &mut Session, uids: &[u32], dest: &str) -> Result<()> {
    if uids.is_empty() {
        return Ok(());
    }
    if has_capability(s, "MOVE").await {
        s.uid_mv(uid_set(uids), dest).await?;
    } else {
        s.uid_copy(uid_set(uids), dest).await?;
        expunge(s, uids).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf7_round_trips() {
        for (plain, encoded) in [
            ("INBOX", "INBOX"),
            ("Thư nháp", "Th&AbA- nh&AOE-p"),
            ("A & B", "A &- B"),
            ("日本語", "&ZeVnLIqe-"),
            ("[Gmail]/Thư rác 😀", "[Gmail]/Th&AbA- r&AOE-c &2D3eAA-"),
        ] {
            assert_eq!(utf7_encode(plain), encoded, "encode {plain}");
            assert_eq!(utf7_decode(encoded), plain, "decode {encoded}");
        }
        assert_eq!(utf7_decode("broken &xyz"), "broken &xyz");
    }

    #[test]
    fn well_known_names_map_to_roles() {
        assert_eq!(role_from_name("Sent Items"), "sent");
        assert_eq!(role_from_name("Deleted Items"), "trash");
        assert_eq!(role_from_name("SPAM"), "junk");
        assert_eq!(role_from_name("Projects"), "");
    }

    #[test]
    fn uid_sets() {
        assert_eq!(uid_set(&[3, 7, 9]), "3,7,9");
    }
}
