use std::path::PathBuf;

use base64::Engine;
use serde_json::Value;

use crate::auth::password::generate_id;
use crate::database::now_ms;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{CommunityPlugin, PluginRecord};
use crate::state::AppState;

pub const MAX_PLUGIN_BYTES: usize = 500 * 1024;
pub const MAX_PLUGIN_NAME_LENGTH: usize = 80;
pub const MAX_PLUGIN_VERSION_LENGTH: usize = 32;
pub const MAX_PLUGIN_AUTHOR_LENGTH: usize = 80;
pub const MAX_PLUGIN_DESCRIPTION_LENGTH: usize = 600;

pub fn is_plugin_id(value: &str) -> bool {
    if value.len() > 68 || !value.starts_with("plg-") {
        return false;
    }
    !value[4..].is_empty()
        && value[4..]
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

pub fn plugin_file_name(id: &str) -> String {
    format!("{id}.js")
}

pub fn resolve_plugin_file(paths: &crate::storage::paths::AppPaths, id: &str) -> Option<PathBuf> {
    if !is_plugin_id(id) {
        return None;
    }
    let candidate = paths.plugins_dir.join(plugin_file_name(id));
    candidate.is_file().then_some(candidate)
}

pub fn validate_source(source: &str) -> AppResult<()> {
    if source.trim().is_empty() {
        return Err(AppError::bad_request("The plugin file is empty."));
    }
    if source.len() > MAX_PLUGIN_BYTES {
        return Err(AppError::too_large(
            "Plugin files must be 500 KB or smaller.",
        ));
    }
    if source.contains('\0') {
        return Err(AppError::bad_request(
            "The plugin file contains invalid null bytes.",
        ));
    }
    Ok(())
}

fn trim_field(value: Option<&Value>, max: usize, fallback: &str) -> String {
    let text = value
        .and_then(Value::as_str)
        .unwrap_or("")
        .replace('\0', "");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        fallback.chars().take(max).collect()
    } else {
        trimmed.chars().take(max).collect()
    }
}

#[allow(clippy::too_many_arguments)] // public plugin metadata, validated field by field
pub async fn upload(
    state: &AppState,
    user_id: &str,
    file_data: &str,
    file_name: &str,
    name: &str,
    author: &str,
    version: &str,
    description: &str,
) -> AppResult<CommunityPlugin> {
    if !file_name.to_ascii_lowercase().ends_with(".js") {
        return Err(AppError::bad_request("Only .js plugin files are accepted."));
    }
    if file_data.len() > MAX_PLUGIN_BYTES * 2 {
        return Err(AppError::too_large(
            "Plugin files must be 500 KB or smaller.",
        ));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_data)
        .map_err(|_| AppError::bad_request("The plugin file could not be decoded."))?;
    if bytes.is_empty() {
        return Err(AppError::bad_request("The plugin file is empty."));
    }
    if bytes.len() > MAX_PLUGIN_BYTES {
        return Err(AppError::too_large(
            "Plugin files must be 500 KB or smaller.",
        ));
    }
    let source = String::from_utf8(bytes)
        .map_err(|_| AppError::bad_request("Plugin files must be UTF-8 JavaScript."))?;
    validate_source(&source)?;

    let name = trim_field(
        Some(&Value::String(name.to_string())),
        MAX_PLUGIN_NAME_LENGTH,
        "",
    );
    if name.is_empty() {
        return Err(AppError::bad_request("Plugin name is required."));
    }
    let version = trim_field(
        Some(&Value::String(version.to_string())),
        MAX_PLUGIN_VERSION_LENGTH,
        "1.0.0",
    );
    let author = trim_field(
        Some(&Value::String(author.to_string())),
        MAX_PLUGIN_AUTHOR_LENGTH,
        "Unknown author",
    );
    let description = trim_field(
        Some(&Value::String(description.to_string())),
        MAX_PLUGIN_DESCRIPTION_LENGTH,
        "",
    );

    let id = generate_id("plg");
    let file_name = plugin_file_name(&id);
    let absolute = state.paths.plugins_dir.join(&file_name);

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&absolute)?;
    use std::io::Write;
    file.write_all(source.as_bytes())?;
    file.sync_all()?;

    let user = state
        .db()
        .await?
        .find_user_by_id(user_id)
        .await?
        .ok_or_else(|| AppError::unauthorized("Sign in to upload community plugins."))?;

    let record = PluginRecord {
        id: id.clone(),
        name,
        version,
        author,
        description,
        file_path: file_name,
        enabled_state: false,
        owner_id: user.id.clone(),
        owner_name: user.username.clone(),
        created_at: now_ms(),
    };

    if let Err(error) = state.db().await?.insert_plugin(&record).await {
        let _ = std::fs::remove_file(&absolute);
        return Err(error);
    }

    let preferences = user.preferences();
    let enabled = preferences
        .community_plugins
        .get(&id)
        .copied()
        .unwrap_or(record.enabled_state);
    Ok(CommunityPlugin::from_record(record, enabled, true))
}

pub async fn list(state: &AppState, user_id: Option<&str>) -> AppResult<Vec<CommunityPlugin>> {
    let db = state.db().await?;
    let records = db.list_plugins().await?;
    let preferences = match user_id {
        Some(id) => db
            .find_user_by_id(id)
            .await?
            .map(|user| user.preferences())
            .unwrap_or_default(),
        None => Default::default(),
    };

    Ok(records
        .into_iter()
        .map(|record| {
            let enabled = preferences
                .community_plugins
                .get(&record.id)
                .copied()
                .unwrap_or(record.enabled_state);
            let can_delete = user_id == Some(record.owner_id.as_str());
            CommunityPlugin::from_record(record, enabled, can_delete)
        })
        .collect())
}

pub async fn read_source(state: &AppState, _user_id: &str, id: &str) -> AppResult<String> {
    if !is_plugin_id(id) {
        return Err(AppError::not_found("Plugin not found."));
    }
    let db = state.db().await?;
    if db.find_plugin(id).await?.is_none() {
        return Err(AppError::not_found("Plugin not found."));
    }
    let path = resolve_plugin_file(&state.paths, id)
        .ok_or_else(|| AppError::not_found("Plugin file not found."))?;
    std::fs::read_to_string(path).map_err(|_| AppError::not_found("Plugin file not found."))
}

pub async fn delete(state: &AppState, user_id: &str, id: &str) -> AppResult<()> {
    if !is_plugin_id(id) {
        return Err(AppError::not_found("Plugin not found."));
    }
    let db = state.db().await?;
    let Some(record) = db.find_plugin(id).await? else {
        return Err(AppError::not_found("Plugin not found."));
    };
    if record.owner_id != user_id {
        return Err(AppError::forbidden(
            "Only the plugin owner can delete this plugin.",
        ));
    }

    db.delete_plugin(id).await?;

    // Remove the per-user enabled flag from every account.
    for user in db.list_users().await? {
        let mut preferences = user.preferences();
        if preferences.community_plugins.remove(id).is_some() {
            let json = serde_json::to_string(&preferences)?;
            db.update_preferences(&user.id, &json).await?;
        }
    }

    if let Some(path) = resolve_plugin_file(&state.paths, id) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

pub fn plugin_catalog() -> Value {
    serde_json::json!([
        {
            "id": "jam",
            "name": "JAM Session",
            "version": "0.8.0",
            "author": "AuroraMP",
            "description": "Host or join a synchronized Listen Along room and keep Discord listeners in sync.",
            "wip": true,
            "defaultEnabled": false,
            "capabilities": ["sync-playback", "discord-presence", "room-links"]
        },
        {
            "id": "lyricsOverlay",
            "name": "Lyrics Overlay",
            "version": "1.0.0",
            "author": "AuroraMP",
            "description": "Adds the lyrics panel to the player and looks up lyrics for the current track.",
            "wip": false,
            "defaultEnabled": true,
            "capabilities": ["lyrics-lookup", "player-panel"]
        },
        {
            "id": "ytdlp",
            "name": "YouTube Downloader (yt-dlp)",
            "version": "1.0.0",
            "author": "AuroraMP",
            "description": "Optional external integration for yt-dlp searches and MP3 downloads. Disabled by default; requires yt-dlp and ffmpeg.",
            "wip": false,
            "defaultEnabled": false,
            "capabilities": ["external-downloads", "yt-dlp", "local-library"]
        },
        {
            "id": "equalizer",
            "name": "Equalizer",
            "version": "0.1.0",
            "author": "AuroraMP",
            "description": "Feature flag reserved for future Web Audio equalizer and tone controls.",
            "wip": false,
            "defaultEnabled": false,
            "capabilities": ["audio-processing", "presets"]
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::user::UserRecord;
    use crate::state::AppState;

    fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("aurora-plugin-{name}-{}", uuid::Uuid::new_v4()));
        let paths = crate::storage::paths::AppPaths::from_root(root.clone()).expect("paths");
        (AppState::new_for_tests(paths), root)
    }

    async fn seed_user(state: &AppState) {
        state
            .db()
            .await
            .unwrap()
            .insert_user(&UserRecord {
                id: "usr-plugin".to_string(),
                email: "plugin@example.com".to_string(),
                username: "pluginuser".to_string(),
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
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn upload_list_read_and_delete_plugin() {
        let (state, root) = test_state("crud");
        seed_user(&state).await;
        let source = "export default function init(hostAPI) { hostAPI.ui.showToast('hi'); }";
        let encoded = base64::engine::general_purpose::STANDARD.encode(source);

        let plugin = upload(
            &state,
            "usr-plugin",
            &encoded,
            "my-plugin.js",
            "My Plugin",
            "Tester",
            "1.2.3",
            "A test plugin",
        )
        .await
        .expect("upload");
        assert!(plugin.record.id.starts_with("plg-"));
        assert_eq!(plugin.record.name, "My Plugin");
        assert_eq!(plugin.record.version, "1.2.3");
        assert!(plugin.can_delete);
        assert!(!plugin.enabled);
        let file = state.paths.plugins_dir.join(&plugin.record.file_path);
        assert!(file.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        let listed = list(&state, Some("usr-plugin")).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].record.id, plugin.record.id);
        assert!(listed[0].can_delete);

        let read = read_source(&state, "usr-plugin", &plugin.record.id)
            .await
            .unwrap();
        assert_eq!(read, source);

        assert!(
            read_source(&state, "usr-plugin", "../../etc/passwd")
                .await
                .is_err()
        );

        delete(&state, "usr-plugin", &plugin.record.id)
            .await
            .unwrap();
        assert!(!file.exists());
        assert!(list(&state, Some("usr-plugin")).await.unwrap().is_empty());

        let db = state.db().await.unwrap();
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn rejects_non_javascript_and_oversized_names() {
        let (state, root) = test_state("validate");
        seed_user(&state).await;
        let encoded = base64::engine::general_purpose::STANDARD.encode("init(){}");
        let error = upload(
            &state,
            "usr-plugin",
            &encoded,
            "plugin.txt",
            "Nope",
            "",
            "",
            "",
        )
        .await
        .expect_err("extension");
        assert_eq!(error.code, "BAD_REQUEST");

        let long_name = "x".repeat(MAX_PLUGIN_NAME_LENGTH + 20);
        let plugin = upload(
            &state,
            "usr-plugin",
            &encoded,
            "plugin.js",
            &long_name,
            "",
            "",
            "",
        )
        .await
        .expect("long names are truncated");
        assert_eq!(plugin.record.name.chars().count(), MAX_PLUGIN_NAME_LENGTH);

        let db = state.db().await.unwrap();
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
