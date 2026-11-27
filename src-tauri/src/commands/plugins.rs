use serde_json::Value;
use tauri::State;

use crate::auth::service::{current_user, require_user};
use crate::error::{AppError, AppResult};
use crate::marketplace;
use crate::models::preferences::UserPreferences;
use crate::services::preferences::{normalize_preferences_with_fallback, preferences_to_value};
use crate::state::AppState;

const KNOWN_PLUGIN_IDS: [&str; 4] = ["jam", "lyricsOverlay", "equalizer", "ytdlp"];

#[tauri::command]
pub async fn get_plugin_state(state: State<'_, AppState>) -> AppResult<Value> {
    let user = current_user(&state).await?;
    let (authenticated, preferences) = match user {
        Some(user) => (true, user.preferences()),
        None => (false, UserPreferences::default()),
    };

    Ok(serde_json::json!({
        "plugins": marketplace::plugin_catalog(),
        "enabled": preferences.plugins,
        "communityEnabled": preferences.community_plugins,
        "authenticated": authenticated,
    }))
}

#[tauri::command]
pub async fn save_plugin_state(
    state: State<'_, AppState>,
    id: Option<String>,
    enabled: Option<bool>,
    plugins: Option<Value>,
) -> AppResult<Value> {
    let user = require_user(&state).await?;
    let db = state.db().await?;
    let mut preferences = user.preferences();

    let incoming = match id {
        Some(id) => {
            if !KNOWN_PLUGIN_IDS.contains(&id.as_str()) {
                return Err(AppError::bad_request("Unknown plugin id."));
            }
            let mut next = preferences.plugins.clone();
            match id.as_str() {
                "jam" => next.jam = enabled.unwrap_or(false),
                "lyricsOverlay" => next.lyrics_overlay = enabled.unwrap_or(false),
                "equalizer" => next.equalizer = enabled.unwrap_or(false),
                "ytdlp" => next.yt_dlp = enabled.unwrap_or(false),
                _ => {}
            }
            Some(serde_json::to_value(next)?)
        }
        None => plugins.or(enabled.map(|value| serde_json::json!(value))),
    };

    if let Some(incoming) = incoming {
        let normalized = normalize_preferences_with_fallback(
            &serde_json::json!({ "plugins": incoming }),
            &preferences,
        );
        preferences.plugins = normalized.plugins;
    }

    db.update_preferences(&user.id, &serde_json::to_string(&preferences)?)
        .await?;

    Ok(serde_json::json!({
        "ok": true,
        "plugins": marketplace::plugin_catalog(),
        "enabled": preferences.plugins,
    }))
}

#[tauri::command]
pub async fn save_preferences(state: State<'_, AppState>, preferences: Value) -> AppResult<Value> {
    let user = require_user(&state).await?;
    let current = user.preferences();
    let normalized = normalize_preferences_with_fallback(&preferences, &current);

    state
        .db()
        .await?
        .update_preferences(&user.id, &serde_json::to_string(&normalized)?)
        .await?;

    Ok(serde_json::json!({
        "ok": true,
        "preferences": preferences_to_value(&normalized),
    }))
}

#[tauri::command]
pub async fn list_community_plugins(state: State<'_, AppState>) -> AppResult<Value> {
    let user = current_user(&state).await?;
    let uploaded = match user.as_ref() {
        Some(user) => marketplace::list(&state, Some(&user.id)).await?,
        None => Vec::new(),
    };

    Ok(serde_json::json!({
        "uploaded": uploaded,
        "authenticated": user.is_some(),
    }))
}

#[tauri::command]
pub async fn upload_community_plugin(
    state: State<'_, AppState>,
    file_data: String,
    file_name: String,
    name: String,
    author: String,
    version: String,
    description: String,
) -> AppResult<Value> {
    let user = require_user(&state).await?;
    let plugin = marketplace::upload(
        &state,
        &user.id,
        &file_data,
        &file_name,
        &name,
        &author,
        &version,
        &description,
    )
    .await?;
    Ok(serde_json::json!({ "ok": true, "plugin": plugin }))
}

#[tauri::command]
pub async fn delete_community_plugin(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    let user = require_user(&state).await?;
    marketplace::delete(&state, &user.id, &id).await?;
    Ok(serde_json::json!({ "ok": true, "id": id }))
}

#[tauri::command]
pub async fn read_community_plugin(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    let user = require_user(&state).await?;
    let source = marketplace::read_source(&state, &user.id, &id).await?;
    Ok(serde_json::json!({ "source": source }))
}
