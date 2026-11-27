use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

// AURORA_FIX_DESKTOP_INTEGRATION_V1
pub const AUDIO_MIME_TYPES: [&str; 12] = [
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/ogg",
    "audio/x-ogg",
    "audio/flac",
    "audio/x-flac",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
    "audio/opus",
    "audio/webm",
];

pub const AUDIO_EXTENSIONS: [&str; 9] = [
    "mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "webm",
];

const DESKTOP_ID: &str = "auroramp.desktop";
const APP_ICON_NAME: &str = "auroramp";
const ICON_BYTES: &[u8] = include_bytes!("../icons/128x128.png");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MimeDefault {
    pub mime: String,
    pub desktop_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioIntegrationStatus {
    pub supported_mime_types: Vec<String>,
    pub supported_extensions: Vec<String>,
    pub desktop_file: String,
    pub desktop_file_exists: bool,
    pub executable: String,
    pub can_restore_defaults: bool,
    pub defaults: Vec<MimeDefault>,
}

fn backup_file() -> AppResult<PathBuf> {
    Ok(data_home()?
        .join("aurora-desktop")
        .join("mime-defaults-backup.json"))
}

fn data_home() -> AppResult<PathBuf> {
    dirs::data_dir().ok_or_else(|| AppError::internal("Could not locate the XDG data directory."))
}

fn applications_dir() -> AppResult<PathBuf> {
    Ok(data_home()?.join("applications"))
}

fn desktop_file() -> AppResult<PathBuf> {
    Ok(applications_dir()?.join(DESKTOP_ID))
}

fn icon_file() -> AppResult<PathBuf> {
    Ok(data_home()?
        .join("icons")
        .join("hicolor")
        .join("128x128")
        .join("apps")
        .join(format!("{APP_ICON_NAME}.png")))
}

fn current_executable() -> AppResult<String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| {
            AppError::internal(format!("Could not locate the AuroraMP executable: {error}"))
        })
}

fn xdg_mime_default(mime: &str) -> Option<String> {
    let output = Command::new("xdg-mime")
        .args(["query", "default", mime])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() || value == "none" {
        None
    } else {
        Some(value)
    }
}

pub fn status() -> AppResult<AudioIntegrationStatus> {
    let desktop = desktop_file()?;
    let can_restore_defaults = backup_file().map(|p| p.is_file()).unwrap_or(false);
    Ok(AudioIntegrationStatus {
        supported_mime_types: AUDIO_MIME_TYPES
            .iter()
            .map(|value| value.to_string())
            .collect(),
        supported_extensions: AUDIO_EXTENSIONS
            .iter()
            .map(|value| value.to_string())
            .collect(),
        desktop_file_exists: desktop.is_file(),
        desktop_file: desktop.to_string_lossy().to_string(),
        executable: current_executable()?,
        can_restore_defaults,
        defaults: AUDIO_MIME_TYPES
            .iter()
            .map(|mime| MimeDefault {
                mime: (*mime).to_string(),
                desktop_file: xdg_mime_default(mime),
            })
            .collect(),
    })
}

fn write_desktop_entry() -> AppResult<PathBuf> {
    let executable = current_executable()?;
    let desktop = desktop_file()?;
    if let Some(parent) = desktop.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let escaped = executable.replace('\\', "\\\\").replace('"', "\\\"");
    let mime = AUDIO_MIME_TYPES.join(";");
    let entry = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name=AuroraMP\n\
         GenericName=Music Player\n\
         Comment=Terminal-inspired desktop music player\n\
         Exec=\"{escaped}\" %U\n\
         TryExec={escaped}\n\
         Icon={APP_ICON_NAME}\n\
         Terminal=false\n\
         Categories=AudioVideo;Audio;Player;\n\
         MimeType={mime};\n\
         StartupNotify=true\n\
         StartupWMClass=AuroraMP\n"
    );
    crate::storage::write_private(&desktop, entry.as_bytes())?;

    let icon = icon_file()?;
    if let Some(parent) = icon.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&icon, ICON_BYTES)?;
    Ok(desktop)
}

fn save_mime_backup_if_missing() -> AppResult<()> {
    let path = backup_file()?;
    if path.is_file() {
        return Ok(());
    }
    let mut map = std::collections::BTreeMap::new();
    for mime in AUDIO_MIME_TYPES {
        map.insert(mime.to_string(), xdg_mime_default(mime));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_vec_pretty(&map)
        .map_err(|error| AppError::internal(format!("Could not serialize MIME backup: {error}")))?;
    crate::storage::write_private(&path, &payload)?;
    Ok(())
}

pub fn set_default_player() -> AppResult<AudioIntegrationStatus> {
    save_mime_backup_if_missing()?;
    write_desktop_entry()?;

    if let Ok(apps) = applications_dir() {
        let _ = Command::new("update-desktop-database").arg(apps).status();
    }

    let status = Command::new("xdg-mime")
        .arg("default")
        .arg(DESKTOP_ID)
        .args(AUDIO_MIME_TYPES)
        .status();
    let status = match status {
        Ok(status) => status,
        Err(error) => {
            return Err(AppError::unavailable(format!(
                "xdg-mime is not available ({error}). Install xdg-utils to set the default player."
            )));
        }
    };
    if !status.success() {
        return Err(AppError::internal(
            "xdg-mime could not update the default audio handler.",
        ));
    }

    status_report()
}

pub fn restore_default_player() -> AppResult<AudioIntegrationStatus> {
    let path = backup_file()?;
    if !path.is_file() {
        return Err(AppError::bad_request(
            "No previous audio association backup was found.",
        ));
    }
    let raw = std::fs::read_to_string(&path)?;
    let previous: std::collections::BTreeMap<String, Option<String>> = serde_json::from_str(&raw)
        .map_err(|error| AppError::internal(format!("Invalid MIME backup file: {error}")))?;

    for (mime, handler) in previous {
        if let Some(desktop) = handler.filter(|value| !value.trim().is_empty()) {
            let status = Command::new("xdg-mime")
                .args(["default", &desktop, &mime])
                .status()
                .map_err(|error| {
                    AppError::unavailable(format!(
                        "xdg-mime is not available ({error}). Install xdg-utils to restore defaults."
                    ))
                })?;
            if !status.success() {
                return Err(AppError::internal(format!(
                    "xdg-mime could not restore {mime} to {desktop}."
                )));
            }
        }
    }

    let _ = std::fs::remove_file(&path);
    status_report()
}

fn status_report() -> AppResult<AudioIntegrationStatus> {
    // Re-query so the caller sees the actual xdg-mime result, not an assumed
    // success. `status()` already does this; kept as a named helper for intent.
    status()
}

pub fn is_audio_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| AUDIO_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn startup_audio_paths() -> Vec<PathBuf> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let raw = arg
                .strip_prefix("file://")
                .map(|rest| {
                    urlencoding::decode(rest)
                        .unwrap_or_else(|_| rest.into())
                        .into_owned()
                })
                .unwrap_or(arg);
            let path = PathBuf::from(raw);
            path.is_file().then_some(path)
        })
        .filter(|path| is_audio_extension(path))
        .collect()
}
