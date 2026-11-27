use std::path::Path;

pub const AUDIO_EXTENSIONS: [&str; 9] = [
    "mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "webm",
];

pub fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn is_audio_file(path: &Path) -> bool {
    AUDIO_EXTENSIONS.contains(&extension(path).as_str())
}

pub fn is_audio_upload(file_name: &str, mime_type: &str) -> bool {
    mime_type.starts_with("audio/")
        || matches!(
            file_name
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
            "mp3" | "wav" | "ogg" | "m4a" | "flac"
        )
}

pub fn legacy_track_url(bucket: &str, file_name: &str) -> String {
    format!("/api/media/{bucket}/{}", urlencoding::encode(file_name))
}
