use std::path::{Path, PathBuf};

pub mod paths;
pub mod secrets;

/// Sanitizes a user-provided file name. Never returns a path separator.
pub fn safe_file_name(name: &str, fallback: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);
    let cleaned: String = base
        .chars()
        .filter(|ch| !ch.is_control())
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

/// Joins `relative` to `root` and rejects traversal outside the root.
pub fn safe_join(root: &Path, relative: &str) -> Option<PathBuf> {
    let cleaned = relative
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if cleaned.is_empty() || cleaned.contains('\0') {
        return None;
    }

    let candidate = Path::new(&cleaned);
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return None;
    }

    let root = root.canonicalize().ok()?;
    let joined = root.join(candidate);
    let absolute = if joined.exists() {
        joined.canonicalize().ok()?
    } else {
        let parent = joined.parent()?.canonicalize().ok()?;
        parent.join(joined.file_name()?)
    };

    if absolute.starts_with(&root) {
        Some(absolute)
    } else {
        None
    }
}

pub fn random_suffix(len: usize) -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

pub fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("aurora-storage-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("temp root");
        root
    }

    #[test]
    fn safe_file_name_strips_paths_and_controls() {
        assert_eq!(safe_file_name("../etc/passwd", "fallback"), "passwd");
        assert_eq!(safe_file_name("a/b/c.mp3", "fallback"), "c.mp3");
        assert_eq!(safe_file_name("..", "fallback"), "fallback");
        assert_eq!(
            safe_file_name("bad\u{0}name.mp3", "fallback"),
            "badname.mp3"
        );
        assert_eq!(safe_file_name("", "fallback"), "fallback");
    }

    #[test]
    fn safe_join_rejects_traversal_and_accepts_nested_file() {
        let root = temp_root("join");
        let nested = root.join("media").join("x.mp3");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, b"audio").unwrap();

        let joined = safe_join(&root, "media/x.mp3").expect("allowed path");
        assert_eq!(joined, nested.canonicalize().unwrap());
        assert!(safe_join(&root, "../escape.mp3").is_none());
        assert!(safe_join(&root, "media/../../escape.mp3").is_none());
        assert!(safe_join(&root, "").is_none());
        let allow_create = safe_join(&root, "media/nope.mp3").expect("new file path");
        assert!(allow_create.starts_with(root.canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn private_writes_are_owner_only_on_unix() {
        let root = temp_root("private");
        let path = root.join("secret.txt");
        write_private(&path, b"token").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "token");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
