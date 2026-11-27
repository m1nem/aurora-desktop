use std::collections::HashMap;

use crate::auth::password::sha256_hex;
use crate::error::{AppError, AppResult};
use crate::models::library::{CsvImportResult, CsvImportStats, LibraryPayload, Playlist};
use crate::models::track::Track;
use crate::state::AppState;

const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_ROWS: usize = 5000;

fn normalise_header(value: &str) -> String {
    let value = value.trim_start_matches('\u{feff}').trim().to_lowercase();
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn first_value(
    record: &csv::StringRecord,
    headers: &HashMap<String, usize>,
    keys: &[&str],
) -> String {
    for key in keys {
        if let Some(index) = headers.get(*key) {
            if let Some(value) = record.get(*index) {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    String::new()
}

fn spotify_track_id(uri: &str) -> String {
    if let Some(rest) = uri.strip_prefix("spotify:track:") {
        if rest.chars().all(|ch| ch.is_ascii_alphanumeric()) {
            return rest.to_string();
        }
    }
    if let Some(index) = uri.find("open.spotify.com/track/") {
        let rest = &uri[index + "open.spotify.com/track/".len()..];
        return rest
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric())
            .collect();
    }
    String::new()
}

fn external_web_url(uri: &str, title: &str, author: &str) -> String {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return uri.to_string();
    }
    let track_id = spotify_track_id(uri);
    if !track_id.is_empty() {
        return format!("https://open.spotify.com/track/{track_id}");
    }
    let terms = format!("{title} {author}");
    let query = urlencoding::encode(terms.trim());
    format!("https://open.spotify.com/search/{query}")
}

fn imported_track_id(uri: &str, title: &str, author: &str, album: &str) -> String {
    let spotify = spotify_track_id(uri);
    if !spotify.is_empty() {
        return format!("spotify-{spotify}").chars().take(128).collect();
    }
    let digest = sha256_hex(&format!("{uri}|{title}|{author}|{album}").to_lowercase());
    format!("import-{}", &digest[..24])
}

fn duration_from_row(record: &csv::StringRecord, headers: &HashMap<String, usize>) -> u64 {
    for key in ["trackdurationms", "durationms"] {
        if let Some(value) = headers
            .get(key)
            .and_then(|index| record.get(*index))
            .and_then(|value| value.trim().parse::<u64>().ok())
        {
            if value > 0 {
                return value / 1000;
            }
        }
    }
    for key in ["duration", "trackduration"] {
        if let Some(value) = headers
            .get(key)
            .and_then(|index| record.get(*index))
            .and_then(|value| value.trim().parse::<u64>().ok())
        {
            if value > 0 {
                return value;
            }
        }
    }
    0
}

fn new_playlist_id() -> String {
    format!(
        "pl-{}",
        hex::encode(crate::auth::password::random_bytes(12))
    )
}

pub async fn import_playlist_csv(
    state: &AppState,
    user_id: &str,
    content: &str,
    name: &str,
) -> AppResult<CsvImportResult> {
    if content.trim().is_empty() {
        return Err(AppError::bad_request(
            "Choose a non-empty CSV file to import.",
        ));
    }
    if content.len() > MAX_FILE_BYTES {
        return Err(AppError::too_large(
            "The CSV file must be smaller than 8 MB.",
        ));
    }

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(content.as_bytes());

    let raw_headers = reader
        .headers()
        .map_err(|error| AppError::bad_request(format!("Could not parse the CSV file: {error}")))?
        .clone();

    let mut headers: HashMap<String, usize> = HashMap::new();
    for (index, header) in raw_headers.iter().enumerate() {
        headers.entry(normalise_header(header)).or_insert(index);
    }

    if headers.is_empty()
        || (!headers.contains_key("trackname")
            && !headers.contains_key("title")
            && !headers.contains_key("name"))
    {
        return Err(AppError::bad_request(
            "This does not look like an Exportify CSV. Expected a \"Track Name\" column.",
        ));
    }

    let mut tracks_by_id: HashMap<String, Track> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut skipped = 0usize;
    let mut duplicates = 0usize;
    let mut total_rows = 0usize;

    for record in reader.records() {
        let record = match record {
            Ok(record) => record,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        total_rows += 1;
        if total_rows > MAX_ROWS {
            return Err(AppError::too_large(format!(
                "A playlist can contain at most {MAX_ROWS} tracks."
            )));
        }

        let title = first_value(&record, &headers, &["trackname", "title", "name"]);
        if title.is_empty() {
            skipped += 1;
            continue;
        }

        let author = {
            let value = first_value(
                &record,
                &headers,
                &[
                    "artistnames",
                    "artistname",
                    "artists",
                    "artist",
                    "albumartistnames",
                ],
            );
            if value.is_empty() {
                "Unknown artist".to_string()
            } else {
                value
            }
        };
        let album = first_value(&record, &headers, &["albumname", "album"]);
        let external_uri = first_value(&record, &headers, &["trackuri", "uri", "trackurl"]);
        let id = imported_track_id(&external_uri, &title, &author, &album);

        if tracks_by_id.contains_key(&id) {
            duplicates += 1;
            continue;
        }

        let track = Track {
            id: id.clone(),
            title: title.chars().take(500).collect(),
            author: author.chars().take(300).collect(),
            album: if album.is_empty() {
                None
            } else {
                Some(album.chars().take(300).collect())
            },
            duration: duration_from_row(&record, &headers),
            thumbnail: String::new(),
            url: external_web_url(&external_uri, &title, &author),
            file_path: None,
            source: "imported".to_string(),
            cloud_url: None,
            external_uri: if external_uri.is_empty() {
                None
            } else {
                Some(external_uri)
            },
            file_size: None,
            uploaded_at: Some(crate::database::now_ms()),
        };

        order.push(id.clone());
        tracks_by_id.insert(id, track);
    }

    if tracks_by_id.is_empty() {
        return Err(AppError::bad_request(
            "No tracks with a name were found in this CSV file.",
        ));
    }

    let db = state.db().await?;
    let mut library = db.get_library(user_id).await?;
    let existing: HashMap<String, usize> = library
        .tracks
        .iter()
        .enumerate()
        .map(|(index, track)| (track.id.clone(), index))
        .collect();

    let mut playlist_tracks: Vec<Track> = Vec::new();
    for id in &order {
        let Some(incoming) = tracks_by_id.get(id) else {
            continue;
        };

        if let Some(index) = existing.get(id).copied() {
            let current = &mut library.tracks[index];
            if current.source == "imported" {
                current.title = incoming.title.clone();
                current.author = incoming.author.clone();
                current.album = incoming.album.clone();
                current.duration = incoming.duration;
                current.external_uri = incoming.external_uri.clone();
                current.url = incoming.url.clone();
            }
            playlist_tracks.push(current.clone());
        } else {
            library.tracks.push(incoming.clone());
            playlist_tracks.push(incoming.clone());
        }
    }

    let now = crate::database::now_ms();
    let playlist = Playlist {
        id: new_playlist_id(),
        name: {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                "Imported Playlist".to_string()
            } else {
                trimmed.chars().take(300).collect()
            }
        },
        track_ids: playlist_tracks
            .iter()
            .map(|track| track.id.clone())
            .collect(),
        created_at: now,
    };

    library.playlists.push(playlist.clone());
    library.updated_at = now;
    db.save_library(user_id, &library.tracks, &library.playlists, now)
        .await?;

    Ok(CsvImportResult {
        ok: true,
        playlist: playlist.clone(),
        playlists: vec![playlist],
        tracks: playlist_tracks,
        stats: CsvImportStats {
            total_rows,
            imported: order.len(),
            duplicates,
            skipped,
        },
        updated_at: now,
    })
}

/// Builds a CSV export of every playlist in the library.
pub async fn export_playlist_csv(state: &AppState, user_id: &str) -> AppResult<(String, String)> {
    let db = state.db().await?;
    let library: LibraryPayload = db.get_library(user_id).await?;

    let mut writer = csv::Writer::from_writer(vec![]);
    writer
        .write_record([
            "Playlist",
            "Track Name",
            "Artist Name",
            "Album Name",
            "Duration (ms)",
            "Track URI",
        ])
        .map_err(|error| AppError::internal(error.to_string()))?;

    let tracks: HashMap<&str, &Track> = library
        .tracks
        .iter()
        .map(|track| (track.id.as_str(), track))
        .collect();

    for playlist in &library.playlists {
        for id in &playlist.track_ids {
            if let Some(track) = tracks.get(id.as_str()) {
                writer
                    .write_record([
                        playlist.name.as_str(),
                        track.title.as_str(),
                        track.author.as_str(),
                        track.album.as_deref().unwrap_or(""),
                        &(track.duration * 1000).to_string(),
                        track.external_uri.as_deref().unwrap_or(track.url.as_str()),
                    ])
                    .map_err(|error| AppError::internal(error.to_string()))?;
            }
        }
    }

    let bytes = writer
        .into_inner()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let content =
        String::from_utf8(bytes).map_err(|error| AppError::internal(error.to_string()))?;

    // WebView file downloads are not portable across WebKitGTK/Tauri builds,
    // so the export is also written to an explicit file the user can open.
    let exports_dir = state.paths.data_dir.join("exports");
    std::fs::create_dir_all(&exports_dir)?;
    let file_path = exports_dir.join("aurora-playlists.csv");
    crate::storage::write_private(&file_path, content.as_bytes())?;

    Ok((content, file_path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::user::UserRecord;
    use crate::state::AppState;

    fn test_state(name: &str) -> (AppState, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("aurora-csv-{name}-{}", uuid::Uuid::new_v4()));
        let paths = crate::storage::paths::AppPaths::from_root(root.clone()).expect("app paths");
        (AppState::new_for_tests(paths), root)
    }

    async fn seed_user(state: &AppState) {
        let db = state.db().await.unwrap();
        db.insert_user(&UserRecord {
            id: "usr-csv".to_string(),
            email: "csv@example.com".to_string(),
            username: "csvuser".to_string(),
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
    async fn imports_exportify_csv_and_exports_it_again() {
        let (state, root) = test_state("roundtrip");
        seed_user(&state).await;

        let csv = "\u{feff}Track Name,Artist Names,Album Name,Track Duration (ms),Track URI\n\
Song A,Artist A,Album A,180000,spotify:track:abc123\n\
Song A,Artist A,Album A,180000,spotify:track:abc123\n\
Song B,Artist B,,200000,\n";

        let result = import_playlist_csv(&state, "usr-csv", csv, "Test Mix")
            .await
            .expect("import");
        assert!(result.ok);
        assert_eq!(result.playlist.name, "Test Mix");
        assert_eq!(result.playlist.track_ids.len(), 2);
        assert_eq!(result.playlists.len(), 1, "frontend needs the new playlist");
        assert_eq!(result.stats.total_rows, 3);
        assert_eq!(result.stats.imported, 2);
        assert_eq!(result.stats.duplicates, 1);
        assert_eq!(result.stats.skipped, 0);
        assert_eq!(result.tracks[0].id, "spotify-abc123");
        assert_eq!(result.tracks[0].duration, 180);

        let (content, path) = export_playlist_csv(&state, "usr-csv")
            .await
            .expect("export");
        assert!(content.contains("Playlist,Track Name"));
        assert!(content.contains("Test Mix"));
        assert!(content.contains("Song A"));
        assert!(std::path::Path::new(&path).is_file());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);

        let db = state.db().await.unwrap();
        let library = db.get_library("usr-csv").await.unwrap();
        assert_eq!(library.tracks.len(), 2);
        assert_eq!(library.playlists.len(), 1);
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn rejects_csv_without_name_column() {
        let (state, root) = test_state("invalid");
        seed_user(&state).await;
        let error = import_playlist_csv(&state, "usr-csv", "Foo,Bar\n1,2\n", "")
            .await
            .expect_err("must reject");
        assert_eq!(error.code, "BAD_REQUEST");
        let db = state.db().await.unwrap();
        db.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
