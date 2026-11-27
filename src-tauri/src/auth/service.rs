use serde_json::{Value, json};

use crate::auth::email::{format_rate_limit_wait, mask_email, send_two_factor_email};
use crate::auth::password::{
    generate_user_id, hash_password, hash_token, new_session_token, verify_password,
};
use crate::auth::totp::{
    build_otpauth_url, generate_email_code, generate_totp_secret, hash_email_code, qr_data_url,
    verify_email_code, verify_totp_code,
};
use crate::database::challenges::ChallengeRecord;
use crate::database::now_ms;
use crate::error::{AppError, AppResult};
use crate::models::preferences::UserPreferences;
use crate::models::user::UserRecord;
use crate::state::AppState;

pub const SESSION_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
pub const CHALLENGE_TTL_MS: i64 = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS: i64 = 6;
const MAX_DISABLE_ATTEMPTS: i64 = 5;

fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}",
        hex::encode(crate::auth::password::random_bytes(12))
    )
}

fn user_json(user: &UserRecord) -> Value {
    serde_json::to_value(user.to_auth_user()).unwrap_or(Value::Null)
}

pub async fn current_user(state: &AppState) -> AppResult<Option<UserRecord>> {
    let Some(token) = state.session_token() else {
        return Ok(None);
    };
    let db = state.db().await?;
    let Some(user_id) = db.session_user_id(&hash_token(&token)).await? else {
        let _ = state.set_session_token(None);
        return Ok(None);
    };
    db.find_user_by_id(&user_id).await
}

pub async fn require_user(state: &AppState) -> AppResult<UserRecord> {
    current_user(state)
        .await?
        .ok_or_else(|| AppError::unauthorized("Sign in first."))
}

async fn create_session(state: &AppState, user_id: &str) -> AppResult<String> {
    let token = new_session_token();
    let token_hash = hash_token(&token);
    let expires_at = now_ms() + SESSION_TTL_MS;
    state
        .db()
        .await?
        .create_session(&token_hash, user_id, expires_at, None)
        .await?;
    state.set_session_token(Some(&token))?;
    Ok(token)
}

pub async fn register(
    state: &AppState,
    email: &str,
    username: &str,
    password: &str,
) -> AppResult<Value> {
    let email = email.trim().to_lowercase();
    let username = username.trim().to_string();

    let valid_email = {
        let mut parts = email.split('@');
        let local = parts.next().unwrap_or("");
        let domain = parts.next().unwrap_or("");
        !local.is_empty()
            && !domain.is_empty()
            && domain.contains('.')
            && parts.next().is_none()
            && !email.chars().any(char::is_whitespace)
            && email.len() <= 254
    };
    if !valid_email {
        return Err(AppError::bad_request("Enter a valid email address."));
    }

    if username.len() < 3
        || username.len() > 32
        || !username
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
    {
        return Err(AppError::bad_request(
            "Username must be 3–32 characters (letters, numbers, dot, dash, underscore).",
        ));
    }

    if password.len() < 8 || password.len() > 200 {
        return Err(AppError::bad_request(
            "Password must be at least 8 characters long.",
        ));
    }

    let db = state.db().await?;
    if db.email_taken(&email).await? {
        return Err(AppError::conflict(
            "An account with that email already exists.",
        ));
    }
    if db.username_taken(&username).await? {
        return Err(AppError::conflict("That username is already taken."));
    }

    let now = now_ms();
    let user = UserRecord {
        id: generate_user_id(),
        email,
        username,
        password_hash: hash_password(password),
        created_at: now,
        updated_at: now,
        two_factor_enabled: false,
        two_factor_method: "totp".to_string(),
        totp_secret: None,
        pending_totp_secret: None,
        email_two_factor_enabled: false,
        two_factor_enabled_at: None,
        failed_attempts: 0,
        locked_until: 0,
        preferences_json: serde_json::to_string(&UserPreferences::default())?,
    };

    db.insert_user(&user).await?;
    db.save_library(&user.id, &[], &[], 0).await?;
    create_session(state, &user.id).await?;

    Ok(json!({ "user": user_json(&user) }))
}

pub async fn login(
    state: &AppState,
    identifier: &str,
    password: &str,
    requested_method: Option<&str>,
) -> AppResult<Value> {
    let identifier = identifier.trim();
    if identifier.is_empty() || password.is_empty() {
        return Err(AppError::bad_request(
            "Enter your email/username and password.",
        ));
    }
    if identifier.chars().count() > 254 || password.chars().count() > 200 {
        return Err(AppError::bad_request(
            "Enter your email/username and password.",
        ));
    }

    let db = state.db().await?;
    db.prune_challenges().await?;
    let Some(mut user) = db.find_user_by_identifier(identifier).await? else {
        return Err(AppError::unauthorized(
            "Invalid email/username or password.",
        ));
    };

    let now = now_ms();
    if user.locked_until > now {
        let minutes = ((user.locked_until - now) as f64 / 60_000.0).ceil() as i64;
        return Err(AppError::too_many(format!(
            "Too many failed attempts. Try again in {minutes} minute(s)."
        )));
    }

    if !verify_password(password, &user.password_hash) {
        db.record_failed_login(&user).await?;
        return Err(AppError::unauthorized(
            "Invalid email/username or password.",
        ));
    }

    db.reset_failed_logins(&user.id).await?;
    user.failed_attempts = 0;
    user.locked_until = 0;

    if !user.two_factor_enabled {
        create_session(state, &user.id).await?;
        return Ok(json!({ "user": user_json(&user) }));
    }

    let mut methods: Vec<&str> = Vec::new();
    if user.totp_secret.is_some() {
        methods.push("totp");
    }
    if user.email_two_factor_enabled {
        methods.push("email");
    }

    if methods.is_empty() {
        // Never lock a user out because of inconsistent 2FA state.
        db.update_two_factor_settings(&user.id, false, "totp", None, None, false, None)
            .await?;
        user.two_factor_enabled = false;
        create_session(state, &user.id).await?;
        return Ok(json!({ "user": user_json(&user) }));
    }

    let method = match requested_method {
        Some(value) if methods.contains(&value) => value.to_string(),
        _ => methods[0].to_string(),
    };

    let challenge_id = new_id("2fa");

    let mut email_code: Option<String> = None;
    if method == "email" {
        match db.reserve_email_send(&user.id).await? {
            Ok(()) => {}
            Err(retry_after) => {
                return Err(AppError::too_many(format!(
                    "Too many email codes requested. Try again in {}.",
                    format_rate_limit_wait(retry_after)
                )));
            }
        }
        let code = generate_email_code();
        email_code = Some(code.clone());
        db.insert_challenge(&ChallengeRecord {
            id: challenge_id.clone(),
            user_id: user.id.clone(),
            method: "email".to_string(),
            purpose: "login".to_string(),
            email_code_hash: Some(hash_email_code(&challenge_id, &code)),
            created_at: now,
            expires_at: now + CHALLENGE_TTL_MS,
            attempts: 0,
            consumed_at: None,
        })
        .await?;
    } else {
        db.insert_challenge(&ChallengeRecord {
            id: challenge_id.clone(),
            user_id: user.id.clone(),
            method: "totp".to_string(),
            purpose: "login".to_string(),
            email_code_hash: None,
            created_at: now,
            expires_at: now + CHALLENGE_TTL_MS,
            attempts: 0,
            consumed_at: None,
        })
        .await?;
    }

    let mut delivered = false;
    let mut delivery_error: Option<String> = None;
    if let Some(code) = email_code.as_deref() {
        let result =
            send_two_factor_email(&state.paths, &user.email, &user.username, code, "login").await;
        delivered = result.delivered;
        delivery_error = result.reason;
    }

    // The desktop app is a single-user local client: when SMTP is unavailable
    // the code is shown in the UI (and written to the local outbox) instead of
    // blocking the account owner with a 503.
    Ok(json!({
        "requires2fa": true,
        "challengeId": challenge_id,
        "methods": methods,
        "method": method,
        "email": mask_email(&user.email),
        "emailDelivered": delivered,
        "deliveryError": if delivered { None } else { delivery_error },
        "devCode": if delivered { None } else { email_code },
    }))
}

pub async fn logout(state: &AppState, all_devices: bool) -> AppResult<Value> {
    let db = state.db().await?;
    let token = state.session_token();

    if all_devices {
        if let Some(user) = current_user(state).await? {
            db.delete_user_sessions(&user.id).await?;
        }
    } else if let Some(token) = token {
        db.delete_session(&hash_token(&token)).await?;
    }

    state.set_session_token(None)?;
    Ok(json!({ "ok": true }))
}

pub async fn current_user_response(state: &AppState) -> AppResult<Value> {
    Ok(json!({
        "user": current_user(state).await?.map(|user| user_json(&user)),
    }))
}

pub async fn totp_setup(state: &AppState) -> AppResult<Value> {
    let user = require_user(state).await?;
    let secret = generate_totp_secret();
    let otpauth_url = build_otpauth_url(&secret, &user.username, "AuroraMP");

    state
        .db()
        .await?
        .set_pending_totp(&user.id, &secret)
        .await?;

    Ok(json!({
        "secret": secret,
        "otpauthUrl": otpauth_url,
        "qrDataUrl": qr_data_url(&otpauth_url).unwrap_or_default(),
        "issuer": "AuroraMP",
        "account": user.username,
    }))
}

pub async fn totp_enable(state: &AppState, code: &str) -> AppResult<Value> {
    let user = require_user(state).await?;
    let code: String = code.chars().filter(|ch| !ch.is_whitespace()).collect();
    if code.len() != 6 || !code.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AppError::bad_request(
            "Enter the 6-digit code from your authenticator app.",
        ));
    }
    let Some(pending) = user.pending_totp_secret.clone() else {
        return Err(AppError::bad_request(
            "Start authenticator setup again to generate a new secret.",
        ));
    };
    if !verify_totp_code(&pending, &code) {
        return Err(AppError::bad_request(
            "That code is not valid. Check your device clock and try again.",
        ));
    }

    let db = state.db().await?;
    let enabled_at = now_ms();
    db.update_two_factor_settings(
        &user.id,
        true,
        "totp",
        Some(&pending),
        None,
        user.email_two_factor_enabled,
        Some(enabled_at),
    )
    .await?;

    let updated = db
        .find_user_by_id(&user.id)
        .await?
        .ok_or_else(|| AppError::not_found("Account not found."))?;
    Ok(json!({ "user": user_json(&updated) }))
}

pub async fn verify_two_factor(
    state: &AppState,
    challenge_id: &str,
    code: &str,
) -> AppResult<Value> {
    let challenge_id = challenge_id.trim();
    let code: String = code.chars().filter(|ch| !ch.is_whitespace()).collect();
    if challenge_id.is_empty() || code.is_empty() {
        return Err(AppError::bad_request("Verification code is required."));
    }

    let db = state.db().await?;
    let Some(challenge) = db.find_challenge(challenge_id).await? else {
        return Err(AppError::bad_request(
            "This verification session is no longer valid. Sign in again.",
        ));
    };
    if challenge.consumed_at.is_some() || challenge.purpose != "login" {
        return Err(AppError::bad_request(
            "This verification session is no longer valid. Sign in again.",
        ));
    }
    if challenge.expires_at <= now_ms() {
        return Err(AppError::bad_request(
            "The verification code expired. Sign in again to get a new one.",
        ));
    }

    let user = db
        .find_user_by_id(&challenge.user_id)
        .await?
        .ok_or_else(|| AppError::bad_request("Account not found."))?;

    let mut valid = false;
    if let Some(stored) = challenge.email_code_hash.as_deref() {
        if user.email_two_factor_enabled && verify_email_code(&challenge.id, stored, &code) {
            valid = true;
        }
    }
    if !valid {
        if let Some(secret) = user.totp_secret.as_deref() {
            if verify_totp_code(secret, &code) {
                valid = true;
            }
        }
    }

    if !valid {
        let attempts = challenge.attempts + 1;
        let consumed = (attempts >= MAX_CODE_ATTEMPTS).then(now_ms);
        db.increment_challenge_attempts(&challenge.id, attempts, consumed)
            .await?;
        let remaining = (MAX_CODE_ATTEMPTS - attempts).max(0);
        return Err(if remaining > 0 {
            AppError::unauthorized(format!("Incorrect code. {remaining} attempt(s) left."))
        } else {
            AppError::unauthorized("Too many incorrect codes. Sign in again.")
        });
    }

    db.consume_challenge(&challenge.id, now_ms()).await?;
    db.reset_failed_logins(&user.id).await?;
    create_session(state, &user.id).await?;

    let updated = db
        .find_user_by_id(&user.id)
        .await?
        .ok_or_else(|| AppError::not_found("Account not found."))?;
    Ok(json!({ "user": user_json(&updated) }))
}

pub async fn send_two_factor_email_code(state: &AppState, challenge_id: &str) -> AppResult<Value> {
    let challenge_id = challenge_id.trim();
    if challenge_id.is_empty() {
        return Err(AppError::bad_request("Missing challengeId"));
    }

    let db = state.db().await?;
    let Some(challenge) = db.find_challenge(challenge_id).await? else {
        return Err(AppError::bad_request(
            "This verification session is no longer valid. Sign in again.",
        ));
    };
    if challenge.consumed_at.is_some() || challenge.purpose != "login" {
        return Err(AppError::bad_request(
            "This verification session is not valid for sign-in.",
        ));
    }
    if challenge.expires_at <= now_ms() {
        return Err(AppError::bad_request(
            "The verification session expired. Sign in again.",
        ));
    }

    let user = db
        .find_user_by_id(&challenge.user_id)
        .await?
        .ok_or_else(|| AppError::bad_request("Account not found."))?;
    if !user.email_two_factor_enabled {
        return Err(AppError::bad_request(
            "Email authorization is not enabled for this account.",
        ));
    }

    match db.reserve_email_send(&user.id).await? {
        Ok(()) => {}
        Err(retry_after) => {
            return Err(AppError::too_many(format!(
                "Too many email codes requested. Try again in {}.",
                format_rate_limit_wait(retry_after)
            )));
        }
    }

    let code = generate_email_code();
    let now = now_ms();
    let code_hash = hash_email_code(&challenge.id, &code);
    db.update_challenge_email(
        &challenge.id,
        "email",
        &code_hash,
        now,
        now + CHALLENGE_TTL_MS,
    )
    .await?;

    let delivery =
        send_two_factor_email(&state.paths, &user.email, &user.username, &code, "login").await;

    Ok(json!({
        "ok": true,
        "method": "email",
        "email": mask_email(&user.email),
        "emailDelivered": delivery.delivered,
        "deliveryError": if delivery.delivered { None } else { delivery.reason },
        "devCode": if delivery.delivered { None } else { Some(code) },
    }))
}

pub async fn set_email_two_factor(state: &AppState, enabled: bool) -> AppResult<Value> {
    let user = require_user(state).await?;

    if enabled {
        return Err(AppError::new(
            "EMAIL_2FA_WIP",
            "Email 2FA enrollment is temporarily unavailable (WIP - Work In Progress).",
            501,
        ));
    }

    let db = state.db().await?;
    if !user.two_factor_enabled {
        return Ok(json!({ "user": user_json(&user) }));
    }

    let totp_still_enabled = user.totp_secret.is_some();
    db.update_two_factor_settings(
        &user.id,
        totp_still_enabled,
        "totp",
        user.totp_secret.as_deref(),
        user.pending_totp_secret.as_deref(),
        false,
        if totp_still_enabled {
            user.two_factor_enabled_at
        } else {
            None
        },
    )
    .await?;

    let updated = db
        .find_user_by_id(&user.id)
        .await?
        .ok_or_else(|| AppError::not_found("Account not found."))?;
    Ok(json!({ "user": user_json(&updated) }))
}

pub async fn send_disable_two_factor_email(state: &AppState) -> AppResult<Value> {
    let user = require_user(state).await?;

    if !user.two_factor_enabled {
        return Err(AppError::bad_request(
            "Two-factor authentication is not enabled for this account.",
        ));
    }
    if !user.email_two_factor_enabled {
        return Err(AppError::bad_request(
            "Email authorization is not enabled for this account.",
        ));
    }

    let db = state.db().await?;
    match db.reserve_email_send(&user.id).await? {
        Ok(()) => {}
        Err(retry_after) => {
            return Err(AppError::too_many(format!(
                "Too many email codes requested. Try again in {}.",
                format_rate_limit_wait(retry_after)
            )));
        }
    }

    let code = generate_email_code();
    let challenge_id = new_id("2fa");
    let now = now_ms();

    db.delete_disable_challenges(&user.id).await?;
    db.insert_challenge(&ChallengeRecord {
        id: challenge_id.clone(),
        user_id: user.id.clone(),
        method: "email".to_string(),
        purpose: "disable-2fa".to_string(),
        email_code_hash: Some(hash_email_code(&challenge_id, &code)),
        created_at: now,
        expires_at: now + CHALLENGE_TTL_MS,
        attempts: 0,
        consumed_at: None,
    })
    .await?;

    let delivery = send_two_factor_email(
        &state.paths,
        &user.email,
        &user.username,
        &code,
        "disable-2fa",
    )
    .await;

    Ok(json!({
        "ok": true,
        "challengeId": challenge_id,
        "method": "email",
        "email": mask_email(&user.email),
        "expiresInMinutes": CHALLENGE_TTL_MS / 60_000,
        "emailDelivered": delivery.delivered,
        "deliveryError": if delivery.delivered { None } else { delivery.reason },
        "devCode": if delivery.delivered { None } else { Some(code) },
    }))
}

pub async fn disable_two_factor(
    state: &AppState,
    password: &str,
    code: &str,
    challenge_id: Option<&str>,
) -> AppResult<Value> {
    let user = require_user(state).await?;
    if password.is_empty() {
        return Err(AppError::bad_request(
            "Enter your password to disable two-factor authentication.",
        ));
    }
    let code: String = code.chars().filter(|ch| !ch.is_whitespace()).collect();
    if code.is_empty() {
        return Err(AppError::bad_request(
            "Enter a 6-digit code from your authenticator app or the code sent to your email.",
        ));
    }

    if !user.two_factor_enabled {
        return Err(AppError::bad_request(
            "Two-factor authentication is not enabled for this account.",
        ));
    }
    if !verify_password(password, &user.password_hash) {
        return Err(AppError::unauthorized(
            "Incorrect password or invalid/expired 2FA code.",
        ));
    }

    let db = state.db().await?;
    let mut valid = user
        .totp_secret
        .as_deref()
        .map(|secret| verify_totp_code(secret, &code))
        .unwrap_or(false);

    if !valid && user.email_two_factor_enabled {
        if let Some(challenge) = db
            .find_disable_challenge(&user.id, challenge_id.unwrap_or(""))
            .await?
        {
            if let Some(stored) = challenge.email_code_hash.as_deref() {
                if verify_email_code(&challenge.id, stored, &code) {
                    db.consume_challenge(&challenge.id, now_ms()).await?;
                    valid = true;
                } else {
                    let attempts = challenge.attempts + 1;
                    let consumed = (attempts >= MAX_DISABLE_ATTEMPTS).then(now_ms);
                    db.increment_challenge_attempts(&challenge.id, attempts, consumed)
                        .await?;
                }
            }
        }
    }

    if !valid {
        return Err(AppError::unauthorized(
            "Incorrect password or invalid/expired 2FA code.",
        ));
    }

    db.update_two_factor_settings(&user.id, false, "totp", None, None, false, None)
        .await?;
    db.reset_failed_logins(&user.id).await?;
    db.delete_disable_challenges(&user.id).await?;

    let updated = db
        .find_user_by_id(&user.id)
        .await?
        .ok_or_else(|| AppError::not_found("Account not found."))?;

    Ok(json!({
        "ok": true,
        "twoFactorDisabled": true,
        "user": user_json(&updated),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::totp::generate_totp_code;
    use crate::state::AppState;

    fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("aurora-auth-{name}-{}", uuid::Uuid::new_v4()));
        let paths = crate::storage::paths::AppPaths::from_root(root.clone()).expect("app paths");
        (AppState::new_for_tests(paths), root)
    }

    #[tokio::test]
    async fn register_login_totp_and_disable_flow() {
        let (state, root) = test_state("flow");

        let registered = register(&state, "Player@Example.com", "player_one", "hunter2hunter2")
            .await
            .expect("register");
        assert_eq!(registered["user"]["email"], "player@example.com");
        assert_eq!(registered["user"]["username"], "player_one");
        assert!(state.session_token().is_some());

        let me = current_user(&state).await.unwrap().expect("session user");
        assert_eq!(me.username, "player_one");
        assert!(me.password_hash.starts_with("scrypt$16384$8$1$"));

        let duplicate = register(&state, "player@example.com", "other", "password123")
            .await
            .expect_err("duplicate email");
        assert_eq!(duplicate.code, "CONFLICT");

        let setup = totp_setup(&state).await.expect("totp setup");
        let secret = setup["secret"].as_str().unwrap().to_string();
        assert!(
            setup["otpauthUrl"]
                .as_str()
                .unwrap()
                .starts_with("otpauth://totp/")
        );
        assert!(
            setup["qrDataUrl"]
                .as_str()
                .unwrap()
                .starts_with("data:image/svg+xml;base64,")
        );

        let code = generate_totp_code(&secret, now_ms()).expect("totp code");
        let enabled = totp_enable(&state, &code).await.expect("enable totp");
        assert_eq!(enabled["user"]["twoFactor"]["enabled"], true);
        assert_eq!(enabled["user"]["twoFactor"]["totpEnabled"], true);

        logout(&state, false).await.expect("logout");
        assert!(state.session_token().is_none());

        let challenge = login(&state, "player_one", "hunter2hunter2", None)
            .await
            .expect("password login");
        assert_eq!(challenge["requires2fa"], true);
        assert_eq!(challenge["method"], "totp");
        let challenge_id = challenge["challengeId"].as_str().unwrap().to_string();

        let valid = generate_totp_code(&secret, now_ms()).unwrap();
        let wrong = if valid == "000000" {
            "111111"
        } else {
            "000000"
        };
        let failed = verify_two_factor(&state, &challenge_id, wrong)
            .await
            .expect_err("wrong totp");
        assert_eq!(failed.code, "UNAUTHORIZED");

        let verified = verify_two_factor(&state, &challenge_id, &valid)
            .await
            .expect("verify totp");
        assert_eq!(verified["user"]["username"], "player_one");
        assert!(state.session_token().is_some());

        let code = generate_totp_code(&secret, now_ms()).unwrap();
        let disabled = disable_two_factor(&state, "hunter2hunter2", &code, None)
            .await
            .expect("disable 2fa");
        assert_eq!(disabled["twoFactorDisabled"], true);

        logout(&state, false).await.unwrap();
        let plain = login(&state, "player@example.com", "hunter2hunter2", None)
            .await
            .expect("login without 2fa");
        assert!(plain["user"].is_object());

        let db = state.db().await.unwrap();
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn failed_logins_lock_the_account() {
        let (state, root) = test_state("lockout");
        register(&state, "lock@example.com", "locked", "correct-pass")
            .await
            .unwrap();
        logout(&state, false).await.unwrap();

        for _ in 0..5 {
            let error = login(&state, "locked", "wrong-pass", None)
                .await
                .expect_err("wrong password");
            assert_eq!(error.code, "UNAUTHORIZED");
        }

        let locked = login(&state, "locked", "correct-pass", None)
            .await
            .expect_err("locked");
        assert_eq!(locked.code, "RATE_LIMITED");

        let db = state.db().await.unwrap();
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn email_2fa_enrollment_stays_wip() {
        let (state, root) = test_state("email-wip");
        let registered = register(&state, "wip@example.com", "wipuser", "password123")
            .await
            .unwrap();
        assert!(registered["user"].is_object());
        let error = set_email_two_factor(&state, true)
            .await
            .expect_err("enrollment is WIP");
        assert_eq!(error.code, "EMAIL_2FA_WIP");
        assert_eq!(error.status, 501);

        let db = state.db().await.unwrap();
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
