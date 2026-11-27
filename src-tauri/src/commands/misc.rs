use serde_json::Value;
use tauri::State;

use crate::auth::email::send_plain_email;
use crate::auth::totp::qr_data_url;
use crate::error::{AppError, AppResult};
use crate::jam::PublishInput;
use crate::media::ytdlp;
use crate::models::track::Track;
use crate::state::AppState;

/* ------------------------------------------------------------------ */
/*  Jam                                                               */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn jam_publish(
    state: State<'_, AppState>,
    session_id: String,
    track: Option<Track>,
    is_playing: bool,
    progress: f64,
    host_name: Option<String>,
) -> AppResult<Value> {
    let listeners = state.jam.publish(PublishInput {
        session_id: session_id.clone(),
        track,
        is_playing,
        progress,
        host_name,
    })?;
    Ok(serde_json::json!({
        "ok": true,
        "sessionId": session_id,
        "listenersCount": listeners,
    }))
}

#[tauri::command]
pub async fn jam_join(
    state: State<'_, AppState>,
    session_id: String,
    listener_id: Option<String>,
) -> AppResult<Value> {
    let session = state
        .jam
        .join(&session_id, listener_id.as_deref().unwrap_or(""))?;
    Ok(serde_json::json!({ "ok": true, "session": session }))
}

#[tauri::command]
pub async fn jam_poll(state: State<'_, AppState>, session_id: String) -> AppResult<Value> {
    let session = state.jam.poll(&session_id)?;
    Ok(serde_json::json!({ "ok": true, "session": session }))
}

#[tauri::command]
pub async fn jam_leave(
    state: State<'_, AppState>,
    session_id: String,
    listener_id: Option<String>,
) -> AppResult<Value> {
    state
        .jam
        .leave(&session_id, listener_id.as_deref().unwrap_or(""))?;
    Ok(serde_json::json!({ "ok": true }))
}

/* ------------------------------------------------------------------ */
/*  Discord                                                           */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn send_discord_presence(state: State<'_, AppState>, payload: Value) -> AppResult<Value> {
    let active = state.discord.send_activity(payload);
    let status = state.discord.status();
    Ok(serde_json::json!({
        "ok": active,
        "active": active,
        "event": if active { "queued" } else { "unavailable" },
        "error": status.error,
    }))
}

#[tauri::command]
pub async fn clear_discord_presence(state: State<'_, AppState>) -> AppResult<Value> {
    state.discord.clear();
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn discord_probe(state: State<'_, AppState>, app_id: Option<String>) -> AppResult<Value> {
    state.discord.probe(app_id.as_deref());
    // The worker connects with a 7 s timeout; wait for its result so the UI
    // can report a meaningful accepted/rejected state.
    for _ in 0..80 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let status = state.discord.status();
        if status.ready || status.error.is_some() {
            return Ok(serde_json::json!({
                "ok": status.ready,
                "ready": status.ready,
                "appId": status.app_id,
                "activity": status.activity,
                "version": "native-ipc",
                "error": status.error,
            }));
        }
    }
    let status = state.discord.status();
    Ok(serde_json::json!({
        "ok": false,
        "ready": false,
        "appId": status.app_id,
        "activity": status.activity,
        "version": "native-ipc",
        "error": status.error.unwrap_or_else(|| "Discord IPC probe timed out.".to_string()),
    }))
}

#[tauri::command]
pub async fn discord_status(state: State<'_, AppState>) -> AppResult<Value> {
    let status = state.discord.status();
    Ok(serde_json::json!({
        "ok": true,
        "ready": status.ready,
        "appId": status.app_id,
        "activity": status.activity,
        "version": "native-ipc",
        "error": status.error,
    }))
}

/* ------------------------------------------------------------------ */
/*  Diagnostics                                                       */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn ytdlp_status(state: State<'_, AppState>) -> AppResult<Value> {
    Ok(serde_json::to_value(ytdlp::status(&state.paths).await)?)
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn generate_qr_code(data: String, size: Option<u32>) -> AppResult<Value> {
    let _ = size;
    if data.trim().is_empty() {
        return Err(AppError::bad_request("Missing QR payload."));
    }
    let data_uri =
        qr_data_url(&data).ok_or_else(|| AppError::internal("Could not render the QR code."))?;
    Ok(serde_json::json!({ "dataUri": data_uri }))
}

#[tauri::command]
pub async fn send_email(
    state: State<'_, AppState>,
    to: String,
    subject: String,
    body: String,
) -> AppResult<Value> {
    if to.trim().is_empty() || subject.trim().is_empty() {
        return Err(AppError::bad_request("Recipient and subject are required."));
    }
    let result = send_plain_email(&state.paths, to.trim(), subject.trim(), body).await;
    Ok(serde_json::json!({
        "delivered": result.delivered,
        "reason": result.reason,
    }))
}

/* ------------------------------------------------------------------ */
/*  Linux desktop integration                                         */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn audio_integration_status() -> AppResult<Value> {
    Ok(serde_json::to_value(crate::desktop::status()?)?)
}

// AURORA_FIX_MISC_RESTORE_CMD_V1
#[tauri::command]
pub async fn set_default_music_player() -> AppResult<Value> {
    Ok(serde_json::to_value(crate::desktop::set_default_player()?)?)
}

#[tauri::command]
pub async fn restore_default_music_player() -> AppResult<Value> {
    Ok(serde_json::to_value(crate::desktop::restore_default_player()?)?)
}

#[tauri::command]
pub async fn take_startup_audio(state: State<'_, AppState>) -> AppResult<Value> {
    let paths = crate::desktop::startup_audio_paths();
    let mut tracks = Vec::new();
    for path in paths {
        match crate::commands::media::import_audio_path(&state, &path).await {
            Ok(track) => tracks.push(track),
            Err(error) => log::warn!("could not open startup audio {}: {}", path.display(), error),
        }
    }
    Ok(serde_json::json!({ "tracks": tracks }))
}

#[tauri::command]
pub async fn open_external_url(url: String) -> AppResult<Value> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(crate::error::AppError::bad_request(
            "Only http:// and https:// URLs can be opened externally",
        ));
    }

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(trimmed)
        .spawn()
        .map_err(|e| crate::error::AppError::internal(format!("Failed to launch xdg-open: {e}")))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(trimmed)
        .spawn()
        .map_err(|e| crate::error::AppError::internal(format!("Failed to launch open: {e}")))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", trimmed])
        .spawn()
        .map_err(|e| crate::error::AppError::internal(format!("Failed to launch browser: {e}")))?;

    Ok(serde_json::json!({ "ok": true }))
}
