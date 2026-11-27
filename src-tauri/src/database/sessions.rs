use crate::error::AppResult;

use super::{Db, now_ms};

impl Db {
    pub async fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: i64,
        user_agent: Option<&str>,
    ) -> AppResult<()> {
        let now = now_ms();
        sqlx::query("DELETE FROM sessions WHERE expires_at <= ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(token_hash)
        .bind(user_id)
        .bind(now)
        .bind(expires_at)
        .bind(user_agent)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn session_user_id(&self, token_hash: &str) -> AppResult<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
                .bind(token_hash)
                .bind(now_ms())
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|value| value.0))
    }

    pub async fn delete_session(&self, token_hash: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
            .bind(token_hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_user_sessions(&self, user_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
