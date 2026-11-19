//! Local storage: one SQLite file holding accounts, folders, message headers, cached raw
//! messages, drafts, collected contacts and settings. Passwords are never stored here (see
//! `secrets.rs`).

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use rusqlite::types::Value as Sql;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub const APP_ID: &str = "dev.mailstudio.desktop";

/// Where the database and temporary attachment copies live. `MAILSTUDIO_DATA_DIR` overrides the
/// OS location (used by tests and the dev mail server workflow).
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MAILSTUDIO_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_ID)
}

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT 'custom',
    color TEXT NOT NULL DEFAULT '',
    signature TEXT NOT NULL DEFAULT '',
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_security TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_security TEXT NOT NULL,
    username TEXT NOT NULL,
    auth TEXT NOT NULL DEFAULT 'password',
    oauth_provider TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    last_sync INTEGER,
    last_error TEXT
);
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    delimiter TEXT NOT NULL DEFAULT '/',
    role TEXT NOT NULL DEFAULT '',
    selectable INTEGER NOT NULL DEFAULT 1,
    uid_validity INTEGER,
    total INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0,
    UNIQUE(account_id, path)
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    uid INTEGER NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    in_reply_to TEXT NOT NULL DEFAULT '',
    refs TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    bcc_json TEXT NOT NULL DEFAULT '[]',
    reply_to_json TEXT NOT NULL DEFAULT '[]',
    date INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    answered INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    snippet TEXT NOT NULL DEFAULT '',
    has_body INTEGER NOT NULL DEFAULT 0,
    UNIQUE(folder_id, uid)
);
CREATE INDEX IF NOT EXISTS messages_folder_date ON messages(folder_id, date DESC);
CREATE INDEX IF NOT EXISTS messages_date ON messages(date DESC);
CREATE TABLE IF NOT EXISTS bodies (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    raw BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    uses INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

fn open() -> Result<Connection> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("mail.db"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    )?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/// Run `f` with the database. Never hold the result across an `.await`.
pub fn with<T>(f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
    if DB.get().is_none() {
        let conn = open()?;
        let _ = DB.set(Mutex::new(conn));
    }
    let mut guard = DB
        .get()
        .expect("db set above")
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    f(&mut guard)
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---- models -------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    #[serde(default)]
    pub id: i64,
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub signature: String,
    pub imap_host: String,
    pub imap_port: u16,
    /// `tls` (implicit), `starttls` or `none`.
    pub imap_security: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: String,
    pub username: String,
    /// `password` or `oauth`.
    #[serde(default = "default_auth")]
    pub auth: String,
    /// `google` or `microsoft` when `auth` is `oauth`.
    #[serde(default)]
    pub oauth_provider: String,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub last_sync: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
}

fn default_auth() -> String {
    "password".into()
}

const ACCOUNT_COLS: &str = "id, email, name, provider, color, signature, imap_host, imap_port, \
    imap_security, smtp_host, smtp_port, smtp_security, username, auth, oauth_provider, position, \
    last_sync, last_error";

fn account_row(r: &Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        email: r.get(1)?,
        name: r.get(2)?,
        provider: r.get(3)?,
        color: r.get(4)?,
        signature: r.get(5)?,
        imap_host: r.get(6)?,
        imap_port: r.get(7)?,
        imap_security: r.get(8)?,
        smtp_host: r.get(9)?,
        smtp_port: r.get(10)?,
        smtp_security: r.get(11)?,
        username: r.get(12)?,
        auth: r.get(13)?,
        oauth_provider: r.get(14)?,
        position: r.get(15)?,
        last_sync: r.get(16)?,
        last_error: r.get(17)?,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub account_id: i64,
    /// The name the server uses (modified UTF-7), sent back verbatim in IMAP commands.
    pub path: String,
    /// Decoded full name for display.
    pub name: String,
    pub delimiter: String,
    /// `inbox`, `sent`, `drafts`, `trash`, `junk`, `archive`, `all`, `flagged`, `important` or ``.
    pub role: String,
    pub selectable: bool,
    pub uid_validity: Option<i64>,
    pub total: i64,
    pub unread: i64,
}

const FOLDER_COLS: &str =
    "id, account_id, path, name, delimiter, role, selectable, uid_validity, total, unread";

fn folder_row(r: &Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: r.get(0)?,
        account_id: r.get(1)?,
        path: r.get(2)?,
        name: r.get(3)?,
        delimiter: r.get(4)?,
        role: r.get(5)?,
        selectable: r.get(6)?,
        uid_validity: r.get(7)?,
        total: r.get(8)?,
        unread: r.get(9)?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Addr {
    #[serde(default)]
    pub name: String,
    pub email: String,
}

/// One row of a message list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: i64,
    pub account_id: i64,
    pub folder_id: i64,
    pub folder_role: String,
    pub uid: u32,
    pub subject: String,
    pub from: Addr,
    pub to: Vec<Addr>,
    pub date: i64,
    pub size: i64,
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub has_attachments: bool,
    pub snippet: String,
}

const SUMMARY_COLS: &str = "m.id, m.account_id, m.folder_id, f.role, m.uid, m.subject, m.from_name, \
    m.from_addr, m.to_json, m.date, m.size, m.seen, m.flagged, m.answered, m.has_attachments, \
    m.snippet";

fn addrs(json: String) -> Vec<Addr> {
    serde_json::from_str(&json).unwrap_or_default()
}

fn summary_row(r: &Row<'_>) -> rusqlite::Result<Summary> {
    Ok(Summary {
        id: r.get(0)?,
        account_id: r.get(1)?,
        folder_id: r.get(2)?,
        folder_role: r.get(3)?,
        uid: r.get(4)?,
        subject: r.get(5)?,
        from: Addr {
            name: r.get(6)?,
            email: r.get(7)?,
        },
        to: addrs(r.get(8)?),
        date: r.get(9)?,
        size: r.get(10)?,
        seen: r.get(11)?,
        flagged: r.get(12)?,
        answered: r.get(13)?,
        has_attachments: r.get(14)?,
        snippet: r.get(15)?,
    })
}

/// Header data parsed from a fetched message, ready to store.
#[derive(Debug, Clone, Default)]
pub struct NewMessage {
    pub uid: u32,
    pub message_id: String,
    pub in_reply_to: String,
    pub refs: String,
    pub subject: String,
    pub from: Option<Addr>,
    pub to: Vec<Addr>,
    pub cc: Vec<Addr>,
    pub bcc: Vec<Addr>,
    pub reply_to: Vec<Addr>,
    pub date: i64,
    pub size: i64,
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub has_attachments: bool,
}

/// Everything stored about one message (without the raw body).
#[derive(Debug, Clone)]
pub struct Stored {
    pub summary: Summary,
    pub message_id: String,
    pub refs: String,
    pub cc: Vec<Addr>,
    pub bcc: Vec<Addr>,
    pub reply_to: Vec<Addr>,
    pub has_body: bool,
}

// ---- settings -----------------------------------------------------------------------------------

pub fn kv_get(c: &Connection, key: &str) -> Result<Option<String>> {
    Ok(
        c.query_row("SELECT value FROM kv WHERE key=?1", [key], |r| r.get(0))
            .optional()?,
    )
}

pub fn kv_set(c: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    match value {
        Some(v) => c.execute(
            "INSERT INTO kv(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, v],
        )?,
        None => c.execute("DELETE FROM kv WHERE key=?1", [key])?,
    };
    Ok(())
}

pub fn kv_prefix(c: &Connection, prefix: &str) -> Result<Vec<(String, String)>> {
    let mut st = c.prepare("SELECT key, value FROM kv WHERE key LIKE ?1 ESCAPE '\\'")?;
    let like = format!(
        "{}%",
        prefix
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let rows = st.query_map([like], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---- accounts -----------------------------------------------------------------------------------

pub fn accounts(c: &Connection) -> Result<Vec<Account>> {
    let mut st = c.prepare(&format!(
        "SELECT {ACCOUNT_COLS} FROM accounts ORDER BY position, id"
    ))?;
    let rows = st.query_map([], account_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn account(c: &Connection, id: i64) -> Result<Account> {
    c.query_row(
        &format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE id=?1"),
        [id],
        account_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound("This account no longer exists".into()))
}

/// Insert (`id == 0`) or update an account; returns its id.
pub fn save_account(c: &Connection, a: &Account) -> Result<i64> {
    if a.id == 0 {
        let position: i64 = c.query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM accounts",
            [],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO accounts(email, name, provider, color, signature, imap_host, imap_port, \
             imap_security, smtp_host, smtp_port, smtp_security, username, auth, oauth_provider, \
             position) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                a.email,
                a.name,
                a.provider,
                a.color,
                a.signature,
                a.imap_host,
                a.imap_port,
                a.imap_security,
                a.smtp_host,
                a.smtp_port,
                a.smtp_security,
                a.username,
                a.auth,
                a.oauth_provider,
                position
            ],
        )?;
        Ok(c.last_insert_rowid())
    } else {
        let n = c.execute(
            "UPDATE accounts SET email=?1, name=?2, provider=?3, color=?4, signature=?5, \
             imap_host=?6, imap_port=?7, imap_security=?8, smtp_host=?9, smtp_port=?10, \
             smtp_security=?11, username=?12, auth=?13, oauth_provider=?14 WHERE id=?15",
            params![
                a.email,
                a.name,
                a.provider,
                a.color,
                a.signature,
                a.imap_host,
                a.imap_port,
                a.imap_security,
                a.smtp_host,
                a.smtp_port,
                a.smtp_security,
                a.username,
                a.auth,
                a.oauth_provider,
                a.id
            ],
        )?;
        if n == 0 {
            return Err(Error::NotFound("This account no longer exists".into()));
        }
        Ok(a.id)
    }
}

pub fn delete_account(c: &Connection, id: i64) -> Result<()> {
    c.execute("DELETE FROM accounts WHERE id=?1", [id])?;
    Ok(())
}

pub fn set_sync_result(c: &Connection, id: i64, error: Option<&str>) -> Result<()> {
    match error {
        None => c.execute(
            "UPDATE accounts SET last_sync=?1, last_error=NULL WHERE id=?2",
            params![now(), id],
        )?,
        Some(e) => c.execute(
            "UPDATE accounts SET last_error=?1 WHERE id=?2",
            params![e, id],
        )?,
    };
    Ok(())
}

// ---- folders ------------------------------------------------------------------------------------

pub fn folders(c: &Connection, account_id: Option<i64>) -> Result<Vec<Folder>> {
    let mut st = c.prepare(&format!(
        "SELECT {FOLDER_COLS} FROM folders WHERE (?1 IS NULL OR account_id=?1) \
         ORDER BY account_id, name COLLATE NOCASE"
    ))?;
    let rows = st.query_map([account_id], folder_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn folder(c: &Connection, id: i64) -> Result<Folder> {
    c.query_row(
        &format!("SELECT {FOLDER_COLS} FROM folders WHERE id=?1"),
        [id],
        folder_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound("This folder no longer exists".into()))
}

pub fn folder_by_role(c: &Connection, account_id: i64, role: &str) -> Result<Option<Folder>> {
    Ok(c.query_row(
        &format!("SELECT {FOLDER_COLS} FROM folders WHERE account_id=?1 AND role=?2 LIMIT 1"),
        params![account_id, role],
        folder_row,
    )
    .optional()?)
}

/// A folder as the server lists it.
#[derive(Debug, Clone)]
pub struct ListedFolder {
    pub path: String,
    pub name: String,
    pub delimiter: String,
    pub role: String,
    pub selectable: bool,
}

/// Make the stored folders of an account match the server's list (keeps ids of known paths).
pub fn replace_folders(c: &mut Connection, account_id: i64, listed: &[ListedFolder]) -> Result<()> {
    let tx = c.transaction()?;
    for f in listed {
        tx.execute(
            "INSERT INTO folders(account_id, path, name, delimiter, role, selectable) \
             VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(account_id, path) DO UPDATE SET \
             name=?3, delimiter=?4, role=?5, selectable=?6",
            params![
                account_id,
                f.path,
                f.name,
                f.delimiter,
                f.role,
                f.selectable
            ],
        )?;
    }
    let known: Vec<(i64, String)> = {
        let mut st = tx.prepare("SELECT id, path FROM folders WHERE account_id=?1")?;
        let rows = st.query_map([account_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, path) in known {
        if !listed.iter().any(|f| f.path == path) {
            tx.execute("DELETE FROM folders WHERE id=?1", [id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn set_folder_counts(c: &Connection, id: i64, total: i64, unread: i64) -> Result<()> {
    c.execute(
        "UPDATE folders SET total=?1, unread=?2 WHERE id=?3",
        params![total, unread, id],
    )?;
    Ok(())
}

/// Adjust the counters after a local change (the next sync brings the server's numbers).
pub fn bump_counts(c: &Connection, folder_id: i64, total: i64, unread: i64) -> Result<()> {
    c.execute(
        "UPDATE folders SET total=MAX(0, total + ?1), unread=MAX(0, unread + ?2) WHERE id=?3",
        params![total, unread, folder_id],
    )?;
    Ok(())
}
/// Record the folder's UIDVALIDITY; when it changed, every cached message is stale and dropped.
pub fn check_uid_validity(c: &Connection, folder_id: i64, validity: i64) -> Result<()> {
    let old: Option<i64> = c.query_row(
        "SELECT uid_validity FROM folders WHERE id=?1",
        [folder_id],
        |r| r.get(0),
    )?;
    if old != Some(validity) {
        if old.is_some() {
            c.execute("DELETE FROM messages WHERE folder_id=?1", [folder_id])?;
        }
        c.execute(
            "UPDATE folders SET uid_validity=?1 WHERE id=?2",
            params![validity, folder_id],
        )?;
    }
    Ok(())
}

// ---- messages -----------------------------------------------------------------------------------

/// `(lowest, highest)` cached UID of a folder.
pub fn uid_range(c: &Connection, folder_id: i64) -> Result<Option<(u32, u32)>> {
    let r: (Option<u32>, Option<u32>) = c.query_row(
        "SELECT MIN(uid), MAX(uid) FROM messages WHERE folder_id=?1",
        [folder_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(r.0.zip(r.1))
}

/// Store fetched headers; returns how many were new.
pub fn insert_messages(
    c: &mut Connection,
    account_id: i64,
    folder_id: i64,
    items: &[NewMessage],
) -> Result<usize> {
    let tx = c.transaction()?;
    let mut added = 0;
    {
        let mut st = tx.prepare(
            "INSERT INTO messages(account_id, folder_id, uid, message_id, in_reply_to, refs, \
             subject, from_name, from_addr, to_json, cc_json, bcc_json, reply_to_json, date, size, \
             seen, flagged, answered, has_attachments) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19) \
             ON CONFLICT(folder_id, uid) DO UPDATE SET seen=?16, flagged=?17, answered=?18",
        )?;
        let mut exists = tx.prepare("SELECT 1 FROM messages WHERE folder_id=?1 AND uid=?2")?;
        for m in items {
            if !exists.exists(params![folder_id, m.uid])? {
                added += 1;
            }
            let from = m.from.clone().unwrap_or(Addr {
                name: String::new(),
                email: String::new(),
            });
            st.execute(params![
                account_id,
                folder_id,
                m.uid,
                m.message_id,
                m.in_reply_to,
                m.refs,
                m.subject,
                from.name,
                from.email,
                serde_json::to_string(&m.to)?,
                serde_json::to_string(&m.cc)?,
                serde_json::to_string(&m.bcc)?,
                serde_json::to_string(&m.reply_to)?,
                m.date,
                m.size,
                m.seen,
                m.flagged,
                m.answered,
                m.has_attachments
            ])?;
        }
    }
    tx.commit()?;
    Ok(added)
}

/// Flags as the server reports them for the cached UID range: `(uid, seen, flagged, answered)`.
/// Cached messages in `lo..=hi` that the server no longer lists were deleted elsewhere.
pub fn reconcile_flags(
    c: &mut Connection,
    folder_id: i64,
    lo: u32,
    hi: u32,
    server: &[(u32, bool, bool, bool)],
) -> Result<bool> {
    let tx = c.transaction()?;
    let mut changed = false;
    {
        let local: Vec<(u32, bool, bool, bool)> = {
            let mut st = tx.prepare(
                "SELECT uid, seen, flagged, answered FROM messages \
                 WHERE folder_id=?1 AND uid BETWEEN ?2 AND ?3",
            )?;
            let rows = st.query_map(params![folder_id, lo, hi], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let map: std::collections::HashMap<u32, (bool, bool, bool)> =
            server.iter().map(|s| (s.0, (s.1, s.2, s.3))).collect();
        let mut update = tx.prepare(
            "UPDATE messages SET seen=?1, flagged=?2, answered=?3 WHERE folder_id=?4 AND uid=?5",
        )?;
        let mut delete = tx.prepare("DELETE FROM messages WHERE folder_id=?1 AND uid=?2")?;
        for (uid, seen, flagged, answered) in local {
            match map.get(&uid) {
                Some(&(s, f, a)) if (s, f, a) != (seen, flagged, answered) => {
                    update.execute(params![s, f, a, folder_id, uid])?;
                    changed = true;
                }
                Some(_) => {}
                None => {
                    delete.execute(params![folder_id, uid])?;
                    changed = true;
                }
            }
        }
    }
    tx.commit()?;
    Ok(changed)
}

/// What a message list shows.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    /// `folder` (with `folderId`), `inbox`, `unread`, `flagged`, `all` — the last four span every
    /// account unless `accountId` narrows them.
    pub scope: String,
    #[serde(default)]
    pub folder_id: Option<i64>,
    #[serde(default)]
    pub account_id: Option<i64>,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub flagged: bool,
    #[serde(default)]
    pub attachments: bool,
    #[serde(default)]
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    100
}

#[derive(Debug, Serialize)]
pub struct Page {
    pub items: Vec<Summary>,
    pub total: i64,
}

pub fn list_messages(c: &Connection, q: &ListQuery) -> Result<Page> {
    let mut cond: Vec<String> = Vec::new();
    let mut args: Vec<Sql> = Vec::new();
    const NO_NOISE: &str = "f.role NOT IN ('trash', 'junk')";
    match q.scope.as_str() {
        "folder" => {
            cond.push("m.folder_id=?".into());
            args.push(Sql::Integer(
                q.folder_id
                    .ok_or_else(|| Error::invalid("folderId missing"))?,
            ));
        }
        "inbox" => cond.push("f.role='inbox'".into()),
        "unread" => {
            cond.push("m.seen=0".into());
            cond.push("f.role NOT IN ('trash', 'junk', 'sent', 'drafts')".into());
        }
        "flagged" => {
            cond.push("m.flagged=1".into());
            cond.push(NO_NOISE.into());
        }
        "all" => cond.push(NO_NOISE.into()),
        other => return Err(Error::invalid(format!("Unknown scope {other:?}"))),
    }
    if let Some(a) = q.account_id {
        cond.push("m.account_id=?".into());
        args.push(Sql::Integer(a));
    }
    if q.unread {
        cond.push("m.seen=0".into());
    }
    if q.flagged {
        cond.push("m.flagged=1".into());
    }
    if q.attachments {
        cond.push("m.has_attachments=1".into());
    }
    for word in q.query.split_whitespace().take(8) {
        let like = format!(
            "%{}%",
            word.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        cond.push(
            "(m.subject LIKE ? ESCAPE '\\' OR m.from_name LIKE ? ESCAPE '\\' OR m.from_addr LIKE ? \
             ESCAPE '\\' OR m.to_json LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\')"
                .into(),
        );
        for _ in 0..5 {
            args.push(Sql::Text(like.clone()));
        }
    }
    let wh = cond.join(" AND ");
    let from = "FROM messages m JOIN folders f ON f.id = m.folder_id";
    let total: i64 = c.query_row(
        &format!("SELECT COUNT(*) {from} WHERE {wh}"),
        params_from_iter(args.iter()),
        |r| r.get(0),
    )?;
    args.push(Sql::Integer(q.limit.clamp(1, 500)));
    args.push(Sql::Integer(q.offset.max(0)));
    let mut st = c.prepare(&format!(
        "SELECT {SUMMARY_COLS} {from} WHERE {wh} ORDER BY m.date DESC, m.id DESC LIMIT ? OFFSET ?"
    ))?;
    let rows = st.query_map(params_from_iter(args.iter()), summary_row)?;
    Ok(Page {
        items: rows.collect::<rusqlite::Result<_>>()?,
        total,
    })
}

pub fn message(c: &Connection, id: i64) -> Result<Stored> {
    c.query_row(
        &format!(
            "SELECT {SUMMARY_COLS}, m.message_id, m.refs, m.cc_json, m.bcc_json, m.reply_to_json, \
             m.has_body FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id=?1"
        ),
        [id],
        |r| {
            Ok(Stored {
                summary: summary_row(r)?,
                message_id: r.get(16)?,
                refs: r.get(17)?,
                cc: addrs(r.get(18)?),
                bcc: addrs(r.get(19)?),
                reply_to: addrs(r.get(20)?),
                has_body: r.get(21)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| Error::NotFound("This message no longer exists".into()))
}

pub fn summaries(c: &Connection, ids: &[i64]) -> Result<Vec<Summary>> {
    let mut out = Vec::with_capacity(ids.len());
    let mut st = c.prepare(&format!(
        "SELECT {SUMMARY_COLS} FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id=?1"
    ))?;
    for id in ids {
        if let Some(s) = st.query_row([id], summary_row).optional()? {
            out.push(s);
        }
    }
    Ok(out)
}

pub fn raw_body(c: &Connection, id: i64) -> Result<Option<Vec<u8>>> {
    Ok(
        c.query_row("SELECT raw FROM bodies WHERE message_id=?1", [id], |r| {
            r.get(0)
        })
        .optional()?,
    )
}

pub fn store_body(
    c: &Connection,
    id: i64,
    raw: &[u8],
    snippet: &str,
    has_attachments: bool,
) -> Result<()> {
    c.execute(
        "INSERT INTO bodies(message_id, raw) VALUES(?1, ?2) \
         ON CONFLICT(message_id) DO UPDATE SET raw=?2",
        params![id, raw],
    )?;
    c.execute(
        "UPDATE messages SET has_body=1, snippet=?1, has_attachments=?2 WHERE id=?3",
        params![snippet, has_attachments, id],
    )?;
    Ok(())
}

/// Recent messages of a folder whose body is not cached yet and is small enough to prefetch.
pub fn missing_bodies(
    c: &Connection,
    folder_id: i64,
    max_size: i64,
    limit: i64,
) -> Result<Vec<(i64, u32)>> {
    let mut st = c.prepare(
        "SELECT id, uid FROM messages WHERE folder_id=?1 AND has_body=0 AND size<=?2 \
         ORDER BY date DESC LIMIT ?3",
    )?;
    let rows = st.query_map(params![folder_id, max_size, limit], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn set_flags(c: &Connection, id: i64, seen: Option<bool>, flagged: Option<bool>) -> Result<()> {
    if let Some(v) = seen {
        c.execute("UPDATE messages SET seen=?1 WHERE id=?2", params![v, id])?;
    }
    if let Some(v) = flagged {
        c.execute("UPDATE messages SET flagged=?1 WHERE id=?2", params![v, id])?;
    }
    Ok(())
}

pub fn set_answered(c: &Connection, id: i64) -> Result<()> {
    c.execute("UPDATE messages SET answered=1 WHERE id=?1", [id])?;
    Ok(())
}

pub fn delete_messages(c: &Connection, ids: &[i64]) -> Result<()> {
    let mut st = c.prepare("DELETE FROM messages WHERE id=?1")?;
    for id in ids {
        st.execute([id])?;
    }
    Ok(())
}

// ---- drafts -------------------------------------------------------------------------------------

pub fn drafts(c: &Connection) -> Result<Vec<(i64, String, i64)>> {
    let mut st = c.prepare("SELECT id, data, updated_at FROM drafts ORDER BY updated_at DESC")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn save_draft(c: &Connection, id: i64, data: &str) -> Result<i64> {
    if id != 0
        && c.execute(
            "UPDATE drafts SET data=?1, updated_at=?2 WHERE id=?3",
            params![data, now(), id],
        )? > 0
    {
        return Ok(id);
    }
    c.execute(
        "INSERT INTO drafts(data, updated_at) VALUES(?1, ?2)",
        params![data, now()],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn delete_draft(c: &Connection, id: i64) -> Result<()> {
    c.execute("DELETE FROM drafts WHERE id=?1", [id])?;
    Ok(())
}

// ---- contacts -----------------------------------------------------------------------------------

/// Remember addresses the user wrote to (weight 3) or received mail from (weight 1).
pub fn touch_contacts(c: &Connection, people: &[Addr], weight: i64) -> Result<()> {
    let mut st = c.prepare(
        "INSERT INTO contacts(email, name, uses, last_used) VALUES(?1, ?2, ?3, ?4) \
         ON CONFLICT(email) DO UPDATE SET uses=uses+?3, last_used=?4, \
         name=CASE WHEN ?2 <> '' THEN ?2 ELSE name END",
    )?;
    for p in people {
        let email = p.email.trim().to_lowercase();
        if email.contains('@') {
            st.execute(params![email, p.name.trim(), weight, now()])?;
        }
    }
    Ok(())
}

pub fn search_contacts(c: &Connection, q: &str, limit: i64) -> Result<Vec<Addr>> {
    let like = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut st = c.prepare(
        "SELECT name, email FROM contacts WHERE email LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE \
         '\\' ORDER BY uses DESC, last_used DESC LIMIT ?2",
    )?;
    let rows = st.query_map(params![like, limit], |r| {
        Ok(Addr {
            name: r.get(0)?,
            email: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
