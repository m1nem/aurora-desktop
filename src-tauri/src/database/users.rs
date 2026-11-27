use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::models::user::UserRecord;

use super::Db;

fn user_from_row(row: &sqlx::sqlite::SqliteRow) -> UserRecord {
    UserRecord {
        id: row.get("id"),
        email: row.get("email"),
        username: row.get("username"),
        password_hash: row.get("password_hash"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        two_factor_enabled: row.get::<i64, _>("two_factor_enabled") != 0,
        two_factor_method: row.get("two_factor_method"),
        totp_secret: row.get("totp_secret"),
        pending_totp_secret: row.get("pending_totp_secret"),
        email_two_factor_enabled: row.get::<i64, _>("email_two_factor_enabled") != 0,
        two_factor_enabled_at: row.get("two_factor_enabled_at"),
        failed_attempts: row.get("failed_attempts"),
        locked_until: row.get("locked_until"),
        preferences_json: row.get("preferences"),
    }
}

impl Db {
    pub async fn find_user_by_id(&self, id: &str) -> AppResult<Option<UserRecord>> {
        let row = sqlx::query("SELECT * FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(user_from_row))
    }

    pub async fn find_user_by_identifier(&self, identifier: &str) -> AppResult<Option<UserRecord>> {
        let needle = identifier.trim();
        if needle.is_empty() {
            return Ok(None);
        }
        let row = sqlx::query(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE LIMIT 1",
        )
        .bind(needle)
        .bind(needle)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.as_ref().map(user_from_row))
    }

    pub async fn insert_user(&self, user: &UserRecord) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO users (
                id, email, username, password_hash, created_at, updated_at,
                two_factor_enabled, two_factor_method, totp_secret,
                pending_totp_secret, email_two_factor_enabled,
                two_factor_enabled_at, failed_attempts, locked_until, preferences
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&user.id)
        .bind(&user.email)
        .bind(&user.username)
        .bind(&user.password_hash)
        .bind(user.created_at)
        .bind(user.updated_at)
        .bind(user.two_factor_enabled as i64)
        .bind(&user.two_factor_method)
        .bind(&user.totp_secret)
        .bind(&user.pending_totp_secret)
        .bind(user.email_two_factor_enabled as i64)
        .bind(user.two_factor_enabled_at)
        .bind(user.failed_attempts)
        .bind(user.locked_until)
        .bind(&user.preferences_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            if let sqlx::Error::Database(db_error) = &error {
                if db_error.is_unique_violation() {
                    return AppError::conflict(
                        "An account with that email or username already exists.",
                    );
                }
            }
            error.into()
        })?;
        Ok(())
    }

    pub async fn record_failed_login(&self, user: &UserRecord) -> AppResult<()> {
        let mut attempts = user.failed_attempts + 1;
        let mut locked_until = user.locked_until;
        if attempts >= 5 {
            attempts = 0;
            locked_until = super::now_ms() + 10 * 60 * 1000;
        }
        sqlx::query(
            "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
        )
        .bind(attempts)
        .bind(locked_until)
        .bind(super::now_ms())
        .bind(&user.id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn reset_failed_logins(&self, user_id: &str) -> AppResult<()> {
        sqlx::query(
            "UPDATE users SET failed_attempts = 0, locked_until = 0, updated_at = ? WHERE id = ?",
        )
        .bind(super::now_ms())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_preferences(&self, user_id: &str, preferences_json: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?")
            .bind(preferences_json)
            .bind(super::now_ms())
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)] // mirrors the columns changed together
    pub async fn update_two_factor_settings(
        &self,
        user_id: &str,
        enabled: bool,
        method: &str,
        totp_secret: Option<&str>,
        pending_totp_secret: Option<&str>,
        email_enabled: bool,
        enabled_at: Option<i64>,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE users SET
                two_factor_enabled = ?, two_factor_method = ?, totp_secret = ?,
                pending_totp_secret = ?, email_two_factor_enabled = ?,
                two_factor_enabled_at = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(enabled as i64)
        .bind(method)
        .bind(totp_secret)
        .bind(pending_totp_secret)
        .bind(email_enabled as i64)
        .bind(enabled_at)
        .bind(super::now_ms())
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_pending_totp(&self, user_id: &str, secret: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET pending_totp_secret = ?, updated_at = ? WHERE id = ?")
            .bind(secret)
            .bind(super::now_ms())
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_users(&self) -> AppResult<Vec<UserRecord>> {
        let rows = sqlx::query("SELECT * FROM users ORDER BY created_at ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(user_from_row).collect())
    }

    pub async fn email_taken(&self, email: &str) -> AppResult<bool> {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE LIMIT 1")
                .bind(email)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.is_some())
    }

    pub async fn username_taken(&self, username: &str) -> AppResult<bool> {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
                .bind(username)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.is_some())
    }
}
