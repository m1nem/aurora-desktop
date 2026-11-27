use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::Value;
use tauri::State;

use crate::auth::service::require_user;
use crate::database::now_ms;
use crate::error::{AppError, AppResult};
use crate::media::metadata::read_duration_seconds;
use crate::media::mime;
use crate::media::storage::resolve_track_path;
use crate::models::library::{LibraryPayload, RecoverResult};
use crate::models::track::Track;
use crate::services::csv_import;
use crate::services::library::{
    filter_playlist_tracks, merge_playlists, merge_tracks, sanitize_library_payload,
    sanitize_playlist, sanitize_track,
};
use crate::state::AppState;

/// Tracks imported from the legacy JSON database (or any older desktop build)
/// may only carry a `/api/media/...` URL. Resolve those to absolute paths so
/// the WebView can play them through the Tauri asset protocol.
fn hydrate_track_paths(state: &AppState, tracks: &mut [Track]) {
    for track in tracks {
        let has_valid_path = track
            .file_path
            .as_deref()
            .map(|value| std::path::Path::new(value).is_file())
            .unwrap_or(false);
        if has_valid_path {
            continue;
        }
        if let Some(path) = resolve_track_path(&state.paths, track) {
            track.file_path = Some(path.to_string_lossy().to_string());
        }
    }
}

#[tauri::command]
pub async fn get_library(state: State<'_, AppState>) -> AppResult<LibraryPayload> {
    let user = require_user(&state).await?;
    let mut library = state.db().await?.get_library(&user.id).await?;
    hydrate_track_paths(&state, &mut library.tracks);
    Ok(library)
}

#[tauri::command]
pub async fn save_library(
    state: State<'_, AppState>,
    tracks: Vec<Value>,
    playlists: Vec<Value>,
    merge: Option<bool>,
) -> AppResult<LibraryPayload> {
    let user = require_user(&state).await?;

    let parsed_tracks: Vec<Track> = tracks.iter().filter_map(sanitize_track).collect();
    let parsed_playlists: Vec<crate::models::library::Playlist> =
        playlists.iter().filter_map(sanitize_playlist).collect();
    let _ = sanitize_library_payload; // shared contract, exercised by imports

    let db = state.db().await?;
    let current = db.get_library(&user.id).await?;

    let next_tracks = if merge.unwrap_or(false) {
        merge_tracks(&current.tracks, &parsed_tracks)
    } else {
        parsed_tracks
    };
    let next_playlists = if merge.unwrap_or(false) {
        merge_playlists(&current.playlists, &parsed_playlists)
    } else {
        parsed_playlists
    };

    let playlists = filter_playlist_tracks(&next_tracks, &next_playlists);
    let updated_at = now_ms();
    db.save_library(&user.id, &next_tracks, &playlists, updated_at)
        .await?;

    let mut tracks = next_tracks;
    hydrate_track_paths(&state, &mut tracks);

    Ok(LibraryPayload {
        tracks,
        playlists,
        updated_at,
    })
}

#[tauri::command]
pub async fn recover_library(state: State<'_, AppState>) -> AppResult<RecoverResult> {
    let user = require_user(&state).await?;
    let db = state.db().await?;
    let mut library = db.get_library(&user.id).await?;

    let downloads_dir = state.paths.downloads_dir.clone();
    let uploads_dir = state.paths.uploads_dir.clone();

    let (download_files, upload_files) = tokio::task::spawn_blocking(move || {
        (
            scan_audio_files(&downloads_dir),
            scan_audio_files(&uploads_dir),
        )
    })
    .await
    .map_err(|error| AppError::internal(format!("Recovery scan failed: {error}")))?;

    let existing_ids: HashSet<String> = library
        .tracks
        .iter()
        .map(|track| track.id.clone())
        .collect();
    let existing_urls: HashSet<String> = library
        .tracks
        .iter()
        .map(|track| track.url.clone())
        .collect();

    let mut recovered: Vec<Track> = Vec::new();
    let mut metadata_lookups = 25usize;

    for (file_name, base_name) in download_files {
        let url = mime::legacy_track_url("downloads", &file_name);
        if existing_ids.contains(&base_name) || existing_urls.contains(&url) {
            continue;
        }

        let mut title = base_name.clone();
        let mut author = "YouTube".to_string();
        let mut duration = 0u64;
        let mut thumbnail = String::new();

        let looks_like_video_id = base_name.len() == 11
            && base_name
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');
        if looks_like_video_id && metadata_lookups > 0 {
            metadata_lookups -= 1;
            if let Some(meta) = crate::networking::ytmusic::get_ytmusic_track(&base_name).await {
                title = meta.title;
                author = meta.artist;
                duration = meta.duration;
                thumbnail = meta.thumbnail;
            }
        }

        if duration == 0 {
            let path = state.paths.downloads_dir.join(&file_name);
            duration = tokio::task::spawn_blocking(move || read_duration_seconds(&path))
                .await
                .unwrap_or(0);
        }

        recovered.push(Track {
            id: base_name,
            title,
            author,
            album: None,
            duration,
            thumbnail,
            url,
            file_path: Some(
                state
                    .paths
                    .downloads_dir
                    .join(&file_name)
                    .to_string_lossy()
                    .to_string(),
            ),
            source: "youtube".to_string(),
            cloud_url: None,
            external_uri: None,
            file_size: None,
            uploaded_at: Some(now_ms()),
        });
    }

    for (file_name, base_name) in upload_files {
        let url = mime::legacy_track_url("uploads", &file_name);
        if existing_urls.contains(&url) {
            continue;
        }
        let path = state.paths.uploads_dir.join(&file_name);
        let file_size = std::fs::metadata(&path).ok().map(|meta| meta.len());
        let duration = tokio::task::spawn_blocking({
            let path = path.clone();
            move || read_duration_seconds(&path)
        })
        .await
        .unwrap_or(0);

        recovered.push(Track {
            id: format!(
                "cloud-{}-{}",
                path.file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("upload"),
                crate::storage::random_suffix(4)
            ),
            title: base_name,
            author: "Uploaded audio".to_string(),
            album: None,
            duration,
            thumbnail: String::new(),
            url: url.clone(),
            file_path: Some(path.to_string_lossy().to_string()),
            source: "cloud".to_string(),
            cloud_url: Some(url),
            external_uri: None,
            file_size,
            uploaded_at: Some(now_ms()),
        });
    }

    let added = recovered.len();
    hydrate_track_paths(&state, &mut library.tracks);
    hydrate_track_paths(&state, &mut recovered);
    if added > 0 {
        library.tracks = merge_tracks(&library.tracks, &recovered);
        library.playlists = filter_playlist_tracks(&library.tracks, &library.playlists);
        library.updated_at = now_ms();
        db.save_library(
            &user.id,
            &library.tracks,
            &library.playlists,
            library.updated_at,
        )
        .await?;
    }

    Ok(RecoverResult {
        tracks: library.tracks,
        playlists: library.playlists,
        added,
        updated_at: library.updated_at,
    })
}

fn scan_audio_files(dir: &PathBuf) -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(String, String)> = entries
        .flatten()
        .filter(|entry| entry.path().is_file() && mime::is_audio_file(&entry.path()))
        .map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let base = entry
                .path()
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(&file_name)
                .to_string();
            (file_name, base)
        })
        .collect();
    files.sort();
    files.truncate(200);
    files
}

#[tauri::command]
pub async fn import_playlist_csv(
    state: State<'_, AppState>,
    content: String,
    name: Option<String>,
) -> AppResult<Value> {
    let user = require_user(&state).await?;
    let result =
        csv_import::import_playlist_csv(&state, &user.id, &content, name.as_deref().unwrap_or(""))
            .await?;
    Ok(serde_json::to_value(result)?)
}

#[tauri::command]
pub async fn export_playlist_csv(state: State<'_, AppState>) -> AppResult<Value> {
    let user = require_user(&state).await?;
    let (content, file_path) = csv_import::export_playlist_csv(&state, &user.id).await?;
    Ok(serde_json::json!({
        "content": content,
        "filename": "aurora-playlists.csv",
        "filePath": file_path,
    }))
}
