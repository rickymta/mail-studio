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
            E::No(m) | E::Bad(m) => Error::Imap(m),
            other => Error::Imap(other.to_string()),
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
