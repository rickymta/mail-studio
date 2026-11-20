//! `cargo run -p mailstudio-core --example discover -- someone@example.org`
//! Prints the server settings MailStudio would propose for an address.

#[tokio::main]
async fn main() {
    for email in std::env::args().skip(1) {
        let found = mailstudio_core::providers::discover(&email).await;
        println!(
            "{email}: {} | imap {}:{} {} | smtp {}:{} {}",
            found["id"].as_str().unwrap_or_default(),
            found["imapHost"].as_str().unwrap_or_default(),
            found["imapPort"],
            found["imapSecurity"].as_str().unwrap_or_default(),
            found["smtpHost"].as_str().unwrap_or_default(),
            found["smtpPort"],
            found["smtpSecurity"].as_str().unwrap_or_default(),
        );
    }
}
