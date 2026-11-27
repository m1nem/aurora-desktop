use serde::{Deserialize, Serialize};

use super::preferences::UserPreferences;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub username: String,
    pub created_at: i64,
    pub preferences: UserPreferences,
    pub two_factor: TwoFactorState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorState {
    pub enabled: bool,
    pub method: String,
    pub totp_enabled: bool,
    pub email_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct UserRecord {
    pub id: String,
    pub email: String,
    pub username: String,
    pub password_hash: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub two_factor_enabled: bool,
    pub two_factor_method: String,
    pub totp_secret: Option<String>,
    pub pending_totp_secret: Option<String>,
    pub email_two_factor_enabled: bool,
    pub two_factor_enabled_at: Option<i64>,
    pub failed_attempts: i64,
    pub locked_until: i64,
    pub preferences_json: String,
}

impl UserRecord {
    pub fn preferences(&self) -> UserPreferences {
        crate::services::preferences::normalize_preferences_json(
            &serde_json::from_str(&self.preferences_json).unwrap_or(serde_json::Value::Null),
        )
    }

    pub fn to_auth_user(&self) -> AuthUser {
        AuthUser {
            id: self.id.clone(),
            email: self.email.clone(),
            username: self.username.clone(),
            created_at: self.created_at,
            preferences: self.preferences(),
            two_factor: TwoFactorState {
                enabled: self.two_factor_enabled,
                method: if self.two_factor_method == "email" {
                    "email".to_string()
                } else {
                    "totp".to_string()
                },
                totp_enabled: self.totp_secret.is_some(),
                email_enabled: self.email_two_factor_enabled,
                enabled_at: self.two_factor_enabled_at,
            },
        }
    }
}
