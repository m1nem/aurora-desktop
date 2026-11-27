use serde::Serialize;
use serde_json::Value;

const LRCLIB_GET: &str = "https://lrclib.net/api/get";
const LRCLIB_SEARCH: &str = "https://lrclib.net/api/search";
const LYRICS_OVH: &str = "https://api.lyrics.ovh/v1";
const USER_AGENT: &str = "AuroraMP/1.0 (desktop; https://auroramp.vercel.app)";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsCandidate {
    pub id: String,
    pub provider: String,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: bool,
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn parse_lrclib_candidate(value: &Value) -> Option<LyricsCandidate> {
    let plain = value_string(value, "plainLyrics");
    let synced = value_string(value, "syncedLyrics");
    if plain.is_none() && synced.is_none() {
        return None;
    }
    let id = match value.get("id") {
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::String(text)) => text.clone(),
        _ => format!(
            "lrclib-{}",
            crate::auth::password::sha256_hex(&format!(
                "{}|{}",
                value_string(value, "artistName").unwrap_or_default(),
                value_string(value, "trackName").unwrap_or_default()
            ))
        ),
    };
    Some(LyricsCandidate {
        id: format!("lrclib-{id}"),
        provider: "lrclib".to_string(),
        track_name: value_string(value, "trackName").unwrap_or_else(|| "Unknown title".to_string()),
        artist_name: value_string(value, "artistName")
            .unwrap_or_else(|| "Unknown artist".to_string()),
        album_name: value_string(value, "albumName"),
        duration: value.get("duration").and_then(Value::as_f64),
        instrumental: value
            .get("instrumental")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        plain_lyrics: plain,
        synced_lyrics: synced,
    })
}

async fn fetch_lrclib_candidates(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
) -> Result<Vec<LyricsCandidate>, String> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let response = client
        .get(LRCLIB_GET)
        .query(&[("artist_name", artist), ("track_name", title)])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        let payload: Value = response.json().await.map_err(|error| error.to_string())?;
        if let Some(candidate) = parse_lrclib_candidate(&payload) {
            seen.insert(candidate.id.clone());
            candidates.push(candidate);
        }
    }

    let query = format!("{artist} {title}");
    let search = client
        .get(LRCLIB_SEARCH)
        .query(&[("q", query.as_str())])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if search.status().is_success() {
        let results: Vec<Value> = search.json().await.map_err(|error| error.to_string())?;
        for item in results {
            if let Some(candidate) = parse_lrclib_candidate(&item) {
                if seen.insert(candidate.id.clone()) {
                    candidates.push(candidate);
                }
            }
        }
    }

    // Synced results first; then closest duration, then title.
    candidates.sort_by(|left, right| {
        right
            .synced_lyrics
            .is_some()
            .cmp(&left.synced_lyrics.is_some())
            .then_with(|| {
                left.duration
                    .unwrap_or(f64::MAX)
                    .total_cmp(&right.duration.unwrap_or(f64::MAX))
            })
    });
    candidates.truncate(12);
    Ok(candidates)
}

async fn fetch_lyrics_ovh(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
) -> Result<Vec<LyricsCandidate>, String> {
    let url = format!(
        "{LYRICS_OVH}/{}/{}",
        urlencoding::encode(artist),
        urlencoding::encode(title)
    );
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    let payload: Value = response.json().await.map_err(|error| error.to_string())?;
    let lyrics = payload
        .get("lyrics")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    Ok(lyrics
        .map(|plain| {
            vec![LyricsCandidate {
                id: format!(
                    "lyricsovh-{}",
                    crate::auth::password::sha256_hex(&format!("{artist}|{title}"))
                ),
                provider: "lyricsovh".to_string(),
                track_name: title.to_string(),
                artist_name: artist.to_string(),
                album_name: None,
                duration: None,
                instrumental: false,
                plain_lyrics: Some(plain),
                synced_lyrics: None,
            }]
        })
        .unwrap_or_default())
}

/// Fetches candidates from the selected provider. `lrclib` is the synchronized
/// provider; `lyricsovh` is a plain-text fallback and is explicitly marked as
/// unsynchronized by the UI.
pub async fn fetch_candidates(
    artist: &str,
    title: &str,
    provider: &str,
) -> Result<Vec<LyricsCandidate>, String> {
    let artist = clean_lyrics_artist(artist);
    let title = clean_lyrics_title(title);
    if artist.is_empty() || title.is_empty() {
        return Ok(Vec::new());
    }
    let client = client()?;
    if provider == "lyricsovh" {
        fetch_lyrics_ovh(&client, &artist, &title).await
    } else {
        fetch_lrclib_candidates(&client, &artist, &title).await
    }
}

pub fn best_candidate(candidates: &[LyricsCandidate]) -> Option<&LyricsCandidate> {
    candidates
        .iter()
        .find(|candidate| candidate.synced_lyrics.is_some())
        .or_else(|| candidates.first())
}

/// Removes upload-specific noise from a YouTube title before querying LRCLIB.
/// Mirrors `cleanLyricsTitle` in the original `src/lib/lyrics.ts`.
pub fn clean_lyrics_title(title: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;

    static NOISE: OnceLock<Regex> = OnceLock::new();
    static TOPIC: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();

    let noise = NOISE.get_or_init(|| {
        Regex::new(r"(?i)[\(\[](?:official\s*(?:music\s*)?video|lyrics?\s*video|audio|hd|hq)[\)\]]")
            .expect("valid lyrics noise regex")
    });
    let topic = TOPIC
        .get_or_init(|| Regex::new(r"(?i)\s*[-–]\s*topic\s*$").expect("valid lyrics topic regex"));
    let spaces = SPACES.get_or_init(|| Regex::new(r"\s+").expect("valid whitespace regex"));

    let cleaned = noise.replace_all(title, " ");
    let cleaned = topic.replace(&cleaned, "");
    spaces.replace_all(cleaned.trim(), " ").to_string()
}

/// Mirrors `cleanArtist` in the original lyrics helper.
pub fn clean_lyrics_artist(artist: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;

    static TOPIC: OnceLock<Regex> = OnceLock::new();
    static VEVO: OnceLock<Regex> = OnceLock::new();

    let topic = TOPIC
        .get_or_init(|| Regex::new(r"(?i)\s*[-–]\s*topic\s*$").expect("valid artist topic regex"));
    let vevo = VEVO.get_or_init(|| Regex::new(r"(?i)vevo\s*$").expect("valid vevo regex"));

    vevo.replace(topic.replace(artist.trim(), "").trim(), "")
        .trim()
        .to_string()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
pub async fn fetch_lyrics(
    artist: &str,
    title: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let candidates = fetch_candidates(artist, title, "lrclib").await?;
    Ok(best_candidate(&candidates)
        .map(|candidate| {
            (
                candidate.plain_lyrics.clone(),
                candidate.synced_lyrics.clone(),
            )
        })
        .unwrap_or((None, None)))
}

#[cfg(test)]
mod tests {
    use super::{clean_lyrics_artist, clean_lyrics_title};

    #[test]
    fn strips_upload_noise_from_titles() {
        assert_eq!(
            clean_lyrics_title("Song Name (Official Music Video)"),
            "Song Name"
        );
        assert_eq!(clean_lyrics_title("Song Name [Lyric Video]"), "Song Name");
        assert_eq!(clean_lyrics_title("Song Name - Topic"), "Song Name");
    }

    #[test]
    fn strips_vevo_and_topic_from_artists() {
        assert_eq!(clean_lyrics_artist("ArtistVEVO"), "Artist");
        assert_eq!(clean_lyrics_artist("Artist - Topic"), "Artist");
    }
}

#[cfg(test)]
mod live_tests {
    use super::fetch_lyrics;

    #[tokio::test]
    #[ignore = "requires network access to lrclib.net"]
    async fn live_lrclib_lookup() {
        let (plain, synced) = fetch_lyrics("Linked Horizon", "Shinzo wo Sasageyo!")
            .await
            .expect("lyrics request");
        assert!(
            plain.is_some() || synced.is_some(),
            "lrclib returned no lyrics for a well-known track"
        );
    }
}
