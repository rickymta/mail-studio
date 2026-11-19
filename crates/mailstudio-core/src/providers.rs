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

#[cfg(test)]
mod tests {
    use super::*;

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
