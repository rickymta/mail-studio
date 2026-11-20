//! Known mail providers: server settings, how they authenticate, and what the user must do
//! first (app passwords, enabling IMAP).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    /// Mail domains that belong to this provider.
    pub domains: &'static [&'static str],
    pub imap_host: &'static str,
    pub imap_port: u16,
    pub imap_security: &'static str,
    pub smtp_host: &'static str,
    pub smtp_port: u16,
    pub smtp_security: &'static str,
    /// `google` / `microsoft` when the provider offers OAuth sign-in, else ``.
    pub oauth: &'static str,
    /// The provider no longer accepts any password over IMAP / SMTP: OAuth is the only way in.
    pub oauth_only: bool,
    /// The provider refuses the normal account password over IMAP.
    pub password_is_app_password: bool,
    /// Where the user creates an app password or enables IMAP.
    pub help_url: &'static str,
    /// The provider files sent mail itself, so the client must not upload a second copy.
    pub saves_sent: bool,
}

const fn p(
    id: &'static str,
    name: &'static str,
    domains: &'static [&'static str],
    imap_host: &'static str,
    smtp_host: &'static str,
    smtp_port: u16,
) -> Provider {
    Provider {
        id,
        name,
        domains,
        imap_host,
        imap_port: 993,
        imap_security: "tls",
        smtp_host,
        smtp_port,
        smtp_security: if smtp_port == 465 { "tls" } else { "starttls" },
        oauth: "",
        oauth_only: false,
        password_is_app_password: true,
        help_url: "",
        saves_sent: false,
    }
}

pub const PROVIDERS: &[Provider] = &[
    Provider {
        oauth: "google",
        help_url: "https://myaccount.google.com/apppasswords",
        saves_sent: true,
        ..p(
            "gmail",
            "Gmail",
            &["gmail.com", "googlemail.com"],
            "imap.gmail.com",
            "smtp.gmail.com",
            465,
        )
    },
    Provider {
        oauth: "microsoft",
        oauth_only: true,
        help_url: "https://support.microsoft.com/account-billing/5896ed9b-4263-e681-128a-a6f2979a7944",
        saves_sent: true,
        ..p(
            "outlook",
            "Outlook / Microsoft 365",
            &[
                "outlook.com",
                "hotmail.com",
                "live.com",
                "msn.com",
                "outlook.com.vn",
            ],
            "outlook.office365.com",
            "smtp.office365.com",
            587,
        )
    },
    Provider {
        help_url: "https://login.yahoo.com/account/security",
        ..p(
            "yahoo",
            "Yahoo Mail",
            &["yahoo.com", "yahoo.com.vn", "ymail.com", "rocketmail.com"],
            "imap.mail.yahoo.com",
            "smtp.mail.yahoo.com",
            465,
        )
    },
    Provider {
        help_url: "https://account.apple.com/account/manage",
        ..p(
            "icloud",
            "iCloud Mail",
            &["icloud.com", "me.com", "mac.com"],
            "imap.mail.me.com",
            "smtp.mail.me.com",
            587,
        )
    },
    Provider {
        help_url: "https://accounts.zoho.com/home#security/app_password",
        ..p(
            "zoho",
            "Zoho Mail",
            &["zoho.com", "zohomail.com"],
            "imap.zoho.com",
            "smtp.zoho.com",
            465,
        )
    },
    Provider {
        help_url: "https://id.yandex.com/security/app-passwords",
        ..p(
            "yandex",
            "Yandex Mail",
            &["yandex.com", "yandex.ru", "ya.ru"],
            "imap.yandex.com",
            "smtp.yandex.com",
            465,
        )
    },
    Provider {
        help_url: "https://app.fastmail.com/settings/security/apps",
        ..p(
            "fastmail",
            "Fastmail",
            &["fastmail.com", "fastmail.fm"],
            "imap.fastmail.com",
            "smtp.fastmail.com",
            465,
        )
    },
    Provider {
        help_url: "https://login.aol.com/account/security",
        ..p(
            "aol",
            "AOL Mail",
            &["aol.com"],
            "imap.aol.com",
            "smtp.aol.com",
            465,
        )
    },
    Provider {
        password_is_app_password: false,
        ..p(
            "gmx",
            "GMX",
            &["gmx.com", "gmx.net", "gmx.de"],
            "imap.gmx.com",
            "mail.gmx.com",
            587,
        )
    },
    Provider {
        password_is_app_password: false,
        ..p(
            "mailru",
            "Mail.ru",
            &["mail.ru", "inbox.ru", "list.ru", "bk.ru"],
            "imap.mail.ru",
            "smtp.mail.ru",
            465,
        )
    },
    Provider {
        password_is_app_password: false,
        ..p("custom", "Other (IMAP / SMTP)", &[], "", "", 465)
    },
];

pub fn by_id(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/// Guess the settings for an address: a known provider, or `imap.<domain>` / `smtp.<domain>`.
pub fn detect(email: &str) -> serde_json::Value {
    let domain = email
        .rsplit('@')
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if let Some(found) = PROVIDERS
        .iter()
        .find(|p| p.domains.contains(&domain.as_str()))
    {
        return serde_json::json!(found);
    }
    let mut custom = serde_json::json!(by_id("custom").expect("custom preset exists"));
    if !domain.is_empty() && email.contains('@') {
        custom["imapHost"] = format!("imap.{domain}").into();
        custom["smtpHost"] = format!("smtp.{domain}").into();
    }
    custom
}

/// One server out of a Thunderbird-style autoconfig document.
#[derive(Debug, PartialEq)]
struct Endpoint {
    host: String,
    port: u16,
    security: &'static str,
}

fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let start = xml.find(&format!("<{name}>"))? + name.len() + 2;
    let end = start + xml[start..].find(&format!("</{name}>"))?;
    Some(xml[start..end].trim())
}

/// The first `<incomingServer type="imap">` / `<outgoingServer type="smtp">` block.
fn endpoint(xml: &str, element: &str, kind: &str) -> Option<Endpoint> {
    let close = format!("</{element}>");
    let mut rest = xml;
    loop {
        let start = rest.find(&format!("<{element}"))?;
        let block = &rest[start..];
        let end = block.find(&close)?;
        let (block, after) = block.split_at(end);
        rest = &after[close.len()..];
        let head = &block[..block.find('>')?];
        if !head
            .replace('\'', "\"")
            .contains(&format!("type=\"{kind}\""))
        {
            continue;
        }
        let host = tag(block, "hostname")?.to_lowercase();
        let port = tag(block, "port")?.parse().ok()?;
        let security = match tag(block, "socketType")?.to_ascii_uppercase().as_str() {
            "SSL" => "tls",
            "STARTTLS" => "starttls",
            _ => "none",
        };
        let valid = !host.is_empty()
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
        return valid.then_some(Endpoint {
            host,
            port,
            security,
        });
    }
}

fn parse_autoconfig(xml: &str) -> Option<(Endpoint, Endpoint)> {
    Some((
        endpoint(xml, "incomingServer", "imap")?,
        endpoint(xml, "outgoingServer", "smtp")?,
    ))
}

async fn fetch_autoconfig(client: &reqwest::Client, url: String) -> Option<(Endpoint, Endpoint)> {
    let res = client.get(url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    parse_autoconfig(&res.text().await.ok()?)
}

async fn resolves(host: String) -> Option<String> {
    let found = tokio::net::lookup_host((host.as_str(), 0))
        .await
        .ok()?
        .next();
    found.map(|_| host)
}

async fn first_resolving(hosts: [String; 2]) -> Option<String> {
    let [a, b] = hosts;
    let (a, b) = tokio::join!(resolves(a), resolves(b));
    a.or(b)
}

/// Mail-exchanger suffixes that give away who hosts a domain's mailboxes.
const MX_HOSTS: &[(&str, &str)] = &[
    ("mail.protection.outlook.com", "outlook"),
    ("olc.protection.outlook.com", "outlook"),
    ("google.com", "gmail"),
    ("googlemail.com", "gmail"),
    ("zoho.com", "zoho"),
    ("yandex.net", "yandex"),
    ("yandex.ru", "yandex"),
    ("messagingengine.com", "fastmail"),
    ("yahoodns.net", "yahoo"),
    ("mail.icloud.com", "icloud"),
    ("mail.ru", "mailru"),
];

/// The preset of the provider that runs the mail exchanger `host`.
fn by_mx(host: &str) -> Option<&'static Provider> {
    let host = host.trim_end_matches('.').to_lowercase();
    MX_HOSTS
        .iter()
        .find(|(suffix, _)| host == *suffix || host.ends_with(&format!(".{suffix}")))
        .and_then(|(_, id)| by_id(id))
}

/// Pick the preferred exchanger out of MX records printed in zone-file form
/// (`name ttl class MX preference exchange`).
fn preferred_mx<'a>(records: impl Iterator<Item = &'a str>) -> Option<String> {
    records
        .filter_map(|line| {
            let mut tail = line.split_whitespace().rev();
            let host = tail.next()?;
            let preference: u16 = tail.next()?.parse().ok()?;
            Some((preference, host.to_string()))
        })
        .min()
        .map(|(_, host)| host)
}

/// The domain's most preferred mail exchanger, from DNS.
async fn primary_mx(domain: &str) -> Option<String> {
    let resolver = hickory_resolver::Resolver::builder_tokio()
        .ok()?
        .build()
        .ok()?;
    let lookup = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        resolver.mx_lookup(format!("{domain}.")),
    )
    .await
    .ok()?
    .ok()?;
    let lines: Vec<String> = lookup
        .answers()
        .iter()
        .filter(|r| r.record_type() == hickory_resolver::proto::rr::RecordType::MX)
        .map(|r| r.to_string())
        .collect();
    preferred_mx(lines.iter().map(String::as_str))
}

/// Settings for an address. Known providers come from the presets. For any other domain this
/// asks, in order of trust:
/// 1. the domain's own autoconfig service (the convention Thunderbird introduced, which most
///    hosting companies publish) — the domain owner saying where the mailboxes are;
/// 2. its MX records: a domain whose mail is delivered to Microsoft 365, Google Workspace, …
///    gets that provider's preset. Delivery and mailboxes can differ (a filtering service in
///    front of another host), which is why the explicit answer above wins;
/// 3. Mozilla's public database of providers;
/// 4. whichever of the usual host names (`imap.` / `smtp.` / `mail.`) exist in DNS.
///
/// Only the domain is ever sent, never the address.
pub async fn discover(email: &str) -> serde_json::Value {
    let mut found = detect(email);
    let domain = email
        .rsplit('@')
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let plausible = domain.contains('.')
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if found["id"] != "custom" || !email.contains('@') || !plausible {
        return found;
    }

    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
    else {
        return found;
    };
    let path = "mail/config-v1.1.xml";
    // Hosting companies usually point autoconfig.<domain> at a shared server whose
    // certificate is for another name, so plain HTTP has to stay as a fallback.
    let (own_tls, well_known, own_plain, ispdb, mx) = tokio::join!(
        fetch_autoconfig(&client, format!("https://autoconfig.{domain}/{path}")),
        fetch_autoconfig(
            &client,
            format!("https://{domain}/.well-known/autoconfig/{path}")
        ),
        fetch_autoconfig(&client, format!("http://autoconfig.{domain}/{path}")),
        fetch_autoconfig(
            &client,
            format!("https://autoconfig.thunderbird.net/v1.1/{domain}")
        ),
        primary_mx(&domain),
    );
    let own = own_tls.or(well_known).or(own_plain);
    if own.is_none()
        && let Some(preset) = mx.as_deref().and_then(by_mx)
    {
        return serde_json::json!(preset);
    }
    if let Some((imap, smtp)) = own.or(ispdb) {
        found["imapHost"] = imap.host.into();
        found["imapPort"] = imap.port.into();
        found["imapSecurity"] = imap.security.into();
        found["smtpHost"] = smtp.host.into();
        found["smtpPort"] = smtp.port.into();
        found["smtpSecurity"] = smtp.security.into();
        return found;
    }

    let (imap, smtp) = tokio::join!(
        first_resolving([format!("imap.{domain}"), format!("mail.{domain}")]),
        first_resolving([format!("smtp.{domain}"), format!("mail.{domain}")]),
    );
    if let Some(host) = imap {
        found["imapHost"] = host.into();
    }
    if let Some(host) = smtp {
        found["smtpHost"] = host.into();
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mail_exchangers_reveal_the_host() {
        let records = [
            "example.vn. 3600 IN MX 10 backup.hosting.vn.",
            "example.vn. 3600 IN MX 0 example-vn.mail.protection.outlook.com.",
        ];
        let host = preferred_mx(records.into_iter()).unwrap();
        assert_eq!(host, "example-vn.mail.protection.outlook.com.");
        assert_eq!(by_mx(&host).unwrap().id, "outlook");
        assert_eq!(by_mx("ASPMX.L.GOOGLE.COM.").unwrap().id, "gmail");
        assert!(by_mx("backup.hosting.vn.").is_none());
        assert!(by_mx("notgoogle.com").is_none());
        assert!(by_id("outlook").unwrap().oauth_only);
    }

    #[test]
    fn reads_autoconfig_documents() {
        let xml = r#"<?xml version="1.0"?>
<clientConfig version="1.1"><emailProvider id="example.org">
  <incomingServer type="pop3"><hostname>pop.example.org</hostname><port>995</port>
    <socketType>SSL</socketType></incomingServer>
  <incomingServer type="imap"><hostname>Mail.Example.org</hostname><port>993</port>
    <socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
  <outgoingServer type='smtp'><hostname>smtp.example.org</hostname><port>587</port>
    <socketType>STARTTLS</socketType></outgoingServer>
</emailProvider></clientConfig>"#;
        let (imap, smtp) = parse_autoconfig(xml).unwrap();
        assert_eq!(
            imap,
            Endpoint {
                host: "mail.example.org".into(),
                port: 993,
                security: "tls"
            }
        );
        assert_eq!(
            smtp,
            Endpoint {
                host: "smtp.example.org".into(),
                port: 587,
                security: "starttls"
            }
        );
        assert!(parse_autoconfig("<html>404</html>").is_none());
        let bad = xml.replace("Mail.Example.org", "evil host/");
        assert!(parse_autoconfig(&bad).is_none());
    }

    #[test]
    fn detects_known_and_unknown_domains() {
        assert_eq!(detect("someone@GMAIL.com")["id"], "gmail");
        assert_eq!(detect("a@hotmail.com")["id"], "outlook");
        let c = detect("me@example.org");
        assert_eq!(c["id"], "custom");
        assert_eq!(c["imapHost"], "imap.example.org");
        assert_eq!(c["smtpHost"], "smtp.example.org");
        assert_eq!(detect("not-an-address")["imapHost"], "");
    }

    #[test]
    fn port_decides_security() {
        assert_eq!(by_id("gmail").unwrap().smtp_security, "tls");
        assert_eq!(by_id("outlook").unwrap().smtp_security, "starttls");
    }
}
