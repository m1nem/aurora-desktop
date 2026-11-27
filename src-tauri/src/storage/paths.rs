use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The data directory contains password hashes, TOTP secrets and session
/// tokens, so it must not be traversable by other local users. `0600` is used
/// for individual secret files; directories are `0700`.
fn restrict_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o700);
        std::fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

/// Every writable location used by the desktop app. All directories live under
/// the XDG data dir (`~/.local/share/aurora-desktop` on Linux).
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_file: PathBuf,
    pub media_dir: PathBuf,
    pub downloads_dir: PathBuf,
    pub uploads_dir: PathBuf,
    pub plugins_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub session_file: PathBuf,
    pub outbox_file: PathBuf,
}

impl AppPaths {
    pub fn new() -> AppResult<Self> {
        let root = match std::env::var_os("AURORA_APP_DATA_DIR") {
            Some(value) if !value.is_empty() => PathBuf::from(value),
            _ => dirs::data_dir()
                .ok_or_else(|| AppError::internal("Could not determine the user data directory."))?
                .join("aurora-desktop"),
        };

        Self::from_root(root)
    }

    pub fn from_root(root: PathBuf) -> AppResult<Self> {
        let paths = Self {
            db_file: root.join("aurora.db"),
            media_dir: root.join("media"),
            downloads_dir: root.join("media").join("downloads"),
            uploads_dir: root.join("media").join("uploads"),
            plugins_dir: root.join("plugins"),
            bin_dir: root.join("bin"),
            backups_dir: root.join("backups"),
            logs_dir: root.join("logs"),
            session_file: root.join("session.token"),
            outbox_file: root.join("email-outbox.log"),
            data_dir: root,
        };
        paths.ensure()?;
        Ok(paths)
    }

    pub fn ensure(&self) -> AppResult<()> {
        for dir in [
            &self.data_dir,
            &self.media_dir,
            &self.downloads_dir,
            &self.uploads_dir,
            &self.plugins_dir,
            &self.bin_dir,
            &self.backups_dir,
            &self.logs_dir,
        ] {
            std::fs::create_dir_all(dir)?;
            restrict_permissions(dir)?;
        }
        Ok(())
    }

    pub fn media_bucket(&self, bucket: &str) -> Option<&Path> {
        match bucket {
            "downloads" => Some(&self.downloads_dir),
            "uploads" => Some(&self.uploads_dir),
            _ => None,
        }
    }
}
