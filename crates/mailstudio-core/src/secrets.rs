//! Passwords and OAuth refresh tokens live in the OS credential store (Windows Credential
//! Manager, macOS Keychain, Secret Service on Linux), never in the database.
//!
//! `MAILSTUDIO_SECRETS=file` keeps them in the database instead. That is for development against
//! the local test mail server and for headless test machines without a credential store only.

use crate::db;
use crate::error::{Error, Result};

fn in_file() -> bool {
    std::env::var("MAILSTUDIO_SECRETS").as_deref() == Ok("file")
}

fn entry(name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(db::APP_ID, name).map_err(|e| Error::Keyring(e.to_string()))
}

pub fn get(name: &str) -> Result<Option<String>> {
    if in_file() {
        return db::with(|c| db::kv_get(c, &format!("secret:{name}")));
    }
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

pub fn set(name: &str, value: &str) -> Result<()> {
    if in_file() {
        return db::with(|c| db::kv_set(c, &format!("secret:{name}"), Some(value)));
    }
    entry(name)?
        .set_password(value)
        .map_err(|e| Error::Keyring(e.to_string()))
}

pub fn delete(name: &str) -> Result<()> {
    if in_file() {
        return db::with(|c| db::kv_set(c, &format!("secret:{name}"), None));
    }
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

pub fn password_key(account_id: i64) -> String {
    format!("account:{account_id}:password")
}

pub fn refresh_key(account_id: i64) -> String {
    format!("account:{account_id}:refresh-token")
}

pub fn client_secret_key(provider: &str) -> String {
    format!("oauth:{provider}:client-secret")
}
