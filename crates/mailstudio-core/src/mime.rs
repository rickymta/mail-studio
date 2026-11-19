//! Reading messages: header extraction for the list, body/attachment extraction for the reader,
//! and HTML sanitizing. Everything here is pure (bytes in, data out).

use std::borrow::Cow;
use std::collections::HashSet;

use base64::Engine;
use mail_parser::{Address, HeaderValue, Message, MessageParser, MessagePart, MimeHeaders};
use serde::Serialize;

use crate::db::{Addr, NewMessage};

/// Inline images above this size stay attachments instead of being embedded in the HTML.
const MAX_INLINE_IMAGE: usize = 3 * 1024 * 1024;

fn addr_list(list: Option<&Address<'_>>) -> Vec<Addr> {
    let Some(list) = list else { return Vec::new() };
    list.iter()
        .filter_map(|m| {
            let email = m.address()?.trim();
            (!email.is_empty()).then(|| Addr {
                name: m.name().unwrap_or_default().trim().to_string(),
                email: email.to_string(),
            })
        })
        .collect()
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_mixed(m: &Message<'_>) -> bool {
    m.content_type().is_some_and(|c| {
        c.ctype().eq_ignore_ascii_case("multipart")
            && c.subtype().is_some_and(|s| s.eq_ignore_ascii_case("mixed"))
    })
}

fn id_list(v: &HeaderValue<'_>) -> Vec<String> {
    match v {
        HeaderValue::Text(t) => vec![t.to_string()],
        HeaderValue::TextList(l) => l.iter().map(|t| t.to_string()).collect(),
        _ => Vec::new(),
    }
}

/// Header fields of a message (works on a header block alone or on a whole message). The caller
/// fills in uid, flags and size.
pub fn parse_headers(raw: &[u8]) -> NewMessage {
    let Some(m) = MessageParser::default().parse(raw) else {
        return NewMessage::default();
    };
    NewMessage {
        message_id: m.message_id().unwrap_or_default().to_string(),
        in_reply_to: id_list(m.in_reply_to())
            .into_iter()
            .next()
            .unwrap_or_default(),
        refs: id_list(m.references()).join(" "),
        subject: one_line(m.subject().unwrap_or_default()),
        from: addr_list(m.from()).into_iter().next(),
        to: addr_list(m.to()),
        cc: addr_list(m.cc()),
        bcc: addr_list(m.bcc()),
        reply_to: addr_list(m.reply_to()),
        date: m.date().map(|d| d.to_timestamp()).unwrap_or(0),
        has_attachments: is_mixed(&m),
        ..NewMessage::default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    /// Position among the message's attachments; the handle for saving/opening it.
    pub index: usize,
    pub name: String,
    pub mime: String,
    pub size: usize,
    /// Shown inside the HTML body (so the reader hides it from the attachment strip).
    pub inline: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    /// Sanitized HTML, when the message has an HTML part.
    pub html: Option<String>,
    pub text: Option<String>,
    pub attachments: Vec<AttachmentInfo>,
    /// The HTML refers to images on the internet (blocked until the user allows them).
    pub has_remote_images: bool,
    pub snippet: String,
}

fn part_mime(part: &MessagePart<'_>) -> String {
    match part.content_type() {
        Some(c) => match c.subtype() {
            Some(sub) => format!("{}/{}", c.ctype(), sub).to_lowercase(),
            None => c.ctype().to_lowercase(),
        },
        None => "application/octet-stream".into(),
    }
}

fn part_name(part: &MessagePart<'_>, index: usize, mime: &str) -> String {
    if let Some(n) = part
        .attachment_name()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        return n.to_string();
    }
    let ext = match mime {
        "message/rfc822" => "eml",
        "text/calendar" => "ics",
        "text/plain" => "txt",
        "text/html" => "html",
        "application/pdf" => "pdf",
        m => m
            .rsplit('/')
            .next()
            .filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()))
            .unwrap_or("bin"),
    };
    format!("attachment-{}.{ext}", index + 1)
}

fn clean_cid(cid: &str) -> &str {
    cid.trim().trim_start_matches('<').trim_end_matches('>')
}

pub fn snippet_of(m: &Message<'_>) -> String {
    let s = one_line(&m.body_preview(240).unwrap_or_default());
    s.chars().take(200).collect()
}

/// `(snippet, has real attachments)` of a whole message, for the list.
pub fn summarize(raw: &[u8]) -> (String, bool) {
    let b = parse_body(raw);
    let has = b.attachments.iter().any(|a| !a.inline);
    (b.snippet, has)
}

/// Body and attachment list of a whole message.
pub fn parse_body(raw: &[u8]) -> Body {
    let Some(m) = MessageParser::default().parse(raw) else {
        return Body {
            text: Some(String::from_utf8_lossy(raw).into_owned()),
            ..Body::default()
        };
    };
    let has_html_part = m.html_bodies().any(MessagePart::is_text_html);
    let mut html = if has_html_part {
        m.body_html(0).map(Cow::into_owned)
    } else {
        None
    };
    let text = m.body_text(0).map(Cow::into_owned);

    let mut attachments = Vec::new();
    for (index, part) in m.attachments().enumerate() {
        let mime = part_mime(part);
        let mut inline = false;
        if let (Some(h), Some(cid)) = (html.as_mut(), part.content_id().map(clean_cid)) {
            let needle = format!("cid:{cid}");
            if !cid.is_empty() && mime.starts_with("image/") && h.contains(&needle) {
                let data = part.contents();
                if data.len() <= MAX_INLINE_IMAGE {
                    let uri = format!(
                        "data:{mime};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(data)
                    );
                    *h = h.replace(&needle, &uri);
                    inline = true;
                }
            }
        }
        attachments.push(AttachmentInfo {
            index,
            name: part_name(part, index, &mime),
            size: part.len(),
            mime,
            inline,
        });
    }
    let html = html.map(|h| sanitize_html(&h));
    let has_remote_images = html.as_deref().is_some_and(has_remote_content);
    Body {
        snippet: snippet_of(&m),
        html,
        text,
        attachments,
        has_remote_images,
    }
}

/// One attachment's `(file name, mime type, bytes)`.
pub fn attachment(raw: &[u8], index: usize) -> Option<(String, String, Vec<u8>)> {
    let m = MessageParser::default().parse(raw)?;
    let part = m.attachments().nth(index)?;
    let mime = part_mime(part);
    Some((
        part_name(part, index, &mime),
        mime,
        part.contents().to_vec(),
    ))
}

fn has_remote_content(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    [
        "src=\"http",
        "src='http",
        "url(http",
        "url(\"http",
        "url('http",
        "background=\"http",
        "src=\"//",
    ]
    .iter()
    .any(|n| lower.contains(n))
}

/// Strip everything active from a message's HTML: scripts, event handlers, forms, frames,
/// objects and unknown URL schemes. Styling survives, because mail is laid out with inline
/// styles and `<style>` blocks; the reader shows the result in a sandboxed frame whose own
/// content-security policy decides whether remote images load.
pub fn sanitize_html(html: &str) -> String {
    let mut b = ammonia::Builder::default();
    b.rm_clean_content_tags(["style"]);
    b.add_tags(["style", "font", "center"]);
    b.add_generic_attributes([
        "style",
        "class",
        "id",
        "align",
        "valign",
        "bgcolor",
        "width",
        "height",
        "border",
        "cellpadding",
        "cellspacing",
        "color",
        "face",
        "size",
        "dir",
    ]);
    b.url_schemes(HashSet::from([
        "http", "https", "mailto", "tel", "data", "cid",
    ]));
    b.link_rel(Some("noopener noreferrer"));
    b.attribute_filter(|element, attribute, value| {
        let v = value.trim_start().to_ascii_lowercase();
        let keep = match (element, attribute) {
            // `data:` is for embedded images only, never for something a click navigates to.
            ("img", "src") => !v.starts_with("data:") || v.starts_with("data:image/"),
            (_, "href" | "src" | "cite") => !v.starts_with("data:"),
            _ => true,
        };
        keep.then_some(Cow::Borrowed(value))
    });
    b.clean(html).to_string()
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Plain-text alternative of a composed HTML body.
pub fn html_to_text(html: &str) -> String {
    mail_parser::decoders::html::html_to_text(html)
        .trim_end()
        .to_string()
}

/// Minimal HTML for a plain-text body (used when quoting a text-only message).
pub fn text_to_html(text: &str) -> String {
    escape(text).replace("\r\n", "\n").replace('\n', "<br>")
}

/// A file name that is safe to create inside a directory we chose.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "attachment".into()
    } else {
        cleaned.chars().take(120).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIXED: &str = concat!(
        "From: =?utf-8?B?Tmfhu41j?= <ngoc@example.com>\r\n",
        "To: A <a@example.com>, b@example.com\r\n",
        "Cc: c@example.com\r\n",
        "Subject: =?utf-8?Q?B=C3=A1o_c=C3=A1o?=\r\n   th\u{e1}ng\r\n",
        "Message-ID: <m1@example.com>\r\n",
        "In-Reply-To: <m0@example.com>\r\n",
        "References: <a@x> <m0@example.com>\r\n",
        "Date: Sat, 20 Nov 2021 14:22:01 +0000\r\n",
        "MIME-Version: 1.0\r\n",
        "Content-Type: multipart/mixed; boundary=\"mix\"\r\n",
        "\r\n",
        "--mix\r\n",
        "Content-Type: multipart/related; boundary=\"rel\"\r\n",
        "\r\n",
        "--rel\r\n",
        "Content-Type: text/html; charset=utf-8\r\n",
        "\r\n",
        "<p onclick=\"evil()\">Hello <b>there</b><script>alert(1)</script>",
        "<img src=\"cid:logo@x\"><img src=\"https://tracker.example/p.gif\">",
        "<a href=\"javascript:alert(1)\"> link</a></p>\r\n",
        "--rel\r\n",
        "Content-Type: image/png\r\n",
        "Content-ID: <logo@x>\r\n",
        "Content-Disposition: inline\r\n",
        "Content-Transfer-Encoding: base64\r\n",
        "\r\n",
        "iVBORw0KGgo=\r\n",
        "--rel--\r\n",
        "--mix\r\n",
        "Content-Type: application/pdf; name=\"report.pdf\"\r\n",
        "Content-Disposition: attachment; filename=\"report.pdf\"\r\n",
        "Content-Transfer-Encoding: base64\r\n",
        "\r\n",
        "JVBERi0xLjQ=\r\n",
        "--mix--\r\n",
    );

    #[test]
    fn headers_are_decoded() {
        let h = parse_headers(MIXED.as_bytes());
        assert_eq!(
            h.from,
            Some(Addr {
                name: "Ngọc".into(),
                email: "ngoc@example.com".into()
            })
        );
        assert_eq!(h.to.len(), 2);
        assert_eq!(
            h.to[0],
            Addr {
                name: "A".into(),
                email: "a@example.com".into()
            }
        );
        assert_eq!(h.cc[0].email, "c@example.com");
        assert_eq!(h.subject, "Báo cáo tháng");
        assert_eq!(h.message_id, "m1@example.com");
        assert_eq!(h.in_reply_to, "m0@example.com");
        assert_eq!(h.refs, "a@x m0@example.com");
        assert_eq!(h.date, 1_637_418_121);
        assert!(h.has_attachments);
    }

    #[test]
    fn body_is_sanitized_and_inline_images_embedded() {
        let b = parse_body(MIXED.as_bytes());
        let html = b.html.expect("html body");
        assert!(html.contains("<b>there</b>"));
        assert!(!html.contains("script"), "{html}");
        assert!(!html.contains("onclick"), "{html}");
        assert!(!html.contains("javascript:"), "{html}");
        assert!(
            html.contains("src=\"data:image/png;base64,iVBORw0KGgo=\""),
            "{html}"
        );
        assert!(b.has_remote_images);
        assert_eq!(b.attachments.len(), 2);
        assert!(b.attachments[0].inline);
        assert_eq!(b.attachments[1].name, "report.pdf");
        assert_eq!(b.attachments[1].mime, "application/pdf");
        assert!(!b.attachments[1].inline);
        assert_eq!(b.snippet, "Hello there link");
        let (name, mime, data) = attachment(MIXED.as_bytes(), 1).expect("pdf");
        assert_eq!(
            (name.as_str(), mime.as_str(), data.as_slice()),
            ("report.pdf", "application/pdf", &b"%PDF-1.4"[..])
        );
        assert_eq!(
            summarize(MIXED.as_bytes()),
            ("Hello there link".to_string(), true)
        );
    }

    #[test]
    fn plain_text_message_has_no_html() {
        let raw = b"From: a@b.c\r\nSubject: Hi\r\n\r\nLine one\r\nLine two\r\n";
        let b = parse_body(raw);
        assert!(b.html.is_none());
        assert_eq!(
            b.text.as_deref().map(str::trim),
            Some("Line one\r\nLine two")
        );
        assert!(!b.has_remote_images);
        assert!(!parse_headers(raw).has_attachments);
    }

    #[test]
    fn sanitizer_keeps_layout_but_drops_data_links() {
        let out = sanitize_html(
            "<style>p{color:red}</style><table bgcolor=\"#fff\" width=\"600\"><tr><td style=\"padding:4px\">x</td></tr></table>\
             <a href=\"data:text/html,boom\">a</a><iframe src=\"https://x\"></iframe><form action=\"/x\"><input></form>",
        );
        assert!(out.contains("<style>p{color:red}</style>"), "{out}");
        assert!(out.contains("bgcolor=\"#fff\""), "{out}");
        assert!(out.contains("style=\"padding:4px\""), "{out}");
        assert!(!out.contains("data:text/html"), "{out}");
        assert!(
            !out.contains("iframe") && !out.contains("<form") && !out.contains("<input"),
            "{out}"
        );
    }

    #[test]
    fn file_names_cannot_escape() {
        assert_eq!(safe_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_file_name("  ..  "), "attachment");
        assert_eq!(safe_file_name("a:b?.pdf"), "a_b_.pdf");
    }

    #[test]
    fn text_html_round_trip() {
        assert_eq!(text_to_html("a <b>\nc"), "a &lt;b&gt;<br>c");
        assert_eq!(html_to_text("<p>Hello</p><p>World</p>"), "Hello\nWorld");
    }
}
