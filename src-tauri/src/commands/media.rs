use std::path::PathBuf;

use base64::Engine;
use serde_json::Value;
use tauri::State;

use crate::auth::service::current_user;
use crate::database::now_ms;
use crate::error::{AppError, AppResult};
use crate::media::metadata::read_duration_seconds;
use crate::media::mime::{is_audio_file, is_audio_upload, legacy_track_url};
use crate::media::storage::{resolve_legacy_media_url, save_upload};
use crate::media::ytdlp;
use crate::models::track::Track;
use crate::networking::lyrics::{best_candidate, fetch_candidates};
use crate::networking::youtube::{clean_artist_name, clean_track_title};
use crate::networking::ytmusic;
use crate::state::AppState;

const MAX_UPLOAD_BYTES: usize = 200 * 1024 * 1024;

/// Imports an audio file selected by the OS or a file manager. Files already in
/// the managed media root are referenced; external files are copied into the
/// uploads directory with a deterministic name so repeated opens do not create
/// duplicate library entries.
pub async fn import_audio_path(state: &AppState, path: &std::path::Path) -> AppResult<Track> {
    let canonical = path.canonicalize().map_err(|error| {
        AppError::bad_request(format!("Could not open {}: {error}", path.display()))
    })?;
    if !canonical.is_file() || !is_audio_file(&canonical) {
        return Err(AppError::bad_request("Unsupported audio file."));
    }
    let metadata = std::fs::metadata(&canonical)?;
    if metadata.len() as usize > MAX_UPLOAD_BYTES {
        return Err(AppError::too_large(
            "Audio files must be smaller than 200 MB.",
        ));
    }

    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp3")
        .to_ascii_lowercase();
    let title = canonical
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Local audio")
        .trim()
        .chars()
        .take(500)
        .collect::<String>();
    let hash = crate::auth::password::sha256_hex(&canonical.to_string_lossy());
    let media_root = state
        .paths
        .media_dir
        .canonicalize()
        .unwrap_or_else(|_| state.paths.media_dir.clone());

    let (file_path, url) = if canonical.starts_with(&media_root) {
        let bucket = if canonical.starts_with(&state.paths.downloads_dir) {
            "downloads"
        } else {
            "uploads"
        };
        let file_name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("audio.mp3");
        (canonical.clone(), legacy_track_url(bucket, file_name))
    } else {
        let file_name = format!(
            "opened-{}-{}.{}",
            &hash[..16],
            crate::storage::random_suffix(4),
            extension
        );
        let target = state.paths.uploads_dir.join(&file_name);
        if !target.is_file() {
            let bytes = tokio::fs::read(&canonical).await?;
            crate::storage::write_private(&target, &bytes)?;
        }
        (target.clone(), legacy_track_url("uploads", &file_name))
    };

    let duration = {
        let path = file_path.clone();
        tokio::task::spawn_blocking(move || read_duration_seconds(&path))
            .await
            .unwrap_or(0)
    };
    let track = Track {
        id: format!("local-{}", &hash[..24]),
        title: if title.is_empty() {
            "Local audio".to_string()
        } else {
            title
        },
        author: "Local file".to_string(),
        album: None,
        duration,
        thumbnail: String::new(),
        url,
        file_path: Some(file_path.to_string_lossy().to_string()),
        source: "local".to_string(),
        cloud_url: None,
        external_uri: Some(canonical.to_string_lossy().to_string()),
        file_size: Some(metadata.len()),
        uploaded_at: Some(now_ms()),
    };

    if let Some(user) = current_user(state).await? {
        state.db().await?.upsert_track(&user.id, &track).await?;
    }
    Ok(track)
}

fn safe_video_id(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
        .take(32)
        .collect()
}

// AURORA_FIX_MEDIA_CMD_YTDLP_V1
#[tauri::command]
pub async fn search_youtube(
    _state: State<'_, AppState>,
    query: String,
    _allow_external: Option<bool>,
) -> AppResult<Value> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err(AppError::bad_request("Missing query parameter \"q\""));
    }

    // Standard music search uses YouTube Music exclusively and never falls back to yt-dlp.
    let music = ytmusic::search_ytmusic(&query, 24).await;
    Ok(serde_json::json!({
        "results": music,
        "source": "youtube-music",
        "external": false,
    }))
}

#[tauri::command]
pub async fn search_youtube_external(
    state: State<'_, AppState>,
    query: String,
    allow_external: Option<bool>,
) -> AppResult<Value> {
    if !allow_external.unwrap_or(false) {
        return Err(AppError::forbidden(
            "Enable the YouTube Downloader (yt-dlp) plugin to use external search.",
        ));
    }
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err(AppError::bad_request("Missing query parameter \"q\""));
    }
    let results = ytdlp::search_fallback(&state.paths, &query, 24).await?;
    Ok(serde_json::json!({
        "results": results,
        "source": "yt-dlp",
        "external": true,
    }))
}

#[tauri::command]
pub async fn download_track(
    state: State<'_, AppState>,
    track_id: String,
    title: String,
    author: String,
    album: Option<String>,
    duration: Option<u64>,
    thumbnail: Option<String>,
    allow_external: Option<bool>,
) -> AppResult<Value> {
    if !allow_external.unwrap_or(false) {
        return Err(AppError::forbidden(
            "Enable the YouTube Downloader (yt-dlp) plugin before downloading.",
        ));
    }
    let id = safe_video_id(&track_id);
    if id.is_empty() {
        return Err(AppError::bad_request("Invalid id"));
    }

    let file_name = format!("{id}.mp3");
    let cached = std::fs::metadata(state.paths.downloads_dir.join(&file_name))
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false);
    let absolute = ytdlp::download_audio(&state.paths, &id)
        .await
        .map_err(|error| {
            let hint = if error.message.contains("Sign in to confirm") {
                " YouTube is asking for a sign-in/bot check. Export cookies and set AURORA_YTDLP_COOKIES to a cookies.txt file."
            } else if error.message.contains("ffmpeg") {
                " ffmpeg is required to convert audio to MP3. Install ffmpeg and restart Aurora."
            } else {
                ""
            };
            AppError::internal(format!("{}{hint}", error.message))
        })?;
    let url = legacy_track_url("downloads", &file_name);

    let fallback_artist = clean_artist_name(&author, "Unknown artist");
    let fallback_title = clean_track_title(&title, &fallback_artist);
    let music = if !cached || title.trim().is_empty() {
        ytmusic::get_ytmusic_track(&id).await
    } else {
        None
    };

    let resolved_title = music
        .as_ref()
        .map(|item| item.title.clone())
        .unwrap_or(fallback_title);
    let resolved_artist = music
        .as_ref()
        .map(|item| item.artist.clone())
        .unwrap_or(fallback_artist);
    let resolved_album = album
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| music.as_ref().and_then(|item| item.album.clone()));
    let resolved_duration = music
        .as_ref()
        .map(|item| item.duration)
        .filter(|value| *value > 0)
        .unwrap_or(duration.unwrap_or(0));
    let resolved_thumbnail = music
        .as_ref()
        .map(|item| item.thumbnail.clone())
        .filter(|value| !value.is_empty())
        .or(thumbnail)
        .unwrap_or_default();

    let track = Track {
        id: id.clone(),
        title: resolved_title.chars().take(500).collect(),
        author: resolved_artist.chars().take(300).collect(),
        album: resolved_album.map(|value| value.chars().take(300).collect()),
        duration: resolved_duration,
        thumbnail: resolved_thumbnail.chars().take(4096).collect(),
        url: url.clone(),
        file_path: Some(absolute.to_string_lossy().to_string()),
        source: "youtube".to_string(),
        cloud_url: None,
        external_uri: None,
        file_size: std::fs::metadata(&absolute).ok().map(|meta| meta.len()),
        uploaded_at: Some(now_ms()),
    };

    if let Some(user) = current_user(&state).await? {
        state.db().await?.upsert_track(&user.id, &track).await?;
    }

    Ok(serde_json::json!({
        "url": url,
        "filename": file_name,
        "cached": cached,
        "track": track,
    }))
}

#[tauri::command]
pub async fn upload_local_file(
    state: State<'_, AppState>,
    file_data: String,
    file_name: String,
    mime_type: Option<String>,
) -> AppResult<Value> {
    let mime_type = mime_type.unwrap_or_default();
    if !is_audio_upload(&file_name, &mime_type) {
        return Err(AppError::bad_request(
            "Only audio files (.mp3, .wav, .ogg, .m4a, .flac) are accepted",
        ));
    }

    let encoded: String = file_data.chars().filter(|ch| !ch.is_whitespace()).collect();
    if encoded.len() > MAX_UPLOAD_BYTES * 2 {
        return Err(AppError::too_large(
            "Audio files must be smaller than 200 MB.",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&encoded)
        .map_err(|_| AppError::bad_request("The uploaded file could not be decoded."))?;
    if bytes.is_empty() {
        return Err(AppError::bad_request("No audio file provided"));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::too_large(
            "Audio files must be smaller than 200 MB.",
        ));
    }

    let (saved, title) = save_upload(&state.paths, &bytes, &file_name)?;
    let duration = {
        let path: PathBuf = saved.file_path.clone();
        tokio::task::spawn_blocking(move || read_duration_seconds(&path))
            .await
            .unwrap_or(0)
    };

    let timestamp = now_ms();
    let track = Track {
        id: format!("cloud-{timestamp}-{}", crate::storage::random_suffix(6)),
        title: title.chars().take(500).collect(),
        author: "Uploaded audio".to_string(),
        album: None,
        duration,
        thumbnail: String::new(),
        url: saved.url.clone(),
        file_path: Some(saved.file_path.to_string_lossy().to_string()),
        source: "cloud".to_string(),
        cloud_url: Some(saved.url.clone()),
        external_uri: None,
        file_size: Some(bytes.len() as u64),
        uploaded_at: Some(timestamp),
    };

    if let Some(user) = current_user(&state).await? {
        state.db().await?.upsert_track(&user.id, &track).await?;
    }

    Ok(serde_json::json!({
        "ok": true,
        "trackId": track.id,
        "track": track,
        "url": saved.url,
        "fileName": saved.file_name,
        "title": title,
        "size": bytes.len(),
        "storage": "local_media",
    }))
}

#[tauri::command]
pub async fn fetch_lyrics(
    artist: String,
    title: String,
    provider: Option<String>,
) -> AppResult<Value> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return Err(AppError::bad_request("Missing artist or title"));
    }
    let provider = provider.unwrap_or_else(|| "lrclib".to_string());
    if provider != "lrclib" && provider != "lyricsovh" {
        return Err(AppError::bad_request("Unknown lyrics provider."));
    }
    let candidates = fetch_candidates(&artist, &title, &provider)
        .await
        .map_err(AppError::internal)?;
    let selected = best_candidate(&candidates);
    Ok(serde_json::json!({
        "provider": provider,
        "candidates": candidates,
        "plainLyrics": selected.and_then(|candidate| candidate.plain_lyrics.clone()),
        "syncedLyrics": selected.and_then(|candidate| candidate.synced_lyrics.clone()),
    }))
}

#[tauri::command]
pub async fn resolve_media_url(state: State<'_, AppState>, url: String) -> AppResult<Value> {
    let file_path =
        resolve_legacy_media_url(&state.paths, &url).map(|path| path.to_string_lossy().to_string());
    Ok(serde_json::json!({ "url": url, "filePath": file_path }))
}
