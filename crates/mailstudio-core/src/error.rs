use serde::Serialize;

/// Every failure the UI can see. Serialized as `{ kind, message }`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The mail server refused the login (wrong password, app password needed, OAuth expired).
    #[error("{0}")]
    Auth(String),
    /// The IMAP server answered with an error.
    #[error("{0}")]
    Imap(String),
    /// The SMTP server answered with an error.
    #[error("{0}")]
    Smtp(String),
    /// A server could not be reached (DNS, TCP, TLS, timeout).
    #[error("{0}")]
    Network(String),
    /// The caller sent arguments that make no sense.
    #[error("{0}")]
    Invalid(String),
    /// Something the caller asked for does not exist (any more).
    #[error("{0}")]
    NotFound(String),
    /// The OS credential store failed.
    #[error("The OS credential store is unavailable: {0}")]
    Keyring(String),
    /// The local database failed.
    #[error("Local database error: {0}")]
    Db(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Auth(_) => "auth",
            Error::Imap(_) => "imap",
            Error::Smtp(_) => "smtp",
            Error::Network(_) => "network",
            Error::Invalid(_) => "invalid",
            Error::NotFound(_) => "not_found",
            Error::Keyring(_) => "keyring",
            Error::Db(_) => "db",
            Error::Io(_) => "io",
        }
    }

    pub fn invalid(msg: impl Into<String>) -> Self {
        Error::Invalid(msg.into())
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Invalid(e.to_string())
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Db(e.to_string())
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Network(e.to_string())
    }
}

impl From<async_imap::error::Error> for Error {
    fn from(e: async_imap::error::Error) -> Self {
        use async_imap::error::Error as E;
        match e {
            E::Io(e) => Error::Network(e.to_string()),
            E::ConnectionLost => {
                Error::Network("The connection to the mail server was lost".into())
            }
            E::No(m) | E::Bad(m) => Error::Imap(server_text(&m)),
            other => Error::Imap(other.to_string()),
        }
    }
}

/// What the server actually said. async-imap hands refusals over as debug output
/// (`code: None, info: Some("Basic authentication is disabled.")`); only the sentence
/// inside is meant for people.
pub fn server_text(raw: &str) -> String {
    let said = raw
        .split_once("info: Some(\"")
        .and_then(|(_, rest)| rest.rsplit_once("\")"))
        .map(|(text, _)| text.replace("\\\"", "\"").replace("\\\\", "\\"));
    match said {
        Some(text) if !text.trim().is_empty() => text.trim().to_string(),
        _ if raw.contains("info: None") => "the server gave no reason".to_string(),
        _ => raw.trim().to_string(),
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::server_text;

    #[test]
    fn keeps_only_what_the_server_said() {
        assert_eq!(
            server_text("code: None, info: Some(\"Basic authentication is disabled.\")"),
            "Basic authentication is disabled."
        );
        assert_eq!(
            server_text("code: Some(AuthenticationFailed), info: Some(\"Invalid \\\"creds\\\"\")"),
            "Invalid \"creds\""
        );
        assert_eq!(
            server_text("code: None, info: None"),
            "the server gave no reason"
        );
        assert_eq!(server_text("LOGIN failed"), "LOGIN failed");
    }
}
