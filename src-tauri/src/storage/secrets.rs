use crate::storage::paths::AppPaths;

const KEYRING_SERVICE: &str = "aurora-desktop";
const KEYRING_ACCOUNT: &str = "session-token";

/// Loads the persisted session token. The 0600 file is checked first because it
/// is local and immediate; the OS keyring is only consulted when no file exists.
/// This keeps startup independent of a slow/locked secret-service daemon.
pub fn load_session_token(paths: &AppPaths) -> Option<String> {
    if let Ok(token) = std::fs::read_to_string(&paths.session_file) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Some(token);
        }
    }

    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).ok()?;
    let token = entry.get_password().ok()?;
    let token = token.trim().to_string();
    if token.is_empty() { None } else { Some(token) }
}

/// Persists the token to the 0600 file immediately and updates the keyring on a
/// detached thread. Login must not block on a keyring unlock prompt.
pub fn save_session_token(paths: &AppPaths, token: &str) -> Result<(), String> {
    crate::storage::write_private(&paths.session_file, token.as_bytes())
        .map_err(|error| error.to_string())?;

    let paths = paths.clone();
    let token = token.to_string();
    std::thread::spawn(move || {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
            if let Err(error) = entry.set_password(&token) {
                log::warn!("could not update the session keyring: {error}");
            }
        }
        let _ = paths;
    });

    Ok(())
}

pub fn clear_session_token(paths: &AppPaths) {
    let _ = std::fs::remove_file(&paths.session_file);
    std::thread::spawn(|| {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
            let _ = entry.delete_credential();
        }
    });
}
