use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::models::library::Playlist;
use crate::models::track::{Track, VALID_SOURCES};

fn text(value: Option<&Value>, max: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|value| value.chars().take(max).collect())
        .unwrap_or_default()
}

fn number(value: Option<&Value>) -> u64 {
    value
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
        })
        .unwrap_or(0)
}

/// Mirrors `normaliseMediaUrl`.
pub fn normalise_media_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("/downloads/") {
        return format!("/api/media/downloads/{rest}");
    }
    if let Some(rest) = url.strip_prefix("/uploads/") {
        return format!("/api/media/uploads/{rest}");
    }
    url.to_string()
}

/// Sanitizes one track from an untrusted payload.
pub fn sanitize_track(input: &Value) -> Option<Track> {
    let raw = input.as_object()?;
    let id = text(raw.get("id"), 128).trim().to_string();
    let title = text(raw.get("title"), 500).trim().to_string();
    let url = normalise_media_url(text(raw.get("url"), 4096).trim());
    if id.is_empty() || title.is_empty() || url.is_empty() {
        return None;
    }

    let lower = url.to_ascii_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("data:")
        || lower.starts_with("vbscript:")
        || lower.starts_with("blob:")
    {
        return None;
    }

    let source = text(raw.get("source"), 32);
    let source = if VALID_SOURCES.contains(&source.as_str()) {
        source
    } else {
        "youtube".to_string()
    };

    let author = {
        let value = text(raw.get("author"), 300).trim().to_string();
        if value.is_empty() {
            "Unknown artist".to_string()
        } else {
            value
        }
    };

    let mut track = Track {
        id,
        title,
        author,
        album: None,
        duration: number(raw.get("duration")),
        thumbnail: text(raw.get("thumbnail"), 4096),
        url,
        file_path: {
            let value = text(raw.get("filePath"), 4096);
            if value.is_empty() { None } else { Some(value) }
        },
        source,
        cloud_url: None,
        external_uri: None,
        file_size: None,
        uploaded_at: None,
    };

    let album = text(raw.get("album"), 300).trim().to_string();
    if !album.is_empty() {
        track.album = Some(album);
    }

    let external_uri = text(raw.get("externalUri"), 2048).trim().to_string();
    if !external_uri.is_empty() {
        track.external_uri = Some(external_uri);
    }

    let cloud_url = text(raw.get("cloudUrl"), 4096);
    if !cloud_url.is_empty() {
        track.cloud_url = Some(cloud_url);
    }

    if raw.contains_key("fileSize") {
        track.file_size = Some(number(raw.get("fileSize")));
    }
    if raw.contains_key("uploadedAt") {
        let uploaded = number(raw.get("uploadedAt"));
        track.uploaded_at = Some(if uploaded == 0 {
            crate::database::now_ms()
        } else {
            uploaded as i64
        });
    }

    Some(track)
}

pub fn sanitize_playlist(input: &Value) -> Option<Playlist> {
    let raw = input.as_object()?;
    let id = text(raw.get("id"), 128).trim().to_string();
    let name = text(raw.get("name"), 300).trim().to_string();
    if id.is_empty() || name.is_empty() {
        return None;
    }

    let mut seen = HashSet::new();
    let mut track_ids = Vec::new();
    if let Some(values) = raw.get("trackIds").and_then(Value::as_array) {
        for value in values {
            let Some(value) = value.as_str() else {
                continue;
            };
            let id: String = value.chars().take(128).collect();
            if seen.insert(id.clone()) {
                track_ids.push(id);
            }
            if track_ids.len() >= 5000 {
                break;
            }
        }
    }

    let created = number(raw.get("createdAt"));
    Some(Playlist {
        id,
        name,
        track_ids,
        created_at: if created == 0 {
            crate::database::now_ms()
        } else {
            created as i64
        },
    })
}

pub fn sanitize_library_payload(input: &Value) -> (Vec<Track>, Vec<Playlist>) {
    let raw = input.as_object();
    let tracks = raw
        .and_then(|map| map.get("tracks"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(sanitize_track)
                .take(10_000)
                .collect()
        })
        .unwrap_or_default();

    let playlists = raw
        .and_then(|map| map.get("playlists"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(sanitize_playlist)
                .take(1_000)
                .collect()
        })
        .unwrap_or_default();

    (tracks, playlists)
}

pub fn merge_tracks(current: &[Track], incoming: &[Track]) -> Vec<Track> {
    let mut by_id: HashMap<String, Track> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for track in current.iter().chain(incoming.iter()) {
        if !by_id.contains_key(&track.id) {
            order.push(track.id.clone());
        }
        by_id.insert(track.id.clone(), track.clone());
    }
    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect()
}

pub fn merge_playlists(current: &[Playlist], incoming: &[Playlist]) -> Vec<Playlist> {
    let mut by_id: HashMap<String, Playlist> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for playlist in current {
        if !by_id.contains_key(&playlist.id) {
            order.push(playlist.id.clone());
        }
        by_id.insert(playlist.id.clone(), playlist.clone());
    }

    for playlist in incoming {
        match by_id.get_mut(&playlist.id) {
            None => {
                order.push(playlist.id.clone());
                by_id.insert(playlist.id.clone(), playlist.clone());
            }
            Some(existing) => {
                // Preserve the current device's order, then append new ids
                // from the incoming playlist (matches mergePlaylists in db.ts).
                let mut track_ids = existing.track_ids.clone();
                for id in &playlist.track_ids {
                    if !track_ids.contains(id) {
                        track_ids.push(id.clone());
                    }
                }
                let mut merged = playlist.clone();
                merged.track_ids = track_ids;
                *existing = merged;
            }
        }
    }

    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect()
}

pub fn filter_playlist_tracks(tracks: &[Track], playlists: &[Playlist]) -> Vec<Playlist> {
    let ids: HashSet<&str> = tracks.iter().map(|track| track.id.as_str()).collect();
    playlists
        .iter()
        .map(|playlist| Playlist {
            id: playlist.id.clone(),
            name: playlist.name.clone(),
            track_ids: playlist
                .track_ids
                .iter()
                .filter(|id| ids.contains(id.as_str()))
                .cloned()
                .collect(),
            created_at: playlist.created_at,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn track_json(id: &str, title: &str) -> Value {
        json!({
            "id": id,
            "title": title,
            "author": "Artist",
            "duration": 120,
            "thumbnail": "",
            "url": "/downloads/test.mp3",
            "source": "youtube"
        })
    }

    #[test]
    fn sanitizes_tracks_and_normalises_media_urls() {
        let track = sanitize_track(&track_json("t1", " Song ")).expect("track");
        assert_eq!(track.id, "t1");
        assert_eq!(track.title, "Song");
        assert_eq!(track.url, "/api/media/downloads/test.mp3");
        assert_eq!(track.source, "youtube");

        assert!(sanitize_track(&json!({"id": "", "title": "x", "url": "u"})).is_none());
        assert!(sanitize_track(&json!({"id": "x", "title": "", "url": "u"})).is_none());
        assert!(sanitize_track(&json!({"id": "x", "title": "x", "url": ""})).is_none());
        assert!(
            sanitize_track(&json!({"id": "x", "title": "x", "url": "javascript:alert(1)"}))
                .is_none()
        );
        assert!(
            sanitize_track(&json!({"id": "x", "title": "x", "url": "data:text/html,x"})).is_none()
        );
    }

    #[test]
    fn merges_tracks_in_order_with_incoming_wins() {
        let current = vec![
            Track {
                id: "a".into(),
                title: "old".into(),
                ..sanitize_track(&track_json("a", "a")).unwrap()
            },
            Track {
                id: "b".into(),
                title: "b".into(),
                ..sanitize_track(&track_json("b", "b")).unwrap()
            },
        ];
        let incoming = vec![
            Track {
                id: "a".into(),
                title: "new".into(),
                ..sanitize_track(&track_json("a", "new")).unwrap()
            },
            Track {
                id: "c".into(),
                title: "c".into(),
                ..sanitize_track(&track_json("c", "c")).unwrap()
            },
        ];
        let merged = merge_tracks(&current, &incoming);
        assert_eq!(
            merged.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
        assert_eq!(merged[0].title, "new");
    }

    #[test]
    fn merges_playlists_and_filters_missing_tracks() {
        let current = vec![Playlist {
            id: "pl".into(),
            name: "Mine".into(),
            track_ids: vec!["a".into()],
            created_at: 1,
        }];
        let incoming = vec![Playlist {
            id: "pl".into(),
            name: "Theirs".into(),
            track_ids: vec!["b".into()],
            created_at: 2,
        }];
        let merged = merge_playlists(&current, &incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].name, "Theirs");
        assert_eq!(merged[0].track_ids, vec!["a", "b"]);

        let tracks = vec![sanitize_track(&track_json("a", "a")).unwrap()];
        let filtered = filter_playlist_tracks(&tracks, &merged);
        assert_eq!(filtered[0].track_ids, vec!["a"]);
    }
}
