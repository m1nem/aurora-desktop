use std::path::Path;

use lofty::file::AudioFile;
use lofty::probe::read_from_path;

/// Reads the duration in seconds from a local audio file. Returns 0 when the
/// format is unsupported or metadata is missing.
pub fn read_duration_seconds(path: &Path) -> u64 {
    let Ok(tagged) = read_from_path(path) else {
        return 0;
    };
    let duration = tagged.properties().duration();
    duration.as_secs()
}
