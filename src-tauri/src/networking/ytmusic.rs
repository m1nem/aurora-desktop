//! Port of `src/lib/ytmusic.ts`: public WEB_REMIX Innertube search and
//! metadata lookup. No API key is bundled; it is read from the public page and
//! the known public fallback is used when the page layout changes.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{Value, json};

use crate::models::track::SearchResult;
use crate::networking::youtube::{clean_artist_name, clean_track_title};

const YT_MUSIC_ORIGIN: &str = "https://music.youtube.com";
const DEFAULT_API_KEY: &str = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const DEFAULT_CLIENT_VERSION: &str = "1.20250101.01.00";
const SONGS_FILTER: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtMusicTrack {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    pub duration: u64,
    pub thumbnail: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())
}

fn config_cache() -> &'static Mutex<Option<(String, String)>> {
    static CACHE: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

async fn load_config(client: &reqwest::Client) -> (String, String) {
    if let Ok(cache) = config_cache().lock() {
        if let Some(value) = cache.as_ref() {
            return value.clone();
        }
    }

    let mut api_key = DEFAULT_API_KEY.to_string();
    let mut client_version = DEFAULT_CLIENT_VERSION.to_string();

    if let Ok(response) = client
        .get(format!("{YT_MUSIC_ORIGIN}/?hl=en&gl=US"))
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Cookie", "CONSENT=YES+1; SOCS=CAI")
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(html) = response.text().await {
                if let Some(value) = extract_json_string(&html, "INNERTUBE_API_KEY") {
                    api_key = value;
                }
                if let Some(value) = extract_json_string(&html, "INNERTUBE_CLIENT_VERSION") {
                    client_version = value;
                }
            }
        }
    }

    let pair = (api_key, client_version);
    if let Ok(mut cache) = config_cache().lock() {
        *cache = Some(pair.clone());
    }
    pair
}

fn extract_json_string(html: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":\"");
    let start = html.find(&needle)? + needle.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn context(client_version: &str) -> Value {
    json!({
        "client": {
            "clientName": "WEB_REMIX",
            "clientVersion": client_version,
            "hl": "en",
            "gl": "US"
        },
        "user": { "lockedSafetyMode": false },
        "request": { "useSsl": true }
    })
}

async fn post_innertube(endpoint: &str, body: Value) -> Result<Value, String> {
    let client = client()?;
    let mut config = load_config(&client).await;

    for attempt in 0..2 {
        let url = format!(
            "{YT_MUSIC_ORIGIN}/youtubei/v1/{endpoint}?key={}&prettyPrint=false",
            config.0
        );
        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Origin", YT_MUSIC_ORIGIN)
            .header("Referer", format!("{YT_MUSIC_ORIGIN}/"))
            .header("Cookie", "CONSENT=YES+1; SOCS=CAI")
            .json(&json!({
                "context": context(&config.1),
                "query": body.get("query").cloned().unwrap_or(Value::Null),
                "params": body.get("params").cloned().unwrap_or(Value::Null),
                "videoId": body.get("videoId").cloned().unwrap_or(Value::Null),
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if matches!(response.status().as_u16(), 401 | 403) && attempt == 0 {
            if let Ok(mut cache) = config_cache().lock() {
                *cache = None;
            }
            config = load_config(&client).await;
            continue;
        }

        if !response.status().is_success() {
            return Err(format!("YouTube Music returned HTTP {}", response.status()));
        }

        return response
            .json::<Value>()
            .await
            .map_err(|error| error.to_string());
    }

    Err("YouTube Music rejected the request.".to_string())
}

fn find_renderers<'a>(node: &'a Value, key: &str, output: &mut Vec<&'a Value>) {
    match node {
        Value::Array(items) => {
            for item in items {
                find_renderers(item, key, output);
            }
        }
        Value::Object(map) => {
            for (name, value) in map {
                if name == key && value.is_object() {
                    output.push(value);
                }
                find_renderers(value, key, output);
            }
        }
        _ => {}
    }
}

fn runs_text(value: &Value) -> String {
    let text = value.get("text").unwrap_or(value);
    text.get("runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

fn find_video_id(node: &Value) -> Option<String> {
    match node {
        Value::Array(items) => items.iter().find_map(find_video_id),
        Value::Object(map) => {
            if let Some(id) = map.get("videoId").and_then(Value::as_str) {
                if id.len() == 11
                    && id
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
                {
                    return Some(id.to_string());
                }
            }
            map.values().find_map(find_video_id)
        }
        _ => None,
    }
}

fn parse_duration(value: &str) -> u64 {
    let parts: Vec<u64> = value
        .split(':')
        .map(|part| part.trim().parse::<u64>().unwrap_or(u64::MAX))
        .collect();
    if parts.contains(&u64::MAX) {
        return 0;
    }
    match parts.len() {
        2 => parts[0] * 60 + parts[1],
        3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
        _ => 0,
    }
}

fn is_duration(value: &str) -> bool {
    let parts: Vec<&str> = value.trim().split(':').collect();
    (parts.len() == 2 || parts.len() == 3)
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn is_play_count(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    ["view", "play", "listener", "subscriber"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn biggest_thumbnail(node: &Value, video_id: &str) -> String {
    let mut thumbnails: Vec<(u64, String)> = Vec::new();

    fn walk(value: &Value, output: &mut Vec<(u64, String)>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    walk(item, output);
                }
            }
            Value::Object(map) => {
                if let Some(url) = map.get("url").and_then(Value::as_str) {
                    if url.starts_with("https://")
                        && (url.contains("ytimg")
                            || url.contains("googleusercontent")
                            || url.contains("ggpht"))
                    {
                        let width = map.get("width").and_then(Value::as_u64).unwrap_or(0);
                        output.push((width, url.to_string()));
                    }
                }
                for value in map.values() {
                    walk(value, output);
                }
            }
            _ => {}
        }
    }

    walk(node, &mut thumbnails);
    thumbnails.sort_by_key(|(width, _)| std::cmp::Reverse(*width));
    thumbnails
        .first()
        .map(|(_, url)| url.clone())
        .unwrap_or_else(|| {
            if video_id.is_empty() {
                String::new()
            } else {
                format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
            }
        })
}

fn parse_search_item(renderer: &Value) -> Option<YtMusicTrack> {
    let video_id = find_video_id(renderer)?;
    let columns: Vec<String> = renderer
        .get("flexColumns")
        .and_then(Value::as_array)
        .map(|columns| {
            columns
                .iter()
                .filter_map(|column| {
                    column
                        .get("musicResponsiveListItemFlexColumnRenderer")
                        .map(runs_text)
                })
                .filter(|text| !text.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let raw_title = columns.first()?.clone();
    if raw_title.is_empty() {
        return None;
    }

    let meta_parts: Vec<String> = columns
        .get(1)
        .map(|value| {
            value
                .split(['•', '·'])
                .map(|part| part.trim().to_string())
                .filter(|part| !part.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let artist = clean_artist_name(
        meta_parts.first().map(String::as_str).unwrap_or(""),
        "Unknown artist",
    );
    let duration_part = meta_parts
        .iter()
        .find(|part| is_duration(part))
        .cloned()
        .unwrap_or_default();
    let album = meta_parts
        .iter()
        .skip(1)
        .find(|part| !is_duration(part) && !is_play_count(part))
        .cloned();

    Some(YtMusicTrack {
        video_id: video_id.clone(),
        title: clean_track_title(&raw_title, &artist),
        artist,
        album,
        duration: parse_duration(&duration_part),
        thumbnail: biggest_thumbnail(renderer, &video_id),
    })
}

pub async fn search_ytmusic(query: &str, limit: usize) -> Vec<SearchResult> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let data = match post_innertube(
        "search",
        json!({ "query": trimmed, "params": SONGS_FILTER }),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            log::warn!("YouTube Music search failed: {error}");
            return Vec::new();
        }
    };

    let mut renderers = Vec::new();
    find_renderers(&data, "musicResponsiveListItemRenderer", &mut renderers);

    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();
    for renderer in renderers {
        let Some(item) = parse_search_item(renderer) else {
            continue;
        };
        if !seen.insert(item.video_id.clone()) {
            continue;
        }
        results.push(SearchResult {
            id: item.video_id,
            title: item.title,
            author: item.artist,
            album: item.album,
            duration: item.duration,
            thumbnail: item.thumbnail,
        });
        if results.len() >= limit {
            break;
        }
    }
    results
}

pub async fn get_ytmusic_track(video_id: &str) -> Option<YtMusicTrack> {
    if video_id.len() != 11
        || !video_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }

    let data = post_innertube("player", json!({ "videoId": video_id }))
        .await
        .ok()?;
    let details = data.get("videoDetails")?.as_object()?;
    let raw_title = details.get("title")?.as_str()?;
    if raw_title.is_empty() {
        return None;
    }

    let artist = clean_artist_name(
        details.get("author").and_then(Value::as_str).unwrap_or(""),
        "Unknown artist",
    );
    let duration = details
        .get("lengthSeconds")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| details.get("lengthSeconds").and_then(Value::as_u64))
        .unwrap_or(0);

    let thumbnail = details
        .get("thumbnail")
        .and_then(|value| value.get("thumbnails"))
        .map(|value| biggest_thumbnail(value, video_id))
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"));

    Some(YtMusicTrack {
        video_id: video_id.to_string(),
        title: clean_track_title(raw_title, &artist),
        artist,
        album: None,
        duration,
        thumbnail,
    })
}

#[cfg(test)]
mod live_tests {
    use super::search_ytmusic;

    #[tokio::test]
    #[ignore = "requires network access to music.youtube.com"]
    async fn live_ytmusic_metadata() {
        let track = super::get_ytmusic_track("8QPyFlJNmus")
            .await
            .expect("metadata");
        assert_eq!(track.video_id, "8QPyFlJNmus");
        assert!(!track.title.is_empty());
        assert!(!track.artist.is_empty());
        assert!(track.duration > 0);
    }

    #[tokio::test]
    #[ignore = "requires network access to music.youtube.com"]
    async fn live_ytmusic_search() {
        let results = search_ytmusic("Linked Horizon", 5).await;
        assert!(!results.is_empty(), "YouTube Music returned no results");
        assert!(results.iter().all(|item| !item.id.is_empty()));
        assert!(results.iter().any(|item| item.title.contains("Shin")));
        eprintln!("first result thumbnail: {:?}", results[0].thumbnail);
        assert!(results.iter().all(|item| !item.thumbnail.is_empty()));
    }
}
