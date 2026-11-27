use std::path::PathBuf;
use std::time::Duration;

use tokio::process::Command;
use tokio::sync::OnceCell;

use crate::error::{AppError, AppResult};
use crate::models::track::SearchResult;
use crate::networking::youtube::{clean_artist_name, clean_track_title};
use crate::storage::paths::AppPaths;

#[derive(Debug, Clone)]
pub struct YtDlpCommand {
    pub program: String,
    pub prefix_args: Vec<String>,
    pub source: String,
}

static RESOLVED: OnceCell<YtDlpCommand> = OnceCell::const_new();
const VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

fn bundled_binary(paths: &AppPaths) -> PathBuf {
    #[cfg(windows)]
    {
        paths.bin_dir.join("yt-dlp.exe")
    }
    #[cfg(not(windows))]
    {
        paths.bin_dir.join("yt-dlp")
    }
}

fn release_asset_name() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else if cfg!(target_arch = "arm") {
        "yt-dlp_linux_armv7l"
    } else {
        "yt-dlp_linux"
    }
}

async fn run_collect(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<(i32, String, String), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = command.spawn().map_err(|error| error.to_string())?;
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| format!("Timed out after {}s", timeout.as_secs()))?
        .map_err(|error| error.to_string())?;

    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

async fn test_command(program: &str, prefix_args: &[String], source: &str) -> Option<YtDlpCommand> {
    let mut args = prefix_args.to_vec();
    args.push("--version".to_string());

    let (code, stdout, _) = run_collect(program, &args, VERSION_TIMEOUT).await.ok()?;
    if code == 0 && stdout.chars().any(|ch| ch.is_ascii_digit()) && stdout.contains('.') {
        Some(YtDlpCommand {
            program: program.to_string(),
            prefix_args: prefix_args.to_vec(),
            source: source.to_string(),
        })
    } else {
        None
    }
}

async fn download_binary(paths: &AppPaths) -> Option<YtDlpCommand> {
    let destination = bundled_binary(paths);
    if destination.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o755));
        }
        if let Some(command) =
            test_command(destination.to_string_lossy().as_ref(), &[], "bundled").await
        {
            return Some(command);
        }
        let _ = std::fs::remove_file(&destination);
    }

    let asset = release_asset_name();
    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}");
    log::info!("yt-dlp was not found locally; downloading {asset}");

    let response = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent("AuroraMP/1.0")
        .build()
        .ok()?
        .get(url)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        log::warn!("yt-dlp download failed with HTTP {}", response.status());
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    if bytes.len() < 100_000 {
        log::warn!("yt-dlp download was suspiciously small");
        return None;
    }

    let tmp = destination.with_extension("tmp-download");
    std::fs::write(&tmp, &bytes).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).ok()?;
    }
    std::fs::rename(&tmp, &destination).ok()?;

    let command = test_command(destination.to_string_lossy().as_ref(), &[], "downloaded").await;
    if command.is_some() {
        log::info!("installed bundled yt-dlp at {}", destination.display());
    }
    command
}

async fn resolve_inner(paths: &AppPaths) -> Result<YtDlpCommand, AppError> {
    for variable in ["AURORA_YTDLP_PATH", "YT_DLP_PATH"] {
        if let Ok(value) = std::env::var(variable) {
            if !value.trim().is_empty() {
                if let Some(command) = test_command(&value, &[], "env").await {
                    return Ok(command);
                }
                log::warn!("{variable} is set but is not a working yt-dlp binary: {value}");
            }
        }
    }

    if let Some(command) = test_command("yt-dlp", &[], "path").await {
        return Ok(command);
    }

    let bundled = bundled_binary(paths);
    if let Some(command) = test_command(bundled.to_string_lossy().as_ref(), &[], "bundled").await {
        return Ok(command);
    }

    // AURORA_FIX_YTDLP_NO_SILENT_DL_V1
    let _ = download_binary;
    for python in ["python3", "python"] {
        let prefix = vec!["-m".to_string(), "yt_dlp".to_string()];
        if let Some(command) = test_command(python, &prefix, "python-module").await {
            return Ok(command);
        }
    }

    Err(AppError::unavailable(
        "yt-dlp was not found on this system. AuroraMP does not download external binaries silently. Install yt-dlp (e.g. `sudo pacman -S yt-dlp` or `pipx install yt-dlp`) or set AURORA_YTDLP_PATH, then retry.",
    ))
}

pub async fn resolve_ytdlp(paths: &AppPaths) -> AppResult<YtDlpCommand> {
    RESOLVED
        .get_or_try_init(|| resolve_inner(paths))
        .await
        .cloned()
}

pub async fn run_ytdlp(paths: &AppPaths, args: &[String], timeout: Duration) -> AppResult<String> {
    let command = resolve_ytdlp(paths).await?;
    let mut all_args = command.prefix_args.clone();
    all_args.extend_from_slice(args);

    let (code, stdout, stderr) = run_collect(&command.program, &all_args, timeout)
        .await
        .map_err(AppError::internal)?;

    if code == 0 {
        return Ok(stdout);
    }

    let tail: String = {
        let combined = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        let chars: Vec<char> = combined.trim().chars().collect();
        chars[chars.len().saturating_sub(1200)..].iter().collect()
    };
    Err(AppError::internal(format!(
        "yt-dlp exited with code {code}: {tail}"
    )))
}

/// Downloads a YouTube video's audio into the app media root as MP3.
/// Returns an existing file unchanged (the download cache).
pub async fn download_audio(paths: &AppPaths, video_id: &str) -> AppResult<PathBuf> {
    if video_id.len() > 32
        || video_id.is_empty()
        || !video_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(AppError::bad_request("Invalid id"));
    }

    std::fs::create_dir_all(&paths.downloads_dir)?;
    let absolute = paths.downloads_dir.join(format!("{video_id}.mp3"));
    if std::fs::metadata(&absolute)
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false)
    {
        return Ok(absolute);
    }

    let template = paths.downloads_dir.join(format!("{video_id}.%(ext)s"));
    let mut args = vec![
        "--extract-audio".to_string(),
        "--audio-format".to_string(),
        "mp3".to_string(),
        "--audio-quality".to_string(),
        "0".to_string(),
        "--format".to_string(),
        "bestaudio/best".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--no-part".to_string(),
        "--no-mtime".to_string(),
        "--restrict-filenames".to_string(),
        "--retries".to_string(),
        "3".to_string(),
        "--fragment-retries".to_string(),
        "3".to_string(),
        "--concurrent-fragments".to_string(),
        "4".to_string(),
    ];
    args.extend(ffmpeg_args());
    args.extend(cookie_args());
    args.push("-o".to_string());
    args.push(template.to_string_lossy().to_string());
    args.push(format!("https://www.youtube.com/watch?v={video_id}"));

    run_ytdlp(paths, &args, Duration::from_secs(300)).await?;

    if !absolute.is_file()
        || std::fs::metadata(&absolute)
            .map(|meta| meta.len())
            .unwrap_or(0)
            == 0
    {
        return Err(AppError::internal(
            "yt-dlp finished but no MP3 was produced. Make sure ffmpeg is installed (or set AURORA_FFMPEG_PATH).",
        ));
    }
    Ok(absolute)
}

pub fn ffmpeg_args() -> Vec<String> {
    match std::env::var("AURORA_FFMPEG_PATH") {
        Ok(value) if !value.trim().is_empty() => {
            vec!["--ffmpeg-location".to_string(), value]
        }
        _ => Vec::new(),
    }
}

pub fn cookie_args() -> Vec<String> {
    match std::env::var("AURORA_YTDLP_COOKIES") {
        Ok(value) if std::path::Path::new(&value).is_file() => {
            vec!["--cookies".to_string(), value]
        }
        _ => Vec::new(),
    }
}

pub async fn search_fallback(
    paths: &AppPaths,
    query: &str,
    limit: usize,
) -> AppResult<Vec<SearchResult>> {
    let mut args = vec![
        "--dump-single-json".to_string(),
        "--flat-playlist".to_string(),
        "--no-warnings".to_string(),
        "--skip-download".to_string(),
        "--playlist-end".to_string(),
        limit.to_string(),
        format!("ytsearch{limit}:{query}"),
    ];
    args.extend(cookie_args());

    let stdout = run_ytdlp(paths, &args, Duration::from_secs(45)).await?;
    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|error| AppError::internal(error.to_string()))?;

    let entries = value
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut results = Vec::new();
    for entry in entries {
        let id = entry
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let raw_title = entry
            .get("title")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if id.is_empty() || raw_title.is_empty() {
            continue;
        }
        let raw_author = entry
            .get("uploader")
            .or_else(|| entry.get("channel"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let author = clean_artist_name(raw_author, "Unknown artist");
        let thumbnail = entry
            .get("thumbnail")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                entry
                    .get("thumbnails")
                    .and_then(serde_json::Value::as_array)
                    .and_then(|items| items.last())
                    .and_then(|item| item.get("url"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));
        let duration = entry
            .get("duration")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0) as u64;

        results.push(SearchResult {
            id: id.to_string(),
            title: clean_track_title(raw_title, &author),
            author,
            album: None,
            duration,
            thumbnail,
        });
    }

    Ok(results)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpStatus {
    pub available: bool,
    pub source: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

pub async fn status(paths: &AppPaths) -> YtDlpStatus {
    // Unlike `resolve_ytdlp`, diagnostics must never trigger a network
    // download just because the user opened Settings.
    for variable in ["AURORA_YTDLP_PATH", "YT_DLP_PATH"] {
        if let Ok(value) = std::env::var(variable) {
            if !value.trim().is_empty() {
                if let Some(command) = test_command(&value, &[], "env").await {
                    return available_status(&command).await;
                }
            }
        }
    }
    if let Some(command) = test_command("yt-dlp", &[], "path").await {
        return available_status(&command).await;
    }
    let bundled = bundled_binary(paths);
    if bundled.exists() {
        if let Some(command) =
            test_command(bundled.to_string_lossy().as_ref(), &[], "bundled").await
        {
            return available_status(&command).await;
        }
    }
    for python in ["python3", "python"] {
        let prefix = vec!["-m".to_string(), "yt_dlp".to_string()];
        if let Some(command) = test_command(python, &prefix, "python-module").await {
            return available_status(&command).await;
        }
    }

    YtDlpStatus {
        available: false,
        source: None,
        version: None,
        error: Some(
            "yt-dlp was not found. Install it with `pipx install yt-dlp` or let Aurora download it on the first download."
                .to_string(),
        ),
    }
}

async fn available_status(command: &YtDlpCommand) -> YtDlpStatus {
    let mut args = command.prefix_args.clone();
    args.push("--version".to_string());
    let version = run_collect(&command.program, &args, VERSION_TIMEOUT)
        .await
        .ok()
        .map(|(_, stdout, _)| stdout.trim().to_string())
        .filter(|value| !value.is_empty());
    YtDlpStatus {
        available: true,
        source: Some(command.source.clone()),
        version,
        error: None,
    }
}

#[cfg(test)]
mod live_tests {
    use super::status;
    use crate::storage::paths::AppPaths;

    #[tokio::test]
    #[ignore = "requires network access and an installed yt-dlp binary"]
    async fn live_ytdlp_search_fallback() {
        let root =
            std::env::temp_dir().join(format!("aurora-ytdlp-search-{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_root(root.clone()).expect("paths");
        let results = super::search_fallback(&paths, "Linked Horizon", 3)
            .await
            .expect("fallback search");
        assert!(!results.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore = "downloads a short YouTube video and requires network + ffmpeg"]
    async fn live_ytdlp_download() {
        let root =
            std::env::temp_dir().join(format!("aurora-ytdlp-download-{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_root(root.clone()).expect("paths");
        // "Me at the zoo" is 19 seconds long and safe for a download test.
        let file = super::download_audio(&paths, "jNQXAC9IVRw")
            .await
            .expect("download audio");
        assert!(file.is_file());
        assert!(std::fs::metadata(&file).unwrap().len() > 1000);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an installed yt-dlp binary"]
    async fn live_ytdlp_status() {
        let root = std::env::temp_dir().join(format!("aurora-ytdlp-live-{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_root(root.clone()).expect("paths");
        let status = status(&paths).await;
        assert!(status.available, "yt-dlp missing: {:?}", status.error);
        assert!(status.version.is_some());
        std::fs::remove_dir_all(root).unwrap();
    }
}
