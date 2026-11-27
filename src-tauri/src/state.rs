use std::sync::Mutex;

use tokio::sync::OnceCell;

use crate::database::Db;
use crate::discord::DiscordHandle;
use crate::error::AppResult;
use crate::jam::JamStore;
use crate::storage::paths::AppPaths;
use crate::storage::secrets;

/// Shared state injected into every Tauri command.
///
/// The SQLite pool is created lazily on first use so the window can appear
/// immediately, and the session token is cached in memory so that commands do
/// not hit the OS keyring on every keystroke.
pub struct AppState {
    pub paths: AppPaths,
    db: OnceCell<Db>,
    pub jam: JamStore,
    pub discord: DiscordHandle,
    session: Mutex<Option<String>>,
    /// Tests keep the token in memory only; production persists it through the
    /// OS keyring/file fallback.
    persist_session: bool,
}

impl AppState {
    pub fn new(paths: AppPaths) -> Self {
        let session = secrets::load_session_token(&paths);
        let discord = DiscordHandle::spawn(paths.clone());

        Self {
            paths,
            db: OnceCell::new(),
            jam: JamStore::default(),
            discord,
            session: Mutex::new(session),
            persist_session: true,
        }
    }

    pub async fn db(&self) -> AppResult<Db> {
        self.db
            .get_or_try_init(|| Db::connect(&self.paths.db_file))
            .await
            .cloned()
    }

    /// Test-only constructor that does not touch the OS keyring. Kept out of
    /// production builds to avoid accumulating test-only branches.
    #[cfg(test)]
    pub fn new_for_tests(paths: AppPaths) -> Self {
        let discord = DiscordHandle::spawn(paths.clone());
        Self {
            paths,
            db: OnceCell::new(),
            jam: JamStore::default(),
            discord,
            session: Mutex::new(None),
            persist_session: false,
        }
    }

    pub fn session_token(&self) -> Option<String> {
        self.session
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .filter(|value| !value.trim().is_empty())
    }

    pub fn set_session_token(&self, token: Option<&str>) -> AppResult<()> {
        let normalised = token
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        if let Ok(mut current) = self.session.lock() {
            *current = normalised.clone();
        }

        if !self.persist_session {
            return Ok(());
        }

        match normalised {
            Some(value) => secrets::save_session_token(&self.paths, &value).map_err(|error| {
                log::warn!("could not persist the session token: {error}");
                crate::error::AppError::internal(
                    "Signed in, but the session could not be saved securely.",
                )
            })?,
            None => secrets::clear_session_token(&self.paths),
        }
        Ok(())
    }
}
