use std::path::{Path, PathBuf};

use crate::error::AppResult;
use crate::models::track::Track;
use crate::storage::paths::AppPaths;
use crate::storage::safe_file_name;

use super::mime::legacy_track_url;

#[derive(Debug, Clone)]
pub struct SavedMedia {
    pub file_path: PathBuf,
    pub file_name: String,
    pub url: String,
}

pub fn unique_upload_name(original_name: &str, timestamp: i64) -> (String, String) {
    // Mirrors the original upload endpoint: strip path separators and
    // unsupported characters instead of replacing them with underscores, so
    // the displayed title stays clean ("My Song?", not "My Song_").
    let raw_base = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("upload");
    let base: String = raw_base
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | ' '))
        .collect();
    let base = base.trim().chars().take(60).collect::<String>();
    let extension = {
        let ext = Path::new(original_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("mp3")
            .to_ascii_lowercase();
        if super::mime::AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            ext
        } else {
            "mp3".to_string()
        }
    };

    let suffix = crate::storage::random_suffix(6);
    let file_name = format!(
        "{}-{timestamp}-{suffix}.{extension}",
        if base.is_empty() { "upload" } else { &base }
    );
    (file_name, base)
}

pub fn save_upload(
    paths: &AppPaths,
    bytes: &[u8],
    original_name: &str,
) -> AppResult<(SavedMedia, String)> {
    let timestamp = crate::database::now_ms();
    let (file_name, title) = unique_upload_name(original_name, timestamp);
    let absolute = paths.uploads_dir.join(&file_name);
    crate::storage::write_private(&absolute, bytes)?;

    Ok((
        SavedMedia {
            file_path: absolute,
            url: legacy_track_url("uploads", &file_name),
            file_name,
        },
        if title.is_empty() {
            "Uploaded track".to_string()
        } else {
            title
        },
    ))
}

/// Resolves `/api/media/<bucket>/<name>`, `/downloads/<name>` and
/// `/uploads/<name>` to a file inside the app media root.
pub fn resolve_legacy_media_url(paths: &AppPaths, url: &str) -> Option<PathBuf> {
    let (bucket, raw_name) = url
        .strip_prefix("/api/media/")
        .and_then(|rest| rest.split_once('/'))
        .or_else(|| {
            url.strip_prefix("/downloads/")
                .map(|rest| ("downloads", rest))
        })
        .or_else(|| url.strip_prefix("/uploads/").map(|rest| ("uploads", rest)))?;

    if !matches!(bucket, "downloads" | "uploads") {
        return None;
    }
    let decoded = urlencoding::decode(raw_name).ok()?.to_string();
    let file_name = safe_file_name(&decoded, "audio.mp3");
    let root = paths.media_bucket(bucket)?;
    crate::storage::safe_join(root, &file_name).filter(|candidate| candidate.is_file())
}

/// Resolves the on-disk file for a track: explicit `filePath`, a legacy media
/// URL, or a bare absolute path inside the media directory.
pub fn resolve_track_path(paths: &AppPaths, track: &Track) -> Option<PathBuf> {
    if let Some(file_path) = track.file_path.as_deref() {
        let candidate = PathBuf::from(file_path);
        if candidate.is_file() {
            let media_root = paths.media_dir.canonicalize().ok()?;
            let absolute = candidate.canonicalize().ok()?;
            if absolute.starts_with(&media_root) {
                return Some(absolute);
            }
        }
    }

    if let Some(path) = resolve_legacy_media_url(paths, &track.url) {
        return Some(path);
    }

    let candidate = PathBuf::from(&track.url);
    if candidate.is_absolute() && candidate.is_file() {
        let media_root = paths.media_dir.canonicalize().ok()?;
        let absolute = candidate.canonicalize().ok()?;
        if absolute.starts_with(&media_root) {
            return Some(absolute);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(name: &str) -> (AppPaths, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("aurora-media-{name}-{}", uuid::Uuid::new_v4()));
        (AppPaths::from_root(root.clone()).expect("app paths"), root)
    }

    #[test]
    fn saves_upload_with_safe_name_and_mode() {
        let (paths, root) = temp_paths("upload");
        let (saved, title) =
            save_upload(&paths, b"fake audio bytes", "../My Song?.mp3").expect("save");
        assert_eq!(title, "My Song");
        assert!(saved.file_path.is_file());
        assert!(saved.file_name.ends_with(".mp3"));
        assert!(saved.url.starts_with("/api/media/uploads/"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir_mode = std::fs::metadata(&paths.data_dir)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(dir_mode, 0o700);
        }
        assert_eq!(
            resolve_legacy_media_url(&paths, &saved.url).as_deref(),
            Some(saved.file_path.as_path())
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&saved.file_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_url_resolution_rejects_traversal() {
        let (paths, root) = temp_paths("resolve");
        assert!(
            resolve_legacy_media_url(&paths, "/api/media/downloads/..%2F..%2Fetc%2Fpasswd")
                .is_none()
        );
        assert!(
            resolve_legacy_media_url(&paths, "/api/media/downloads/../../etc/passwd").is_none()
        );
        assert!(resolve_legacy_media_url(&paths, "/api/media/other/x.mp3").is_none());
        assert!(resolve_legacy_media_url(&paths, "https://example.com/x.mp3").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
