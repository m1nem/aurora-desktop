use crate::error::AppResult;

use super::Db;

impl Db {
    pub async fn get_meta(&self, key: &str) -> AppResult<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM meta WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|value| value.0))
    }

    pub async fn set_meta(&self, key: &str, value: &str) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
