use serde::{Deserialize, Serialize};

use super::track::Track;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JamSession {
    pub session_id: String,
    pub host_name: String,
    pub current_track: Option<Track>,
    pub is_playing: bool,
    pub progress: f64,
    pub updated_at: i64,
    pub listeners_count: usize,
}

#[derive(Debug, Clone)]
pub struct JamSessionData {
    pub session_id: String,
    pub host_name: String,
    pub current_track: Option<Track>,
    pub is_playing: bool,
    pub progress: f64,
    pub updated_at: i64,
    pub last_heartbeat: i64,
    pub listeners: std::collections::HashSet<String>,
}

impl JamSessionData {
    pub fn public(&self) -> JamSession {
        JamSession {
            session_id: self.session_id.clone(),
            host_name: self.host_name.clone(),
            current_track: self.current_track.clone(),
            is_playing: self.is_playing,
            progress: self.progress,
            updated_at: self.updated_at,
            listeners_count: self.listeners.len() + 1,
        }
    }
}
