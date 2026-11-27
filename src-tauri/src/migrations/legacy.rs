use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::database::now_ms;
use crate::error::{AppError, AppResult};
use crate::media::mime::AUDIO_EXTENSIONS;
use crate::models::library::Playlist;
use crate::models::track::Track;
use crate::services::library::{filter_playlist_tracks, sanitize_playlist, sanitize_track};
use crate::services::preferences::normalize_preferences_json;
use crate::state::AppState;
use crate::storage::safe_file_name;

fn string(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn number(value: Option<&Value>, fallback: i64) -> i64 {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value as i64)
        .unwrap_or(fallback)
}

fn boolean(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

async fn user_exists(pool: &sqlx::SqlitePool, user_id: &str) -> Result<bool, sqlx::Error> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

pub async fn import_legacy_data(
    state: &AppState,
    json_path: &Path,
    media_root: Option<&Path>,
) -> AppResult<Value> {
    let raw = tokio::fs::read_to_string(json_path)
        .await
        .map_err(|error| {
            AppError::bad_request(format!("Could not read {}: {error}", json_path.display()))
        })?;
    let data: Value = serde_json::from_str(&raw).map_err(|error| {
        AppError::bad_request(format!("The legacy database is not valid JSON: {error}"))
    })?;

    // Backup first; never touch the original file.
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let backup = state
        .paths
        .backups_dir
        .join(format!("aurora-db-{stamp}.json"));
    tokio::fs::copy(json_path, &backup).await?;

    let legacy_root = json_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let media_root = media_root
        .map(Path::to_path_buf)
        .unwrap_or_else(|| legacy_root.join("media"));

    let now = now_ms();
    let users = data
        .get("users")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sessions = data
        .get("sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let challenges = data
        .get("challenges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let libraries = data
        .get("libraries")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let plugins = data
        .get("plugins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let db = state.db().await?;
    let pool = db.pool.clone();

    let mut imported_users = 0usize;
    let mut imported_sessions = 0usize;
    let mut imported_tracks = 0usize;
    let mut imported_plugins = 0usize;
    let mut imported_sends = 0usize;
    let mut library_owners = 0usize;

    for entry in &users {
        let Some(raw) = entry.as_object() else {
            continue;
        };
        let id = string(raw.get("id"), "");
        let email = string(raw.get("email"), "").to_lowercase();
        let username = string(raw.get("username"), "");
        let password_hash = string(raw.get("passwordHash"), "");
        if id.is_empty() || email.is_empty() || username.is_empty() || password_hash.is_empty() {
            continue;
        }

        let two_factor = raw.get("twoFactor");
        let preferences = raw
            .get("preferences")
            .map(normalize_preferences_json)
            .unwrap_or_default();
        let preferences_json =
            serde_json::to_string(&preferences).unwrap_or_else(|_| "{}".to_string());

        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO users (
                id, email, username, password_hash, created_at, updated_at,
                two_factor_enabled, two_factor_method, totp_secret,
                pending_totp_secret, email_two_factor_enabled,
                two_factor_enabled_at, failed_attempts, locked_until, preferences
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(&email)
        .bind(&username)
        .bind(&password_hash)
        .bind(number(raw.get("createdAt"), now))
        .bind(number(raw.get("updatedAt"), now))
        .bind(boolean(two_factor.and_then(|value| value.get("enabled"))) as i64)
        .bind(string(
            two_factor.and_then(|value| value.get("method")),
            "totp",
        ))
        .bind(
            two_factor
                .and_then(|value| value.get("totpSecret"))
                .and_then(Value::as_str),
        )
        .bind(
            two_factor
                .and_then(|value| value.get("pendingTotpSecret"))
                .and_then(Value::as_str),
        )
        .bind(boolean(two_factor.and_then(|value| value.get("emailEnabled"))) as i64)
        .bind(
            two_factor
                .and_then(|value| value.get("enabledAt"))
                .and_then(Value::as_i64),
        )
        .bind(number(raw.get("failedAttempts"), 0))
        .bind(number(raw.get("lockedUntil"), 0))
        .bind(&preferences_json)
        .execute(&pool)
        .await?;
        if result.rows_affected() > 0 {
            imported_users += 1;
        }

        let user_imported = user_exists(&pool, &id).await?;
        if user_imported {
            if let Some(sends) = raw.get("emailCodeSends").and_then(Value::as_array) {
                for send in sends {
                    let Some(sent_at) = send.as_i64() else {
                        continue;
                    };
                    if sent_at <= now - 15 * 60 * 1000 {
                        continue;
                    }
                    let result = sqlx::query(
                    "INSERT INTO email_sends (user_id, sent_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM email_sends WHERE user_id = ? AND sent_at = ?)",
                )
                .bind(&id)
                .bind(sent_at)
                .bind(&id)
                .bind(sent_at)
                .execute(&pool)
                .await?;
                    imported_sends += result.rows_affected() as usize;
                }
            }
        }
    }

    for entry in &sessions {
        let Some(raw) = entry.as_object() else {
            continue;
        };
        let token_hash = string(raw.get("tokenHash"), "");
        let user_id = string(raw.get("userId"), "");
        let expires_at = number(raw.get("expiresAt"), 0);
        if token_hash.is_empty() || user_id.is_empty() || expires_at <= now {
            continue;
        }
        if !user_exists(&pool, &user_id).await? {
            continue;
        }
        let result = sqlx::query(
            "INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&token_hash)
        .bind(&user_id)
        .bind(number(raw.get("createdAt"), now))
        .bind(expires_at)
        .bind(raw.get("userAgent").and_then(Value::as_str))
        .execute(&pool)
        .await?;
        imported_sessions += result.rows_affected() as usize;
    }

    for entry in &challenges {
        let Some(raw) = entry.as_object() else {
            continue;
        };
        let id = string(raw.get("id"), "");
        let user_id = string(raw.get("userId"), "");
        let expires_at = number(raw.get("expiresAt"), 0);
        if id.is_empty() || user_id.is_empty() || expires_at <= now {
            continue;
        }
        if !user_exists(&pool, &user_id).await? {
            continue;
        }
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO challenges (
                id, user_id, method, purpose, email_code_hash,
                created_at, expires_at, attempts, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(&user_id)
        .bind(string(raw.get("method"), "totp"))
        .bind(string(raw.get("purpose"), "login"))
        .bind(raw.get("emailCodeHash").and_then(Value::as_str))
        .bind(number(raw.get("createdAt"), now))
        .bind(expires_at)
        .bind(number(raw.get("attempts"), 0))
        .bind(raw.get("consumedAt").and_then(Value::as_i64))
        .execute(&pool)
        .await?;
    }

    for (user_id, payload) in &libraries {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&pool)
            .await?;
        if exists.is_none() {
            continue;
        }

        let tracks: Vec<_> = payload
            .get("tracks")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(sanitize_track).collect())
            .unwrap_or_default();
        let playlists: Vec<_> = payload
            .get("playlists")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(sanitize_playlist).collect())
            .unwrap_or_default();

        let current = db.get_library(user_id).await?;
        // Imports are additive: never replace a track or rename a playlist
        // that already exists in SQLite. This keeps the importer idempotent
        // and protects data written by a newer desktop build.
        let merged_tracks = merge_tracks_keep_existing(&current.tracks, &tracks);
        let merged_playlists = merge_playlists_keep_existing(&current.playlists, &playlists);
        let playlists = filter_playlist_tracks(&merged_tracks, &merged_playlists);
        let imported_new = merged_tracks.len().saturating_sub(current.tracks.len());
        let legacy_updated_at = number(payload.get("updatedAt"), 0);
        let content_changed =
            merged_tracks != current.tracks || merged_playlists != current.playlists;
        let updated_at = if content_changed {
            current.updated_at.max(legacy_updated_at).max(now)
        } else {
            current.updated_at
        };

        db.save_library(user_id, &merged_tracks, &playlists, updated_at)
            .await?;
        imported_tracks += imported_new;
        library_owners += 1;
    }

    let mut media_copied = 0usize;
    for bucket in ["downloads", "uploads"] {
        let Some(target_root) = state.paths.media_bucket(bucket) else {
            continue;
        };
        let source_root = media_root.join(bucket);
        let target_root = target_root.to_path_buf();
        media_copied +=
            tokio::task::spawn_blocking(move || copy_audio_files(&source_root, &target_root))
                .await
                .unwrap_or(0);
    }

    for entry in &plugins {
        let Some(raw) = entry.as_object() else {
            continue;
        };
        let id = string(raw.get("id"), "");
        if !crate::plugins::is_plugin_id(&id) {
            continue;
        }
        let source_name = string(raw.get("filePath"), "");
        let Some(raw_name) = Path::new(&source_name)
            .file_name()
            .and_then(|value| value.to_str())
        else {
            continue;
        };
        let file_name = safe_file_name(raw_name, "plugin.js");
        if !file_name.ends_with(".js") {
            continue;
        }

        let candidates = [
            legacy_root.join("plugins").join(&file_name),
            media_root
                .parent()
                .unwrap_or(&media_root)
                .join("plugins")
                .join(&file_name),
            PathBuf::from(&source_name),
        ];
        let Some(source) = candidates.iter().find(|path| path.is_file()) else {
            continue;
        };

        let target_name = format!("{id}.js");
        let target = state.paths.plugins_dir.join(&target_name);
        if !target.exists() {
            tokio::fs::copy(source, &target).await?;
        }

        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO plugins (
                id, name, version, author, description, file_name,
                owner_id, owner_name, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(string(raw.get("name"), "Imported plugin"))
        .bind(string(raw.get("version"), "1.0.0"))
        .bind(string(raw.get("author"), "Unknown author"))
        .bind(string(raw.get("description"), ""))
        .bind(&target_name)
        .bind(string(raw.get("ownerId"), ""))
        .bind(string(raw.get("ownerName"), "Unknown owner"))
        .bind(number(raw.get("createdAt"), now))
        .execute(&pool)
        .await?;
        imported_plugins += result.rows_affected() as usize;
    }

    db.set_meta("legacy_imported", &json_path.to_string_lossy())
        .await?;
    db.set_meta("legacy_imported_at", &now.to_string()).await?;

    Ok(serde_json::json!({
        "ok": true,
        "users": imported_users,
        "sessions": imported_sessions,
        "libraries": library_owners,
        "tracks": imported_tracks,
        "plugins": imported_plugins,
        "emailSends": imported_sends,
        "mediaCopied": media_copied,
        "backupPath": backup.to_string_lossy(),
    }))
}

/// Adds tracks that do not exist yet. Existing tracks always win, which makes
/// repeated imports safe even if the JSON file is older than SQLite.
fn merge_tracks_keep_existing(current: &[Track], incoming: &[Track]) -> Vec<Track> {
    let mut result = current.to_vec();
    let mut seen: HashSet<String> = current.iter().map(|track| track.id.clone()).collect();
    for track in incoming {
        if seen.insert(track.id.clone()) {
            result.push(track.clone());
        }
    }
    result
}

/// Adds missing playlists and unions track ids into existing playlists without
/// renaming or re-creating anything the user already has.
fn merge_playlists_keep_existing(current: &[Playlist], incoming: &[Playlist]) -> Vec<Playlist> {
    let mut result = current.to_vec();
    for playlist in incoming {
        match result.iter_mut().find(|item| item.id == playlist.id) {
            Some(existing) => {
                for track_id in &playlist.track_ids {
                    if !existing.track_ids.contains(track_id) {
                        existing.track_ids.push(track_id.clone());
                    }
                }
            }
            None => result.push(playlist.clone()),
        }
    }
    result
}

fn copy_audio_files(source_root: &Path, target_root: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(source_root) else {
        return 0;
    };
    let mut count = 0;
    let mut seen = HashSet::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !seen.insert(file_name.to_string()) {
            continue;
        }
        let target = target_root.join(file_name);
        let already_present = std::fs::metadata(&target)
            .map(|meta| meta.is_file() && meta.len() > 0)
            .unwrap_or(false);
        if already_present {
            continue;
        }
        if let Ok(metadata) = std::fs::metadata(&path) {
            if !metadata.is_file() || metadata.len() == 0 {
                continue;
            }
        }
        if std::fs::copy(&path, &target).is_ok() {
            count += 1;
        }
    }
    count
}

/// Only imports automatically when the SQLite database has no users and the
/// legacy JSON has not been processed yet. Never overwrites existing data.
pub async fn auto_import(state: &AppState) -> Option<Value> {
    let db = state.db().await.ok()?;
    let users: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&db.pool)
        .await
        .ok()?;
    if users.0 > 0 {
        return None;
    }
    if db
        .get_meta("legacy_imported")
        .await
        .ok()
        .flatten()
        .is_some()
    {
        return None;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(value) = std::env::var_os("AURORA_LEGACY_DATA_DIR") {
        candidates.push(PathBuf::from(value));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../aurora-music-player/data"));
        candidates.push(cwd.join("../../aurora-music-player/data"));
        candidates.push(cwd.join("data"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("data"));
        }
    }

    for candidate in candidates {
        let json_path = candidate.join("aurora-db.json");
        if !json_path.is_file() {
            continue;
        }
        log::info!("importing legacy Aurora data from {}", json_path.display());
        match import_legacy_data(state, &json_path, None).await {
            Ok(stats) => return Some(stats),
            Err(error) => log::warn!("legacy auto-import failed: {}", error.message),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::json;

    fn write_legacy_fixture(root: &Path, track_title: &str) -> PathBuf {
        let media = root.join("media").join("downloads");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("song.mp3"), b"not-a-real-mp3").unwrap();

        let plugins = root.join("plugins");
        std::fs::create_dir_all(&plugins).unwrap();
        std::fs::write(
            plugins.join("plg-demo.js"),
            "export default function init() {}",
        )
        .unwrap();

        let now = now_ms();
        let db = json!({
            "version": 1,
            "createdAt": 1,
            "users": [{
                "id": "usr-legacy",
                "email": "legacy@example.com",
                "username": "legacy",
                "passwordHash": "scrypt$16384$8$1$00112233445566778899aabbccddeeff$fcd5a58d5301bbc44e90fc9a53f156134baee795eb7735ed6473da86e34ba93009476236665814fe08f7bd38ad1f5a2709832fb447b93b94e1a4a94dc5d1442e",
                "createdAt": 1,
                "updatedAt": 2,
                "twoFactor": {
                    "enabled": false,
                    "method": "totp",
                    "emailEnabled": false
                },
                "failedAttempts": 0,
                "lockedUntil": 0,
                "preferences": {
                    "theme": "amber",
                    "plugins": { "jam": false, "lyricsOverlay": true, "equalizer": false },
                    "communityPlugins": {},
                    "customCss": "",
                    "playerCustomization": { "background": "#120d08", "accentColor": "#f59e0b", "fontSize": 16 }
                }
            }],
            "sessions": [{
                "tokenHash": "legacy-session-hash",
                "userId": "usr-legacy",
                "createdAt": now,
                "expiresAt": now + 86_400_000,
                "userAgent": "legacy"
            }],
            "challenges": [],
            "libraries": {
                "usr-legacy": {
                    "tracks": [{
                        "id": "song",
                        "title": track_title,
                        "author": "Legacy Artist",
                        "duration": 180,
                        "thumbnail": "",
                        "url": "/api/media/downloads/song.mp3",
                        "source": "youtube"
                    }],
                    "playlists": [{
                        "id": "pl-legacy",
                        "name": "Legacy Mix",
                        "trackIds": ["song"],
                        "createdAt": 9
                    }],
                    "updatedAt": 10
                }
            },
            "plugins": [{
                "id": "plg-demo",
                "name": "Legacy Demo",
                "version": "1.0.0",
                "author": "Legacy Author",
                "description": "Demo plugin",
                "filePath": "/nonexistent/data/plugins/plg-demo.js",
                "ownerId": "usr-legacy",
                "ownerName": "legacy",
                "createdAt": 3
            }]
        });

        let path = root.join("aurora-db.json");
        std::fs::write(&path, serde_json::to_vec_pretty(&db).unwrap()).unwrap();
        path
    }

    #[tokio::test]
    async fn imports_legacy_json_and_media_idempotently() {
        let root = std::env::temp_dir().join(format!("aurora-legacy-{}", uuid::Uuid::new_v4()));
        let app_root = root.join("app-data");
        let legacy_root = root.join("legacy");
        std::fs::create_dir_all(&legacy_root).unwrap();
        let json_path = write_legacy_fixture(&legacy_root, "Original Title");

        let paths = crate::storage::paths::AppPaths::from_root(app_root).unwrap();
        let state = AppState::new_for_tests(paths);
        let stats = import_legacy_data(&state, &json_path, None)
            .await
            .expect("import");

        assert_eq!(stats["users"], 1);
        assert_eq!(stats["sessions"], 1);
        assert_eq!(stats["tracks"], 1);
        assert_eq!(stats["plugins"], 1);
        assert_eq!(stats["mediaCopied"], 1);

        let db = state.db().await.unwrap();
        let user = db.find_user_by_identifier("legacy").await.unwrap().unwrap();
        assert_eq!(user.id, "usr-legacy");
        assert_eq!(user.preferences().theme, "amber");
        assert_eq!(
            db.session_user_id("legacy-session-hash")
                .await
                .unwrap()
                .as_deref(),
            Some("usr-legacy")
        );

        let library = db.get_library("usr-legacy").await.unwrap();
        assert_eq!(library.tracks[0].title, "Original Title");
        assert_eq!(library.playlists[0].track_ids, vec!["song"]);
        assert!(state.paths.downloads_dir.join("song.mp3").is_file());
        assert!(state.paths.plugins_dir.join("plg-demo.js").is_file());
        assert!(
            db.list_plugins()
                .await
                .unwrap()
                .iter()
                .any(|plugin| plugin.id == "plg-demo")
        );
        assert!(db.get_meta("legacy_imported").await.unwrap().is_some());

        let backup = stats["backupPath"].as_str().unwrap();
        assert!(Path::new(backup).is_file());

        // Re-import with different title: existing SQLite data must win.
        write_legacy_fixture(&legacy_root, "Changed Title");
        let second = import_legacy_data(&state, &json_path, None)
            .await
            .expect("second import");
        assert_eq!(second["users"], 0);
        assert_eq!(second["tracks"], 0);
        assert_eq!(second["plugins"], 0);
        assert_eq!(second["mediaCopied"], 0);

        let library = db.get_library("usr-legacy").await.unwrap();
        assert_eq!(library.tracks[0].title, "Original Title");
        assert_eq!(library.tracks.len(), 1);
        assert_eq!(library.playlists.len(), 1);

        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
