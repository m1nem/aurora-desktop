use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::AppResult;

use super::{Db, now_ms};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeRecord {
    pub id: String,
    pub user_id: String,
    pub method: String,
    pub purpose: String,
    pub email_code_hash: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub attempts: i64,
    pub consumed_at: Option<i64>,
}

fn challenge_from_row(row: &sqlx::sqlite::SqliteRow) -> ChallengeRecord {
    ChallengeRecord {
        id: row.get("id"),
        user_id: row.get("user_id"),
        method: row.get("method"),
        purpose: row.get("purpose"),
        email_code_hash: row.get("email_code_hash"),
        created_at: row.get("created_at"),
        expires_at: row.get("expires_at"),
        attempts: row.get("attempts"),
        consumed_at: row.get("consumed_at"),
    }
}

impl Db {
    pub async fn insert_challenge(&self, challenge: &ChallengeRecord) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO challenges (
                id, user_id, method, purpose, email_code_hash,
                created_at, expires_at, attempts, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&challenge.id)
        .bind(&challenge.user_id)
        .bind(&challenge.method)
        .bind(&challenge.purpose)
        .bind(&challenge.email_code_hash)
        .bind(challenge.created_at)
        .bind(challenge.expires_at)
        .bind(challenge.attempts)
        .bind(challenge.consumed_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn find_challenge(&self, id: &str) -> AppResult<Option<ChallengeRecord>> {
        let row = sqlx::query("SELECT * FROM challenges WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(challenge_from_row))
    }

    pub async fn consume_challenge(&self, id: &str, consumed_at: i64) -> AppResult<()> {
        sqlx::query("UPDATE challenges SET consumed_at = ? WHERE id = ?")
            .bind(consumed_at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn increment_challenge_attempts(
        &self,
        id: &str,
        attempts: i64,
        consumed_at: Option<i64>,
    ) -> AppResult<()> {
        sqlx::query("UPDATE challenges SET attempts = ?, consumed_at = ? WHERE id = ?")
            .bind(attempts)
            .bind(consumed_at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_challenge_email(
        &self,
        id: &str,
        method: &str,
        code_hash: &str,
        created_at: i64,
        expires_at: i64,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE challenges SET method = ?, email_code_hash = ?, created_at = ?, expires_at = ?, attempts = 0, consumed_at = NULL WHERE id = ?",
        )
        .bind(method)
        .bind(code_hash)
        .bind(created_at)
        .bind(expires_at)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn prune_challenges(&self) -> AppResult<()> {
        let now = now_ms();
        sqlx::query("DELETE FROM challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL")
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_disable_challenges(&self, user_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM challenges WHERE user_id = ? AND purpose = 'disable-2fa'")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn find_disable_challenge(
        &self,
        user_id: &str,
        challenge_id: &str,
    ) -> AppResult<Option<ChallengeRecord>> {
        let row = if challenge_id.is_empty() {
            sqlx::query(
                "SELECT * FROM challenges WHERE user_id = ? AND purpose = 'disable-2fa' AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
            )
            .bind(user_id)
            .bind(now_ms())
            .fetch_optional(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT * FROM challenges WHERE id = ? AND user_id = ? AND purpose = 'disable-2fa' AND consumed_at IS NULL AND expires_at > ? LIMIT 1",
            )
            .bind(challenge_id)
            .bind(user_id)
            .bind(now_ms())
            .fetch_optional(&self.pool)
            .await?
        };
        Ok(row.as_ref().map(challenge_from_row))
    }

    /// Records an email send and enforces 6 sends / 15 minutes and a 30 s
    /// minimum interval per account. Returns the retry delay when rejected.
    pub async fn reserve_email_send(&self, user_id: &str) -> AppResult<Result<(), i64>> {
        let now = now_ms();
        let window_start = now - 15 * 60 * 1000;

        sqlx::query("DELETE FROM email_sends WHERE user_id = ? AND sent_at <= ?")
            .bind(user_id)
            .bind(window_start)
            .execute(&self.pool)
            .await?;

        let rows: Vec<(i64,)> = sqlx::query_as(
            "SELECT sent_at FROM email_sends WHERE user_id = ? ORDER BY sent_at ASC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        if let Some((last,)) = rows.last() {
            let wait = last + 30_000 - now;
            if wait > 0 {
                return Ok(Err(wait));
            }
        }

        if rows.len() >= 6 {
            let wait = rows[0].0 + 15 * 60 * 1000 - now;
            return Ok(Err(wait.max(1)));
        }

        sqlx::query("INSERT INTO email_sends (user_id, sent_at) VALUES (?, ?)")
            .bind(user_id)
            .bind(now)
            .execute(&self.pool)
            .await?;

        Ok(Ok(()))
    }
}
