use serde::{Deserialize, Serialize};

pub const VALID_SOURCES: [&str; 4] = ["youtube", "local", "cloud", "imported"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    pub duration: u64,
    pub thumbnail: String,
    pub url: String,
    /// Absolute on-disk path. The frontend converts this with `convertFileSrc`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uploaded_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    pub duration: u64,
    pub thumbnail: String,
}
