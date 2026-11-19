//! Keeping the local cache in step with the servers, and applying the user's changes (flags,
//! moves, deletions, folders) to both sides.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{Value, json};

use crate::db::{self, Account, Folder, Stored};
use crate::error::{Error, Result};
use crate::imap::{self, Session};
use crate::{events, mime};

/// Messages fetched per folder on the first sync and by each "load older" step.
const WINDOW: u32 = 200;
/// Bodies up to this size are downloaded ahead of time for snippets and offline reading.
const PREFETCH_MAX_SIZE: i64 = 300 * 1024;
const PREFETCH_PER_PASS: i64 = 40;
const SYNC_LIMIT: Duration = Duration::from_secs(600);
const OP_LIMIT: Duration = Duration::from_secs(90);

/// Folders that only mirror messages living elsewhere (Gmail's virtual folders).
fn is_virtual(role: &str) -> bool {
    matches!(role, "all" | "flagged" | "important")
}

fn locks() -> &'static Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>> {
    static L: OnceLock<Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    L.get_or_init(Default::default)
}

fn lock_for(account_id: i64) -> Arc<tokio::sync::Mutex<()>> {
    locks()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .entry(account_id)
        .or_default()
        .clone()
}

/// Accounts with a sync in progress.
pub fn syncing() -> Vec<i64> {
    let map = locks().lock().unwrap_or_else(|p| p.into_inner());
    map.iter()
        .filter(|(_, l)| l.try_lock().is_err())
        .map(|(id, _)| *id)
        .collect()
}

/// Synchronize one account: folder list, then every real folder. A second call while one is
/// running returns at once.
pub async fn sync_account(account_id: i64) -> Result<()> {
    let lock = lock_for(account_id);
    let Ok(_guard) = lock.try_lock() else {
        return Ok(());
    };
    let account = db::with(|c| db::account(c, account_id))?;
    events::emit("sync", json!({ "accountId": account_id, "state": "start" }));
    let result = with_session!(&account, SYNC_LIMIT, |s| sync_all(s, &account).await);
    let error = result.as_ref().err().map(|e| e.to_string());
    let _ = db::with(|c| db::set_sync_result(c, account_id, error.as_deref()));
    events::emit(
        "sync",
        json!({
            "accountId": account_id,
            "state": if error.is_some() { "error" } else { "done" },
            "error": error,
            "errorKind": result.as_ref().err().map(|e| e.kind()),
        }),
    );
    result
}

async fn sync_all(s: &mut Session, account: &Account) -> Result<()> {
    let listed = imap::list_folders(s).await?;
    db::with(|c| db::replace_folders(c, account.id, &listed))?;
    events::emit("folders", json!({ "accountId": account.id }));
    let mut folders = db::with(|c| db::folders(c, Some(account.id)))?;
    // Inbox first: it is what the user is waiting for.
    folders.sort_by_key(|f| f.role != "inbox");
    let mut first_error = None;
    for f in folders
        .iter()
        .filter(|f| f.selectable && !is_virtual(&f.role))
    {
        match sync_folder(s, account, f).await {
            Ok(()) => {}
            // One broken folder must not hide the others; a dead connection ends the run.
            Err(e @ (Error::Network(_) | Error::Auth(_) | Error::Io(_))) => return Err(e),
            Err(e) => {
                first_error.get_or_insert(Error::Imap(format!("{}: {e}", f.name)));
            }
        }
    }
    events::emit("folders", json!({ "accountId": account.id }));
    first_error.map_or(Ok(()), Err)
}

/// Bring one folder up to date. Leaves it selected.
pub async fn sync_folder(s: &mut Session, account: &Account, f: &Folder) -> Result<()> {
    let status = s.status(&f.path, "(MESSAGES UNSEEN)").await?;
    let mailbox = s.select(&f.path).await?;
    let exists = mailbox.exists;
    db::with(|c| {
        if let Some(v) = mailbox.uid_validity {
            db::check_uid_validity(c, f.id, v as i64)?;
        }
        db::set_folder_counts(c, f.id, exists as i64, status.unseen.unwrap_or(0) as i64)
    })?;

    let range = db::with(|c| db::uid_range(c, f.id))?;
    let mut changed = false;
    let first_time = range.is_none();
    let headers = match range {
        _ if exists == 0 => {
            if let Some((lo, hi)) = range {
                changed = db::with(|c| db::reconcile_flags(c, f.id, lo, hi, &[]))?;
            }
            Vec::new()
        }
        None => {
            let from = exists.saturating_sub(WINDOW - 1).max(1);
            imap::fetch_headers(s, &format!("{from}:*"), false).await?
        }
        Some((lo, hi)) => {
            let flags = imap::fetch_flags(s, lo, hi).await?;
            changed = db::with(|c| db::reconcile_flags(c, f.id, lo, hi, &flags))?;
            // `n:*` always answers with the newest message, even when its UID is below n.
            let mut new = imap::fetch_headers(s, &format!("{}:*", hi + 1), true).await?;
            new.retain(|m| m.uid > hi);
            new
        }
    };
    let added = db::with(|c| db::insert_messages(c, account.id, f.id, &headers))?;
    if added > 0 || changed {
        events::emit(
            "messages",
            json!({ "accountId": account.id, "folderId": f.id }),
        );
    }
    if added > 0 {
        let senders: Vec<_> = headers.iter().filter_map(|m| m.from.clone()).collect();
        if f.role != "junk" && f.role != "trash" {
            let _ = db::with(|c| db::touch_contacts(c, &senders, 1));
        }
        let unseen: Vec<_> = headers.iter().filter(|m| !m.seen).collect();
        if !first_time && f.role == "inbox" && !unseen.is_empty() {
            let newest = unseen.iter().max_by_key(|m| m.uid).expect("not empty");
            events::emit(
                "newMail",
                json!({
                    "accountId": account.id,
                    "email": account.email,
                    "count": unseen.len(),
                    "from": newest.from.as_ref().map(|a| if a.name.is_empty() { a.email.clone() } else { a.name.clone() }),
                    "subject": newest.subject,
                }),
            );
        }
    }
    prefetch_bodies(s, account, f).await
}

/// Download the bodies of recent small messages of the selected folder.
async fn prefetch_bodies(s: &mut Session, account: &Account, f: &Folder) -> Result<()> {
    if f.role == "junk" || f.role == "trash" {
        return Ok(());
    }
    let missing = db::with(|c| db::missing_bodies(c, f.id, PREFETCH_MAX_SIZE, PREFETCH_PER_PASS))?;
    if missing.is_empty() {
        return Ok(());
    }
    for (id, uid) in missing {
        match imap::fetch_raw(s, uid).await {
            Ok(raw) => {
                let (snippet, has_attachments) = mime::summarize(&raw);
                db::with(|c| db::store_body(c, id, &raw, &snippet, has_attachments))?;
            }
            Err(Error::NotFound(_)) => {}
            Err(e) => return Err(e),
        }
    }
    events::emit(
        "messages",
        json!({ "accountId": account.id, "folderId": f.id }),
    );
    Ok(())
}

/// Fetch the next window of older messages of a folder; returns how many arrived.
pub async fn load_older(folder_id: i64) -> Result<usize> {
    let f = db::with(|c| db::folder(c, folder_id))?;
    let account = db::with(|c| db::account(c, f.account_id))?;
    let Some((lo, _)) = db::with(|c| db::uid_range(c, f.id))? else {
        sync_account(account.id).await?;
        return Ok(0);
    };
    if lo <= 1 {
        return Ok(0);
    }
    let added = with_session!(&account, OP_LIMIT, |s| {
        s.select(&f.path).await?;
        let mut uids: Vec<u32> = s
            .uid_search(format!("UID 1:{}", lo - 1))
            .await?
            .into_iter()
            .filter(|u| *u < lo)
            .collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        uids.truncate(WINDOW as usize);
        if uids.is_empty() {
            return Ok(0);
        }
        let headers = imap::fetch_headers(s, &imap::uid_set(&uids), true).await?;
        db::with(|c| db::insert_messages(c, account.id, f.id, &headers))
    })?;
    if added > 0 {
        events::emit(
            "messages",
            json!({ "accountId": account.id, "folderId": f.id }),
        );
    }
    Ok(added)
}

// ---- reading ------------------------------------------------------------------------------------

/// The raw message, from the cache or the server (and then cached).
pub async fn raw_message(m: &Stored) -> Result<Vec<u8>> {
    let id = m.summary.id;
    if let Some(raw) = db::with(|c| db::raw_body(c, id))? {
        return Ok(raw);
    }
    let f = db::with(|c| db::folder(c, m.summary.folder_id))?;
    let account = db::with(|c| db::account(c, m.summary.account_id))?;
    let uid = m.summary.uid;
    let raw = with_session!(&account, OP_LIMIT, |s| {
        s.select(&f.path).await?;
        imap::fetch_raw(s, uid).await
    })?;
    let (snippet, has_attachments) = mime::summarize(&raw);
    db::with(|c| db::store_body(c, id, &raw, &snippet, has_attachments))?;
    Ok(raw)
}

/// Everything the reader shows for one message.
pub async fn detail(id: i64) -> Result<Value> {
    let m = db::with(|c| db::message(c, id))?;
    let raw = raw_message(&m).await?;
    let body = mime::parse_body(&raw);
    let mut v = json!(m.summary);
    v["cc"] = json!(m.cc);
    v["bcc"] = json!(m.bcc);
    v["replyTo"] = json!(m.reply_to);
    v["messageId"] = json!(m.message_id);
    v["references"] = json!(m.refs);
    v["html"] = json!(body.html);
    v["text"] = json!(body.text);
    v["attachments"] = json!(body.attachments);
    v["hasRemoteImages"] = json!(body.has_remote_images);
    v["snippet"] = json!(body.snippet);
    Ok(v)
}

// ---- changes ------------------------------------------------------------------------------------

/// The selected messages grouped by account and folder.
fn group(ids: &[i64]) -> Result<BTreeMap<(i64, i64), Vec<db::Summary>>> {
    let mut groups: BTreeMap<(i64, i64), Vec<db::Summary>> = BTreeMap::new();
    for s in db::with(|c| db::summaries(c, ids))? {
        groups
            .entry((s.account_id, s.folder_id))
            .or_default()
            .push(s);
    }
    Ok(groups)
}

fn changed(account_id: i64, folder_id: i64) {
    events::emit(
        "messages",
        json!({ "accountId": account_id, "folderId": folder_id }),
    );
    events::emit("folders", json!({ "accountId": account_id }));
}

/// Mark messages read/unread and/or starred/unstarred, locally at once and then on the server.
pub async fn set_flags(ids: &[i64], seen: Option<bool>, flagged: Option<bool>) -> Result<()> {
    let groups = group(ids)?;
    for ((account_id, folder_id), items) in &groups {
        db::with(|c| {
            for m in items {
                db::set_flags(c, m.id, seen, flagged)?;
                if let Some(v) = seen.filter(|v| *v != m.seen) {
                    db::bump_unread(c, *folder_id, if v { -1 } else { 1 })?;
                }
            }
            Ok(())
        })?;
        changed(*account_id, *folder_id);
    }
    for ((account_id, folder_id), items) in groups {
        let account = db::with(|c| db::account(c, account_id))?;
        let f = db::with(|c| db::folder(c, folder_id))?;
        let uids: Vec<u32> = items.iter().map(|m| m.uid).collect();
        with_session!(&account, OP_LIMIT, |s| {
            s.select(&f.path).await?;
            if let Some(v) = seen {
                imap::store(
                    s,
                    &uids,
                    &format!("{}FLAGS.SILENT (\\Seen)", if v { '+' } else { '-' }),
                )
                .await?;
            }
            if let Some(v) = flagged {
                imap::store(
                    s,
                    &uids,
                    &format!("{}FLAGS.SILENT (\\Flagged)", if v { '+' } else { '-' }),
                )
                .await?;
            }
            Ok(())
        })?;
    }
    Ok(())
}

/// Where a message goes.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Target<'a> {
    Folder(i64),
    /// The account's folder with this special-use role.
    Role(&'a str),
    /// Trash, or gone for good when it already is in Trash/Junk/Drafts or there is no Trash.
    Delete,
}

fn forget_locally(account_id: i64, folder_id: i64, items: &[db::Summary]) -> Result<()> {
    let ids: Vec<i64> = items.iter().map(|m| m.id).collect();
    let unread = items.iter().filter(|m| !m.seen).count() as i64;
    db::with(|c| {
        db::delete_messages(c, &ids)?;
        db::bump_unread(c, folder_id, -unread)
    })?;
    changed(account_id, folder_id);
    Ok(())
}

pub async fn relocate(ids: &[i64], target: Target<'_>) -> Result<()> {
    for ((account_id, folder_id), items) in group(ids)? {
        let account = db::with(|c| db::account(c, account_id))?;
        let src = db::with(|c| db::folder(c, folder_id))?;
        let dest = match target {
            Target::Folder(id) => {
                let d = db::with(|c| db::folder(c, id))?;
                if d.account_id != account_id {
                    return Err(Error::invalid(
                        "Messages can only be moved within their own account",
                    ));
                }
                Some(d)
            }
            Target::Role(role) => {
                // Gmail archives by keeping the message in All Mail only.
                let fallback = if role == "archive" { "all" } else { "" };
                let d = db::with(|c| {
                    Ok(match db::folder_by_role(c, account_id, role)? {
                        Some(d) => Some(d),
                        None => db::folder_by_role(c, account_id, fallback)?,
                    })
                })?;
                Some(d.ok_or_else(|| {
                    Error::NotFound(format!("{} has no {role} folder", account.email))
                })?)
            }
            Target::Delete => match src.role.as_str() {
                "trash" | "junk" | "drafts" => None,
                _ => db::with(|c| db::folder_by_role(c, account_id, "trash"))?,
            },
        };
        if dest.as_ref().is_some_and(|d| d.id == src.id) {
            continue;
        }
        let uids: Vec<u32> = items.iter().map(|m| m.uid).collect();
        forget_locally(account_id, folder_id, &items)?;
        let result = apply_relocation(&account, &src, dest.as_ref(), &uids).await;
        if let Err(e) = result {
            // The local rows are gone but the server kept the messages: resync brings them back.
            tokio::spawn(sync_account(account_id));
            return Err(e);
        }
        events::emit("folders", json!({ "accountId": account_id }));
    }
    Ok(())
}

async fn apply_relocation(
    account: &Account,
    src: &Folder,
    dest: Option<&Folder>,
    uids: &[u32],
) -> Result<()> {
    with_session!(account, OP_LIMIT, |s| {
        s.select(&src.path).await?;
        match dest {
            Some(d) => {
                imap::move_to(s, uids, &d.path).await?;
                if !is_virtual(&d.role) {
                    sync_folder(s, account, d).await?;
                }
            }
            None => imap::expunge(s, uids).await?,
        }
        Ok(())
    })
}

// ---- folders ------------------------------------------------------------------------------------

async fn relist(s: &mut Session, account_id: i64) -> Result<()> {
    let listed = imap::list_folders(s).await?;
    db::with(|c| db::replace_folders(c, account_id, &listed))?;
    events::emit("folders", json!({ "accountId": account_id }));
    Ok(())
}

fn check_folder_name(name: &str, delimiter: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.contains(delimiter) || name.chars().any(char::is_control) {
        return Err(Error::invalid(format!(
            "A folder name cannot be empty or contain {delimiter:?}"
        )));
    }
    Ok(imap::utf7_encode(name))
}

pub async fn create_folder(account_id: i64, name: &str, parent: Option<i64>) -> Result<()> {
    let account = db::with(|c| db::account(c, account_id))?;
    let path = match parent {
        Some(id) => {
            let p = db::with(|c| db::folder(c, id))?;
            format!(
                "{}{}{}",
                p.path,
                p.delimiter,
                check_folder_name(name, &p.delimiter)?
            )
        }
        None => check_folder_name(name, "/")?,
    };
    with_session!(&account, OP_LIMIT, |s| {
        s.create(&path).await?;
        let _ = s.subscribe(&path).await;
        relist(s, account_id).await
    })
}

fn user_folder(id: i64) -> Result<(Account, Folder)> {
    let f = db::with(|c| db::folder(c, id))?;
    if !f.role.is_empty() {
        return Err(Error::invalid(format!(
            "{} is a system folder and cannot be changed",
            f.name
        )));
    }
    let account = db::with(|c| db::account(c, f.account_id))?;
    Ok((account, f))
}

pub async fn rename_folder(id: i64, name: &str) -> Result<()> {
    let (account, f) = user_folder(id)?;
    let leaf = check_folder_name(name, &f.delimiter)?;
    let path = match f.path.rfind(f.delimiter.as_str()) {
        Some(i) => format!("{}{}", &f.path[..i + f.delimiter.len()], leaf),
        None => leaf,
    };
    with_session!(&account, OP_LIMIT, |s| {
        s.rename(&f.path, &path).await?;
        relist(s, f.account_id).await
    })?;
    // The renamed folder got a new local id; fill it again.
    tokio::spawn(sync_account(account.id));
    Ok(())
}

pub async fn delete_folder(id: i64) -> Result<()> {
    let (account, f) = user_folder(id)?;
    with_session!(&account, OP_LIMIT, |s| {
        // A folder cannot be deleted while it is the selected one.
        s.select("INBOX").await?;
        s.delete(&f.path).await?;
        relist(s, f.account_id).await
    })
}

// ---- background ---------------------------------------------------------------------------------

fn interval_minutes() -> i64 {
    db::with(|c| db::kv_get(c, "setting.syncInterval"))
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
}

/// Sync every account now, in parallel.
pub fn sync_everything() {
    if let Ok(accounts) = db::with(|c| db::accounts(c)) {
        for a in accounts {
            tokio::spawn(sync_account(a.id));
        }
    }
}

/// Runs for the life of the app: syncs every account at start and then every
/// `setting.syncInterval` minutes (0 turns the timer off; manual refresh still works).
pub async fn background_loop() {
    let mut since_last = Duration::MAX;
    let tick = Duration::from_secs(20);
    loop {
        let every = interval_minutes();
        if since_last == Duration::MAX
            || (every > 0 && since_last >= Duration::from_secs(every as u64 * 60))
        {
            sync_everything();
            since_last = Duration::ZERO;
        }
        tokio::time::sleep(tick).await;
        since_last = since_last.saturating_add(tick);
    }
}
