use std::path::Path;
use std::time::Duration;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

use crate::error::AppResult;

pub mod challenges;
pub mod library;
pub mod meta;
pub mod plugins;
pub mod sessions;
pub mod users;

#[derive(Clone)]
pub struct Db {
    pub pool: SqlitePool,
}

impl Db {
    pub async fn connect(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5))
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        let db = Self { pool };
        db.migrate().await?;
        Ok(db)
    }

    async fn migrate(&self) -> AppResult<()> {
        let statements = [
            r#"
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                two_factor_enabled INTEGER NOT NULL DEFAULT 0,
                two_factor_method TEXT NOT NULL DEFAULT 'totp',
                totp_secret TEXT,
                pending_totp_secret TEXT,
                email_two_factor_enabled INTEGER NOT NULL DEFAULT 0,
                two_factor_enabled_at INTEGER,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until INTEGER NOT NULL DEFAULT 0,
                preferences TEXT NOT NULL DEFAULT '{}'
            )
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                user_agent TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS challenges (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                method TEXT NOT NULL,
                purpose TEXT NOT NULL DEFAULT 'login',
                email_code_hash TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                consumed_at INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS email_sends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                sent_at INTEGER NOT NULL
            )
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS libraries (
                user_id TEXT PRIMARY KEY,
                tracks TEXT NOT NULL DEFAULT '[]',
                playlists TEXT NOT NULL DEFAULT '[]',
                updated_at INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                author TEXT NOT NULL,
                description TEXT NOT NULL,
                file_name TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                owner_name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            "#,
            r#"
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)
            "#,
            r#"
            CREATE INDEX IF NOT EXISTS idx_challenges_user ON challenges(user_id)
            "#,
            r#"
            CREATE INDEX IF NOT EXISTS idx_email_sends_user ON email_sends(user_id, sent_at)
            "#,
        ];

        for statement in statements {
            sqlx::query(statement).execute(&self.pool).await?;
        }

        Ok(())
    }
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::library::Playlist;
    use crate::models::track::Track;
    use crate::models::user::UserRecord;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("aurora-db-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp root");
        root
    }

    fn user(id: &str, email: &str, username: &str) -> UserRecord {
        UserRecord {
            id: id.to_string(),
            email: email.to_string(),
            username: username.to_string(),
            password_hash: "scrypt$16384$8$1$00$00".to_string(),
            created_at: 1,
            updated_at: 1,
            two_factor_enabled: false,
            two_factor_method: "totp".to_string(),
            totp_secret: None,
            pending_totp_secret: None,
            email_two_factor_enabled: false,
            two_factor_enabled_at: None,
            failed_attempts: 0,
            locked_until: 0,
            preferences_json: "{}".to_string(),
        }
    }

    fn track(id: &str, title: &str) -> Track {
        Track {
            id: id.to_string(),
            title: title.to_string(),
            author: "Artist".to_string(),
            album: None,
            duration: 120,
            thumbnail: String::new(),
            url: format!("/api/media/downloads/{id}.mp3"),
            file_path: None,
            source: "youtube".to_string(),
            cloud_url: None,
            external_uri: None,
            file_size: None,
            uploaded_at: Some(1),
        }
    }

    #[tokio::test]
    async fn users_sessions_libraries_and_meta_round_trip() {
        let root = temp_root("roundtrip");
        let db = Db::connect(&root.join("aurora.db")).await.expect("connect");

        db.insert_user(&user("usr-1", "a@example.com", "alpha"))
            .await
            .unwrap();
        db.insert_user(&user("usr-2", "b@example.com", "beta"))
            .await
            .unwrap();

        assert!(db.email_taken("A@EXAMPLE.COM").await.unwrap());
        assert!(db.username_taken("ALPHA").await.unwrap());
        assert!(!db.email_taken("missing@example.com").await.unwrap());

        let found = db
            .find_user_by_identifier("Alpha")
            .await
            .unwrap()
            .expect("user by username");
        assert_eq!(found.id, "usr-1");
        let found = db
            .find_user_by_identifier("B@example.com")
            .await
            .unwrap()
            .expect("user by email");
        assert_eq!(found.id, "usr-2");

        db.create_session("hash-1", "usr-1", now_ms() + 60_000, Some("test"))
            .await
            .unwrap();
        assert_eq!(
            db.session_user_id("hash-1").await.unwrap().as_deref(),
            Some("usr-1")
        );
        db.delete_session("hash-1").await.unwrap();
        assert!(db.session_user_id("hash-1").await.unwrap().is_none());

        let playlist = Playlist {
            id: "pl-1".to_string(),
            name: "Mix".to_string(),
            track_ids: vec!["t1".to_string()],
            created_at: 2,
        };
        db.save_library("usr-1", &[track("t1", "One")], &[playlist], 42)
            .await
            .unwrap();
        let library = db.get_library("usr-1").await.unwrap();
        assert_eq!(library.updated_at, 42);
        assert_eq!(library.tracks.len(), 1);
        assert_eq!(library.tracks[0].title, "One");
        assert_eq!(library.playlists[0].track_ids, vec!["t1"]);

        db.upsert_track("usr-1", &track("t2", "Two")).await.unwrap();
        let library = db.get_library("usr-1").await.unwrap();
        assert_eq!(library.tracks.len(), 2);

        db.update_preferences("usr-1", r#"{"theme":"paper"}"#)
            .await
            .unwrap();
        let found = db.find_user_by_id("usr-1").await.unwrap().unwrap();
        assert_eq!(found.preferences_json, r#"{"theme":"paper"}"#);

        db.set_meta("k", "v").await.unwrap();
        assert_eq!(db.get_meta("k").await.unwrap().as_deref(), Some("v"));

        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn duplicate_accounts_are_rejected() {
        let root = temp_root("duplicates");
        let db = Db::connect(&root.join("aurora.db")).await.expect("connect");
        db.insert_user(&user("usr-1", "a@example.com", "alpha"))
            .await
            .unwrap();

        let email_conflict = db
            .insert_user(&user("usr-2", "A@example.com", "beta"))
            .await;
        assert!(email_conflict.is_err());

        let username_conflict = db
            .insert_user(&user("usr-3", "c@example.com", "ALPHA"))
            .await;
        assert!(username_conflict.is_err());

        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
