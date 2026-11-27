use serde::{Deserialize, Serialize};

use super::track::Track;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPayload {
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverResult {
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub added: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportStats {
    pub total_rows: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub ok: bool,
    pub playlist: Playlist,
    pub playlists: Vec<Playlist>,
    pub tracks: Vec<Track>,
    pub stats: CsvImportStats,
    pub updated_at: i64,
}
