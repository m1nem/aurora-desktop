use std::time::Duration;

use lettre::message::{Mailbox, header::ContentType};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::storage::paths::AppPaths;

#[derive(Debug, Clone)]
pub struct SendResult {
    pub delivered: bool,
    pub reason: Option<String>,
}

struct SmtpConfig {
    host: String,
    port: u16,
    secure: bool,
    user: Option<String>,
    password: String,
    from: String,
}

fn smtp_config() -> Option<SmtpConfig> {
    if let Ok(raw_url) = std::env::var("AURORA_SMTP_URL") {
        if let Ok(parsed) = reqwest::Url::parse(&raw_url) {
            let host = parsed.host_str()?.to_string();
            let port = parsed
                .port()
                .unwrap_or(if parsed.scheme() == "smtps" { 465 } else { 587 });
            let user = if parsed.username().is_empty() {
                None
            } else {
                Some(parsed.username().to_string())
            };
            let password = parsed.password().unwrap_or("").to_string();
            let from = std::env::var("AURORA_SMTP_FROM")
                .unwrap_or_else(|_| user.clone().unwrap_or_else(|| format!("aurora@{host}")));
            return Some(SmtpConfig {
                host,
                port,
                secure: parsed.scheme() == "smtps" || port == 465,
                user,
                password,
                from,
            });
        }
    }

    let host = std::env::var("AURORA_SMTP_HOST").ok()?;
    let from = std::env::var("AURORA_SMTP_FROM").ok()?;
    let port = std::env::var("AURORA_SMTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(587);
    Some(SmtpConfig {
        host,
        port,
        secure: port == 465,
        user: std::env::var("AURORA_SMTP_USER").ok(),
        password: std::env::var("AURORA_SMTP_PASS").unwrap_or_default(),
        from,
    })
}

fn append_outbox(paths: &AppPaths, to: &str, subject: &str, text: &str) {
    use std::io::Write;
    let line = format!(
        "--- {} ---\nTo: {to}\nSubject: {subject}\n{text}\n\n",
        chrono::Utc::now().to_rfc3339()
    );
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(&paths.outbox_file)
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if let Err(error) = result {
        log::warn!("could not write email outbox: {error}");
    }
}

async fn send_mail(
    paths: &AppPaths,
    to: &str,
    subject: &str,
    text: String,
    html: Option<String>,
) -> SendResult {
    let Some(config) = smtp_config() else {
        append_outbox(paths, to, subject, &text);
        log::info!("SMTP is not configured; message for {to} written to the local outbox");
        return SendResult {
            delivered: false,
            reason: Some(
                "SMTP is not configured. Set AURORA_SMTP_HOST/AURORA_SMTP_FROM (or AURORA_SMTP_URL) to deliver email."
                    .to_string(),
            ),
        };
    };

    let from: Mailbox = match config.from.parse() {
        Ok(value) => value,
        Err(error) => {
            append_outbox(paths, to, subject, &text);
            return SendResult {
                delivered: false,
                reason: Some(format!("Invalid AURORA_SMTP_FROM address: {error}")),
            };
        }
    };
    let recipient: Mailbox = match to.parse() {
        Ok(value) => value,
        Err(error) => {
            return SendResult {
                delivered: false,
                reason: Some(format!("Invalid recipient address: {error}")),
            };
        }
    };

    let builder = Message::builder()
        .from(from)
        .to(recipient)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN);
    let message = match html {
        Some(html) => builder.multipart(lettre::message::MultiPart::alternative_plain_html(
            text.clone(),
            html,
        )),
        None => builder.body(text.clone()),
    };

    let message = match message {
        Ok(value) => value,
        Err(error) => {
            append_outbox(paths, to, subject, &text);
            return SendResult {
                delivered: false,
                reason: Some(format!("Could not build email: {error}")),
            };
        }
    };

    let transport = if config.secure {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
    };

    let builder = match transport {
        Ok(builder) => builder.port(config.port),
        Err(error) => {
            append_outbox(paths, to, subject, &text);
            return SendResult {
                delivered: false,
                reason: Some(format!("Could not build the SMTP transport: {error}")),
            };
        }
    };

    let builder = if let Some(user) = config.user.as_ref() {
        builder.credentials(Credentials::new(user.clone(), config.password.clone()))
    } else {
        builder
    };

    let mailer = builder.build();
    match tokio::time::timeout(Duration::from_secs(20), mailer.send(message)).await {
        Ok(Ok(_)) => SendResult {
            delivered: true,
            reason: None,
        },
        Ok(Err(error)) => {
            append_outbox(paths, to, subject, &text);
            log::warn!("SMTP delivery failed: {error}");
            SendResult {
                delivered: false,
                reason: Some(error.to_string()),
            }
        }
        Err(_) => {
            append_outbox(paths, to, subject, &text);
            SendResult {
                delivered: false,
                reason: Some("SMTP delivery timed out.".to_string()),
            }
        }
    }
}

pub async fn send_two_factor_email(
    paths: &AppPaths,
    to: &str,
    username: &str,
    code: &str,
    purpose: &str,
) -> SendResult {
    let is_disable = purpose == "disable-2fa";
    let subject = if is_disable {
        "AuroraMP security code"
    } else {
        "AuroraMP verification code"
    };
    let action = if is_disable {
        "disable two-factor authentication"
    } else {
        "sign in"
    };
    let text = format!(
        "Hi {username},\n\nYour AuroraMP security code is: {code}\n\nUse this code to {action}. It expires in 10 minutes.\n\n{}\n\n— AuroraMP",
        if is_disable {
            "If you did not request this change, change your password immediately."
        } else {
            "If you did not try to sign in, you can ignore this message."
        }
    );
    let html = format!(
        r#"<div style="font-family:ui-monospace,Menlo,monospace;background:#0a0e0a;color:#f0fdf4;padding:24px">
<h2 style="margin:0 0 12px">AuroraMP // security</h2>
<p>Hi {username},</p>
<p>Use this code to {action}:</p>
<p style="font-size:30px;letter-spacing:8px;font-weight:700;color:#22c55e">{code}</p>
<p style="color:#a3a3a3">This code expires in 10 minutes.</p>
</div>"#
    );
    send_mail(paths, to, subject, text, Some(html)).await
}

/// Sends an arbitrary plain-text message through the configured SMTP relay.
pub async fn send_plain_email(
    paths: &AppPaths,
    to: &str,
    subject: &str,
    body: String,
) -> SendResult {
    send_mail(paths, to, subject, body, None).await
}

pub fn mask_email(email: &str) -> String {
    let Some((local, domain)) = email.split_once('@') else {
        return email.to_string();
    };
    if local.is_empty() {
        return format!("***@{domain}");
    }
    if local.len() <= 2 {
        return format!("{}***@{domain}", &local[..1]);
    }
    let keep = 2;
    let stars = "*".repeat((local.len().saturating_sub(keep)).clamp(3, 6));
    format!("{}{}@{}", &local[..keep], stars, domain)
}

pub fn format_rate_limit_wait(retry_after_ms: i64) -> String {
    let seconds = (retry_after_ms.max(1) + 999) / 1000;
    if seconds < 60 {
        format!("{seconds} second(s)")
    } else {
        format!("{} minute(s)", (seconds + 59) / 60)
    }
}
