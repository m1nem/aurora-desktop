use sqlx::Row;

use crate::error::AppResult;
use crate::models::plugin::PluginRecord;

use super::Db;

fn plugin_from_row(row: &sqlx::sqlite::SqliteRow) -> PluginRecord {
    PluginRecord {
        id: row.get("id"),
        name: row.get("name"),
        version: row.get("version"),
        author: row.get("author"),
        description: row.get("description"),
        file_path: row.get("file_name"),
        enabled_state: false,
        owner_id: row.get("owner_id"),
        owner_name: row.get("owner_name"),
        created_at: row.get("created_at"),
    }
}

impl Db {
    pub async fn list_plugins(&self) -> AppResult<Vec<PluginRecord>> {
        let rows = sqlx::query("SELECT * FROM plugins ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(plugin_from_row).collect())
    }

    pub async fn find_plugin(&self, id: &str) -> AppResult<Option<PluginRecord>> {
        let row = sqlx::query("SELECT * FROM plugins WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(plugin_from_row))
    }

    pub async fn insert_plugin(&self, record: &PluginRecord) -> AppResult<()> {
        let file_name = std::path::Path::new(&record.file_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&record.file_path);
        sqlx::query(
            r#"
            INSERT INTO plugins (
                id, name, version, author, description, file_name,
                owner_id, owner_name, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.name)
        .bind(&record.version)
        .bind(&record.author)
        .bind(&record.description)
        .bind(file_name)
        .bind(&record.owner_id)
        .bind(&record.owner_name)
        .bind(record.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_plugin(&self, id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM plugins WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
