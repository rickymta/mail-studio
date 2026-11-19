//! MailStudio's backend: mail accounts on any IMAP/SMTP provider, a local cache of their
//! folders and messages, and everything the UI does with them. UI-agnostic: the Tauri shell and
//! the dev HTTP bridge both call [`dispatch`].

/// Run `$body` with `$s` bound to a logged-in IMAP session of `$account`. The session returns to
/// the pool when the body succeeds and is dropped when it fails or exceeds `$limit` (its state is
/// unknown then). Evaluates to the body's `Result`; a failed connection returns early with `?`.
macro_rules! with_session {
    ($account:expr, $limit:expr, |$s:ident| $body:expr) => {{
        let mut session = $crate::imap::checkout($account).await?;
        let out = {
            let $s = &mut session;
            $crate::imap::timed($account, $limit, async { $body }).await
        };
        if out.is_ok() {
            $crate::imap::give($account.id, session);
        }
        out
    }};
}

pub mod compose;
pub mod db;
pub mod error;
pub mod events;
pub mod imap;
pub mod mime;
pub mod oauth;
pub mod providers;
pub mod secrets;
pub mod sync;

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

pub use error::{Error, Result};
pub use sync::background_loop;

use db::Account;
use imap::Credential;

fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T> {
    let v = args.get(name).cloned().unwrap_or(Value::Null);
    serde_json::from_value(v).map_err(|e| Error::invalid(format!("Argument {name:?}: {e}")))
}

fn ids(args: &Value) -> Result<Vec<i64>> {
    let ids: Vec<i64> = arg(args, "ids")?;
    if ids.is_empty() {
        return Err(Error::invalid("No message selected"));
    }
    Ok(ids)
}

fn init() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // lettre and reqwest build their TLS configs from the process-wide provider.
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    });
}

// ---- settings -----------------------------------------------------------------------------------

/// Settings the backend stores for the UI (`setting.*`) and the OAuth client ids (`oauth.*`).
fn settings_get() -> Result<Value> {
    let mut out = serde_json::Map::new();
    db::with(|c| {
        for prefix in ["setting.", "oauth."] {
            for (k, v) in db::kv_prefix(c, prefix)? {
                out.insert(k, Value::String(v));
            }
        }
        Ok(())
    })?;
    for provider in ["google", "microsoft"] {
        let has = secrets::get(&secrets::client_secret_key(provider))
            .ok()
            .flatten()
            .is_some();
        out.insert(format!("oauth.{provider}.hasClientSecret"), json!(has));
    }
    Ok(Value::Object(out))
}

fn settings_set(changes: serde_json::Map<String, Value>) -> Result<()> {
    for (key, value) in changes {
        let value = value.as_str().map(str::to_string).filter(|v| !v.is_empty());
        if let Some(provider) = key
            .strip_prefix("oauth.")
            .and_then(|k| k.strip_suffix(".clientSecret"))
        {
            let name = secrets::client_secret_key(provider);
            match &value {
                Some(v) => secrets::set(&name, v)?,
                None => secrets::delete(&name)?,
            }
        } else if key.starts_with("setting.") || key.starts_with("oauth.") {
            db::with(|c| db::kv_set(c, &key, value.as_deref()))?;
        } else {
            return Err(Error::invalid(format!("Unknown setting {key:?}")));
        }
    }
    Ok(())
}

// ---- accounts -----------------------------------------------------------------------------------

fn check_account(a: &mut Account) -> Result<()> {
    a.email = a.email.trim().to_string();
    a.username = a.username.trim().to_string();
    a.imap_host = a.imap_host.trim().to_string();
    a.smtp_host = a.smtp_host.trim().to_string();
    if !a.email.contains('@') || a.email.contains(char::is_whitespace) {
        return Err(Error::invalid("Enter a valid e-mail address"));
    }
    if a.username.is_empty() {
        a.username = a.email.clone();
    }
    if a.imap_host.is_empty() || a.smtp_host.is_empty() {
        return Err(Error::invalid("Enter the IMAP and SMTP servers"));
    }
    for s in [&a.imap_security, &a.smtp_security] {
        if !matches!(s.as_str(), "tls" | "starttls" | "none") {
            return Err(Error::invalid(format!("Unknown connection security {s:?}")));
        }
    }
    if a.auth == "oauth" && !matches!(a.oauth_provider.as_str(), "google" | "microsoft") {
        return Err(Error::invalid("This provider has no OAuth sign-in"));
    }
    if a.auth != "oauth" {
        a.auth = "password".into();
        a.oauth_provider.clear();
    }
    Ok(())
}

/// The credential to use for an account that is being added or edited.
async fn draft_credential(a: &Account, args: &Value) -> Result<Credential> {
    let password: Option<String> = arg(args, "password")?;
    let flow: Option<String> = arg(args, "oauthFlow")?;
    if a.auth == "oauth" {
        return match flow.filter(|f| !f.is_empty()) {
            Some(f) => Ok(Credential::OAuth(oauth::grant(&f)?.access_token)),
            None if a.id != 0 => imap::credential(a).await,
            None => Err(Error::invalid("Sign in with the provider first.")),
        };
    }
    match password.filter(|p| !p.is_empty()) {
        Some(p) => Ok(Credential::Password(p)),
        None if a.id != 0 => imap::credential(a).await,
        // The local test server accepts anything; real servers answer with their own error.
        None => Ok(Credential::Password(String::new())),
    }
}

async fn account_test(args: &Value) -> Result<Value> {
    let mut a: Account = arg(args, "account")?;
    check_account(&mut a)?;
    let cred = draft_credential(&a, args).await?;
    let mut session = imap::connect(&a, &cred)
        .await
        .map_err(|e| prefix("Incoming mail (IMAP)", e))?;
    let _ = session.logout().await;
    compose::test_smtp(&a, &cred)
        .await
        .map_err(|e| prefix("Outgoing mail (SMTP)", e))?;
    Ok(json!({ "ok": true }))
}

fn prefix(what: &str, e: Error) -> Error {
    let msg = format!("{what}: {e}");
    match e {
        Error::Auth(_) => Error::Auth(msg),
        Error::Network(_) | Error::Io(_) => Error::Network(msg),
        Error::Smtp(_) => Error::Smtp(msg),
        Error::Imap(_) => Error::Imap(msg),
        other => other,
    }
}

async fn account_save(args: &Value) -> Result<Value> {
    let mut a: Account = arg(args, "account")?;
    check_account(&mut a)?;
    let password: Option<String> = arg(args, "password")?;
    let flow: Option<String> = arg(args, "oauthFlow")?;
    let password = password.filter(|p| !p.is_empty());
    let flow = flow.filter(|f| !f.is_empty());
    let is_new = a.id == 0;
    if is_new {
        let taken = db::with(|c| db::accounts(c))?
            .iter()
            .any(|x| x.email.eq_ignore_ascii_case(&a.email));
        if taken {
            return Err(Error::invalid(format!("{} is already added", a.email)));
        }
        if a.auth == "oauth" && flow.is_none() {
            return Err(Error::invalid("Sign in with the provider first."));
        }
    }
    let id = db::with(|c| db::save_account(c, &a))?;
    let stored = (|| {
        if a.auth == "oauth" {
            if let Some(f) = &flow {
                oauth::adopt(f, id)?;
            }
            secrets::delete(&secrets::password_key(id))
        } else {
            if let Some(p) = &password {
                secrets::set(&secrets::password_key(id), p)?;
            }
            secrets::delete(&secrets::refresh_key(id))
        }
    })();
    if let Err(e) = stored {
        if is_new {
            let _ = db::with(|c| db::delete_account(c, id));
        }
        return Err(e);
    }
    imap::forget(id);
    events::emit("accounts", json!({}));
    tokio::spawn(sync::sync_account(id));
    Ok(json!(db::with(|c| db::account(c, id))?))
}

fn account_remove(id: i64) -> Result<()> {
    db::with(|c| db::account(c, id))?;
    imap::forget(id);
    oauth::forget(id);
    // A locked credential store must not keep the account from being removed.
    let _ = secrets::delete(&secrets::password_key(id));
    let _ = secrets::delete(&secrets::refresh_key(id));
    db::with(|c| db::delete_account(c, id))?;
    events::emit("accounts", json!({}));
    Ok(())
}

// ---- attachments --------------------------------------------------------------------------------

async fn attachment_bytes(args: &Value) -> Result<(String, Vec<u8>)> {
    let id: i64 = arg(args, "id")?;
    let index: usize = arg(args, "index")?;
    let m = db::with(|c| db::message(c, id))?;
    let raw = sync::raw_message(&m).await?;
    let (name, _, data) = mime::attachment(&raw, index)
        .ok_or_else(|| Error::NotFound("This attachment no longer exists".into()))?;
    Ok((name, data))
}

/// Write an attachment to a temporary folder and return its path (to open it with the default
/// application).
async fn attachment_open(args: &Value) -> Result<Value> {
    let id: i64 = arg(args, "id")?;
    let index: usize = arg(args, "index")?;
    let (name, data) = attachment_bytes(args).await?;
    let dir = db::data_dir()
        .join("attachments")
        .join(format!("{id}-{index}"));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(mime::safe_file_name(&name));
    std::fs::write(&path, data)?;
    Ok(json!(path.to_string_lossy()))
}

// ---- dispatch -----------------------------------------------------------------------------------

/// Run one command from the UI.
pub async fn dispatch(cmd: &str, args: Value) -> Result<Value> {
    init();
    let a = &args;
    Ok(match cmd {
        "app.info" => json!({
            "version": env!("CARGO_PKG_VERSION"),
            "dataDir": db::data_dir().to_string_lossy(),
        }),
        "settings.get" => settings_get()?,
        "settings.set" => {
            settings_set(arg(a, "changes")?)?;
            Value::Null
        }

        "providers.list" => json!(providers::PROVIDERS),
        "providers.detect" => providers::detect(&arg::<String>(a, "email")?),

        "account.list" => json!(db::with(|c| db::accounts(c))?),
        "account.test" => account_test(a).await?,
        "account.save" => account_save(a).await?,
        "account.remove" => {
            account_remove(arg(a, "id")?)?;
            Value::Null
        }
        "oauth.start" => {
            oauth::start(
                &arg::<String>(a, "provider")?,
                &arg::<Option<String>>(a, "email")?.unwrap_or_default(),
            )
            .await?
        }
        "oauth.wait" => {
            oauth::wait(&arg::<String>(a, "flowId")?).await?;
            Value::Null
        }

        "folder.list" => json!(db::with(|c| db::folders(c, None))?),
        "folder.create" => {
            sync::create_folder(
                arg(a, "accountId")?,
                &arg::<String>(a, "name")?,
                arg(a, "parentId")?,
            )
            .await?;
            Value::Null
        }
        "folder.rename" => {
            sync::rename_folder(arg(a, "id")?, &arg::<String>(a, "name")?).await?;
            Value::Null
        }
        "folder.delete" => {
            sync::delete_folder(arg(a, "id")?).await?;
            Value::Null
        }

        "msg.list" => {
            let q: db::ListQuery = serde_json::from_value(args.clone())?;
            json!(db::with(|c| db::list_messages(c, &q))?)
        }
        "msg.get" => sync::detail(arg(a, "id")?).await?,
        "msg.source" => {
            let m = db::with(|c| db::message(c, arg(a, "id")?))?;
            json!(String::from_utf8_lossy(&sync::raw_message(&m).await?))
        }
        "msg.setFlags" => {
            sync::set_flags(&ids(a)?, arg(a, "seen")?, arg(a, "flagged")?).await?;
            Value::Null
        }
        "msg.move" => {
            sync::relocate(&ids(a)?, sync::Target::Folder(arg(a, "folderId")?)).await?;
            Value::Null
        }
        "msg.archive" => {
            sync::relocate(&ids(a)?, sync::Target::Role("archive")).await?;
            Value::Null
        }
        "msg.spam" => {
            let spam: bool = arg(a, "spam")?;
            sync::relocate(
                &ids(a)?,
                sync::Target::Role(if spam { "junk" } else { "inbox" }),
            )
            .await?;
            Value::Null
        }
        "msg.delete" => {
            sync::relocate(&ids(a)?, sync::Target::Delete).await?;
            Value::Null
        }
        "msg.loadOlder" => json!(sync::load_older(arg(a, "folderId")?).await?),

        "attachment.save" => {
            let path: String = arg(a, "path")?;
            let (_, data) = attachment_bytes(a).await?;
            std::fs::write(&path, data)?;
            Value::Null
        }
        "attachment.open" => attachment_open(a).await?,
        "attachment.describe" => json!(compose::describe_file(&arg::<String>(a, "path")?)?),

        "draft.list" => json!(compose::list_drafts()?),
        "draft.save" => json!(compose::save_draft(arg(a, "draft")?)?),
        "draft.delete" => {
            compose::delete_draft(arg(a, "id")?)?;
            Value::Null
        }
        "compose.send" => compose::send(arg(a, "draft")?).await?,

        "contacts.search" => {
            let q: String = arg(a, "query")?;
            json!(db::with(|c| db::search_contacts(c, q.trim(), 8))?)
        }

        "sync.run" => {
            match arg::<Option<i64>>(a, "accountId")? {
                Some(id) => {
                    tokio::spawn(sync::sync_account(id));
                }
                None => sync::sync_everything(),
            }
            Value::Null
        }
        "sync.status" => json!({ "syncing": sync::syncing() }),
        "events.poll" => events::poll(arg(a, "after")?, Duration::from_secs(25)).await,

        other => return Err(Error::invalid(format!("Unknown command {other:?}"))),
    })
}
