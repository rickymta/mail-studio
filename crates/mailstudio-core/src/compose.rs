//! Writing mail: local drafts, building the MIME message and sending it over SMTP.

use std::time::Duration;

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::db::{self, Account, Addr};
use crate::error::{Error, Result};
use crate::imap::{self, Credential};
use crate::{events, mime, providers, sync};

/// Most providers refuse messages above 25 MB; base64 adds a third on top of the file sizes.
const MAX_ATTACHMENTS: u64 = 18 * 1024 * 1024;
const SMTP_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DraftAttachment {
    /// A file on disk.
    #[serde(rename_all = "camelCase")]
    File {
        path: String,
        name: String,
        size: u64,
    },
    /// An attachment of a stored message (forwarding).
    #[serde(rename_all = "camelCase")]
    Message {
        message_id: i64,
        index: usize,
        name: String,
        size: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    #[serde(default)]
    pub id: i64,
    pub account_id: i64,
    #[serde(default)]
    pub to: Vec<Addr>,
    #[serde(default)]
    pub cc: Vec<Addr>,
    #[serde(default)]
    pub bcc: Vec<Addr>,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub html: String,
    /// The quoted original (reply/forward), appended after `html` when sending.
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub attachments: Vec<DraftAttachment>,
    /// Message-ID being answered (without angle brackets).
    #[serde(default)]
    pub in_reply_to: String,
    /// Space-separated Message-IDs of the thread so far.
    #[serde(default)]
    pub references: String,
    /// Local id of the message being answered, to flag it as answered after sending.
    #[serde(default)]
    pub reply_to_message: Option<i64>,
    #[serde(default)]
    pub updated_at: i64,
}

// ---- drafts -------------------------------------------------------------------------------------

pub fn list_drafts() -> Result<Vec<Draft>> {
    let rows = db::with(|c| db::drafts(c))?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, data, updated_at)| {
            let mut d: Draft = serde_json::from_str(&data).ok()?;
            d.id = id;
            d.updated_at = updated_at;
            Some(d)
        })
        .collect())
}

pub fn save_draft(mut draft: Draft) -> Result<Draft> {
    let data = serde_json::to_string(&draft)?;
    draft.id = db::with(|c| db::save_draft(c, draft.id, &data))?;
    draft.updated_at = db::now();
    events::emit("drafts", json!({}));
    Ok(draft)
}

pub fn delete_draft(id: i64) -> Result<()> {
    db::with(|c| db::delete_draft(c, id))?;
    events::emit("drafts", json!({}));
    Ok(())
}

/// Size and name of a file the user picked as an attachment.
pub fn describe_file(path: &str) -> Result<DraftAttachment> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(Error::invalid(format!("{path} is not a file")));
    }
    let name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "attachment".into());
    Ok(DraftAttachment::File {
        path: path.to_string(),
        name,
        size: meta.len(),
    })
}

// ---- building -----------------------------------------------------------------------------------

fn mailbox(a: &Addr) -> Result<Mailbox> {
    let email = a.email.trim();
    let address = email
        .parse()
        .map_err(|_| Error::invalid(format!("{email:?} is not a valid e-mail address")))?;
    let name = a.name.trim();
    Ok(Mailbox::new(
        (!name.is_empty()).then(|| name.to_string()),
        address,
    ))
}

fn guess_mime(name: &str) -> &'static str {
    let ext = name
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        "xml" => "application/xml",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "eml" => "message/rfc822",
        "ics" => "text/calendar",
        _ => "application/octet-stream",
    }
}

fn content_type(mime: &str) -> ContentType {
    ContentType::parse(mime)
        .unwrap_or_else(|_| ContentType::parse("application/octet-stream").expect("valid mime"))
}

/// `(name, mime, bytes)` of every attachment of a draft.
fn load_attachments(draft: &Draft) -> Result<Vec<(String, String, Vec<u8>)>> {
    let mut out = Vec::new();
    let mut total = 0u64;
    for a in &draft.attachments {
        let item = match a {
            DraftAttachment::File { path, name, .. } => {
                let data = std::fs::read(path).map_err(|e| {
                    Error::invalid(format!("Could not read the attachment {name}: {e}"))
                })?;
                (name.clone(), guess_mime(name).to_string(), data)
            }
            DraftAttachment::Message {
                message_id,
                index,
                name,
                ..
            } => {
                let raw = db::with(|c| db::raw_body(c, *message_id))?.ok_or_else(|| {
                    Error::NotFound(format!(
                        "The original message of {name} is no longer available"
                    ))
                })?;
                mime::attachment(&raw, *index).ok_or_else(|| {
                    Error::NotFound(format!("The attachment {name} is no longer available"))
                })?
            }
        };
        total += item.2.len() as u64;
        if total > MAX_ATTACHMENTS {
            return Err(Error::invalid(format!(
                "The attachments are larger than {} MB in total; mail servers will refuse the message.",
                MAX_ATTACHMENTS / 1024 / 1024
            )));
        }
        out.push(item);
    }
    Ok(out)
}

fn bracket(id: &str) -> String {
    let id = id.trim().trim_start_matches('<').trim_end_matches('>');
    format!("<{id}>")
}

/// Build the MIME message of a draft.
pub fn build(account: &Account, draft: &Draft) -> Result<Message> {
    if draft.to.is_empty() && draft.cc.is_empty() && draft.bcc.is_empty() {
        return Err(Error::invalid("Add at least one recipient"));
    }
    let from = mailbox(&Addr {
        name: account.name.clone(),
        email: account.email.clone(),
    })?;
    let domain = account.email.rsplit('@').next().unwrap_or("localhost");
    let mut b = Message::builder()
        .from(from)
        .subject(draft.subject.trim())
        .message_id(Some(format!("<{}@{domain}>", uuid::Uuid::new_v4())))
        .user_agent(format!("MailStudio/{}", env!("CARGO_PKG_VERSION")));
    for a in &draft.to {
        b = b.to(mailbox(a)?);
    }
    for a in &draft.cc {
        b = b.cc(mailbox(a)?);
    }
    for a in &draft.bcc {
        b = b.bcc(mailbox(a)?);
    }
    if !draft.in_reply_to.trim().is_empty() {
        b = b.in_reply_to(bracket(&draft.in_reply_to));
    }
    let refs: Vec<String> = draft.references.split_whitespace().map(bracket).collect();
    if !refs.is_empty() {
        b = b.references(refs.join(" "));
    }
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>{}{}</body></html>",
        draft.html, draft.quote
    );
    let body = MultiPart::alternative_plain_html(
        mime::html_to_text(&format!("{}{}", draft.html, draft.quote)),
        html,
    );
    let attachments = load_attachments(draft)?;
    let message = if attachments.is_empty() {
        b.multipart(body)
    } else {
        let mut mixed = MultiPart::mixed().multipart(body);
        for (name, mime, data) in attachments {
            mixed = mixed.singlepart(Attachment::new(name).body(data, content_type(&mime)));
        }
        b.multipart(mixed)
    };
    message.map_err(|e| Error::invalid(format!("The message could not be built: {e}")))
}

// ---- sending ------------------------------------------------------------------------------------

fn smtp_error(host: &str, e: lettre::transport::smtp::Error) -> Error {
    let text = e.to_string();
    if e.is_permanent() && (text.contains("535") || text.to_lowercase().contains("auth")) {
        Error::Auth(format!("{host} refused the sign-in: {text}"))
    } else if e.is_permanent() || e.is_transient() {
        Error::Smtp(format!("{host} refused the message: {text}"))
    } else {
        // lettre reports the cause (DNS, TLS, timeout) only through `source()`.
        let cause = std::error::Error::source(&e)
            .map(|s| format!(": {s}"))
            .unwrap_or_default();
        Error::Network(format!("Could not send through {host}: {text}{cause}"))
    }
}

pub fn transport(
    account: &Account,
    cred: &Credential,
) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
    let host = account.smtp_host.trim();
    if host.is_empty() {
        return Err(Error::invalid("The SMTP server is missing"));
    }
    let tls = || {
        TlsParameters::new(host.to_string())
            .map_err(|e| Error::Network(format!("TLS setup failed: {e}")))
    };
    let builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
        .port(account.smtp_port)
        .timeout(Some(SMTP_TIMEOUT))
        .tls(match account.smtp_security.as_str() {
            "tls" => Tls::Wrapper(tls()?),
            "starttls" => Tls::Required(tls()?),
            "none" => Tls::None,
            other => {
                return Err(Error::invalid(format!(
                    "Unknown connection security {other:?}"
                )));
            }
        });
    let user = account.username.trim().to_string();
    Ok(match cred {
        Credential::Password(p) if p.is_empty() && account.smtp_security == "none" => builder,
        Credential::Password(p) => builder.credentials(Credentials::new(user, p.clone())),
        Credential::OAuth(token) => builder
            .credentials(Credentials::new(user, token.clone()))
            .authentication(vec![Mechanism::Xoauth2]),
    }
    .build())
}

/// Check that the SMTP server accepts the connection and the credential.
pub async fn test_smtp(account: &Account, cred: &Credential) -> Result<()> {
    let t = transport(account, cred)?;
    match t.test_connection().await {
        Ok(true) => Ok(()),
        Ok(false) => Err(Error::Network(format!(
            "{} did not accept the connection",
            account.smtp_host
        ))),
        Err(e) => Err(smtp_error(&account.smtp_host, e)),
    }
}

/// Send a draft. Returns warnings about follow-up steps that failed after the message went out
/// (it was sent, so those must not look like a send failure).
pub async fn send(draft: Draft) -> Result<Value> {
    let account = db::with(|c| db::account(c, draft.account_id))?;
    let message = build(&account, &draft)?;
    let cred = imap::credential(&account).await?;
    let transport = transport(&account, &cred)?;
    transport
        .send(message.clone())
        .await
        .map_err(|e| smtp_error(&account.smtp_host, e))?;

    let mut warnings: Vec<String> = Vec::new();
    if draft.id != 0 {
        let _ = delete_draft(draft.id);
    }
    let people: Vec<Addr> = draft
        .to
        .iter()
        .chain(&draft.cc)
        .chain(&draft.bcc)
        .cloned()
        .collect();
    let _ = db::with(|c| db::touch_contacts(c, &people, 3));

    // File a copy in Sent, unless the provider does that itself.
    let saves_sent = providers::by_id(&account.provider).is_some_and(|p| p.saves_sent);
    let sent = db::with(|c| db::folder_by_role(c, account.id, "sent"))?;
    let answered = match draft.reply_to_message {
        Some(id) => db::with(|c| db::message(c, id)).ok(),
        None => None,
    };
    let answered_folder = match &answered {
        Some(m) => db::with(|c| db::folder(c, m.summary.folder_id)).ok(),
        None => None,
    };
    let raw = message.formatted();
    let followup = file_sent(
        &account,
        sent.as_ref(),
        answered.as_ref().zip(answered_folder.as_ref()),
        (!saves_sent).then_some(&raw),
    )
    .await;
    if let Err(e) = followup {
        warnings.push(format!(
            "The message was sent, but updating the mailbox failed: {e}"
        ));
    }
    events::emit("folders", json!({ "accountId": account.id }));
    Ok(json!({ "warnings": warnings }))
}

/// After a send: flag the answered message, upload the copy for Sent (when the provider does not
/// file one itself) and refresh that folder.
async fn file_sent(
    account: &Account,
    sent: Option<&db::Folder>,
    answered: Option<(&db::Stored, &db::Folder)>,
    copy: Option<&Vec<u8>>,
) -> Result<()> {
    with_session!(account, Duration::from_secs(120), |s| {
        if let Some((m, f)) = answered {
            s.select(&f.path).await?;
            imap::store(s, &[m.summary.uid], "+FLAGS.SILENT (\\Answered)").await?;
            db::with(|c| db::set_answered(c, m.summary.id))?;
            events::emit(
                "messages",
                json!({ "accountId": account.id, "folderId": f.id }),
            );
        }
        if let Some(f) = sent {
            if let Some(raw) = copy {
                s.append(&f.path, Some("(\\Seen)"), None, raw).await?;
            }
            sync::sync_folder(s, account, f).await?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account() -> Account {
        serde_json::from_value(json!({
            "email": "me@example.com", "name": "Mé Tester", "provider": "custom",
            "imapHost": "imap.example.com", "imapPort": 993, "imapSecurity": "tls",
            "smtpHost": "smtp.example.com", "smtpPort": 465, "smtpSecurity": "tls",
            "username": "me@example.com"
        }))
        .unwrap()
    }

    fn draft(extra: Value) -> Draft {
        let mut v = json!({
            "accountId": 1,
            "to": [{ "name": "Ann", "email": "ann@example.org" }],
            "bcc": [{ "email": "hidden@example.org" }],
            "subject": "Xin chào",
            "html": "<p>Hello <b>Ann</b></p>"
        });
        v.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn builds_alternative_message_with_threading_headers() {
        let d = draft(json!({ "inReplyTo": "<a@x>", "references": "r1@x <a@x>" }));
        let m = build(&account(), &d).unwrap();
        let raw = String::from_utf8(m.formatted()).unwrap();
        assert!(raw.contains("In-Reply-To: <a@x>"), "{raw}");
        assert!(raw.contains("References: <r1@x> <a@x>"), "{raw}");
        assert!(raw.contains("multipart/alternative"), "{raw}");
        assert!(raw.contains("To: Ann <ann@example.org>"), "{raw}");
        assert!(
            !raw.contains("hidden@example.org"),
            "Bcc must not be written into the message"
        );
        assert!(
            m.envelope()
                .to()
                .iter()
                .any(|a| a.to_string() == "hidden@example.org")
        );
        let parsed = mime::parse_body(raw.as_bytes());
        assert_eq!(parsed.text.as_deref().map(str::trim), Some("Hello Ann"));
        assert!(parsed.html.unwrap().contains("<b>Ann</b>"));
        assert_eq!(mime::parse_headers(raw.as_bytes()).subject, "Xin chào");
    }

    #[test]
    fn attaches_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("báo cáo.pdf");
        std::fs::write(&path, b"%PDF-1.4 test").unwrap();
        let att = describe_file(path.to_str().unwrap()).unwrap();
        let mut d = draft(json!({}));
        d.attachments.push(att);
        let raw = build(&account(), &d).unwrap().formatted();
        let parsed = mime::parse_body(&raw);
        assert_eq!(parsed.attachments.len(), 1);
        assert_eq!(parsed.attachments[0].name, "báo cáo.pdf");
        assert_eq!(parsed.attachments[0].mime, "application/pdf");
        assert_eq!(mime::attachment(&raw, 0).unwrap().2, b"%PDF-1.4 test");
    }

    #[test]
    fn rejects_missing_or_bad_recipients() {
        let mut d = draft(json!({}));
        d.to.clear();
        d.bcc.clear();
        assert!(matches!(build(&account(), &d), Err(Error::Invalid(_))));
        let d = draft(json!({ "to": [{ "email": "not an address" }] }));
        assert!(matches!(build(&account(), &d), Err(Error::Invalid(_))));
    }
}
