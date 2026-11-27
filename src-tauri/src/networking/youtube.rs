//! YouTube title/artist cleanup. The full JS heuristics are mirrored here for
//! the fallback yt-dlp search path (YouTube Music results are already clean).

use regex::Regex;
use std::sync::OnceLock;

fn decode_entities(value: &str) -> String {
    let mut output = value.to_string();
    for (entity, replacement) in [
        ("&amp;", "&"),
        ("&apos;", "'"),
        ("&gt;", ">"),
        ("&lt;", "<"),
        ("&quot;", "\""),
        ("&#39;", "'"),
    ] {
        output = output.replace(entity, replacement);
    }
    output
}

fn collapse(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn clean_artist_name(raw: &str, fallback: &str) -> String {
    static VEVO: OnceLock<Regex> = OnceLock::new();
    let vevo = VEVO.get_or_init(|| Regex::new(r"(?i)\s*\bvevo\s*$").unwrap());
    let mut artist = collapse(&decode_entities(raw));
    artist = vevo.replace(&artist, "").to_string();
    if let Some(index) = artist.to_ascii_lowercase().find(" - topic") {
        artist.truncate(index);
    }
    let artist = artist.trim().to_string();
    if artist.is_empty() {
        fallback.to_string()
    } else {
        artist
    }
}

pub fn clean_track_title(raw: &str, artist: &str) -> String {
    static BRACKETS: OnceLock<Regex> = OnceLock::new();
    static SEPARATOR_SUFFIX: OnceLock<Regex> = OnceLock::new();
    static TOPIC: OnceLock<Regex> = OnceLock::new();

    let brackets = BRACKETS.get_or_init(|| Regex::new(r"[\(\[\{][^\)\]\}]*[\)\]\}]").unwrap());
    let separator_suffix = SEPARATOR_SUFFIX.get_or_init(|| {
        Regex::new(
            r"(?i)\s*[-–—|•:]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er|m/?v|pv|hd|hq|4k|8k|opening\s+song|ending\s+song|opening\s+theme|ending\s+theme|ost|soundtrack|full\s+song|remaster(?:ed)?|lyric\s+video|live\s+version)\s*$",
        )
        .unwrap()
    });
    let topic = TOPIC.get_or_init(|| Regex::new(r"(?i)\s*-\s*topic\s*$").unwrap());

    let original = collapse(&decode_entities(raw));
    if original.is_empty() {
        return "Unknown title".to_string();
    }

    let mut title = brackets.replace_all(&original, " ").to_string();
    if !artist.is_empty() {
        let prefix = format!("{artist} - ");
        if title
            .to_ascii_lowercase()
            .starts_with(&prefix.to_ascii_lowercase())
        {
            title = title[prefix.len()..].to_string();
        }
        let suffix = format!(" by {artist}");
        if title
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
        {
            title.truncate(title.len() - suffix.len());
        }
    }
    title = topic.replace(&title, "").to_string();
    title = separator_suffix.replace_all(&title, " ").to_string();
    title = collapse(&title);
    title = title
        .trim_matches(|ch: char| matches!(ch, '-' | '–' | '—' | '|' | ':' | '•' | ' '))
        .to_string();
    title = title
        .trim_end_matches(".mp3")
        .trim_end_matches(".wav")
        .trim_end_matches(".ogg")
        .to_string();

    if title.is_empty() { original } else { title }
}
