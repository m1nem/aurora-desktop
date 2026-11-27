use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Deserialize;

use crate::database::now_ms;
use crate::error::{AppError, AppResult};
use crate::models::jam::{JamSession, JamSessionData};
use crate::models::track::Track;

const SESSION_TTL_MS: i64 = 30 * 60 * 1000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishInput {
    pub session_id: String,
    pub track: Option<Track>,
    pub is_playing: bool,
    pub progress: f64,
    pub host_name: Option<String>,
}

#[derive(Default)]
pub struct JamStore {
    sessions: Mutex<HashMap<String, JamSessionData>>,
}

impl JamStore {
    pub fn publish(&self, input: PublishInput) -> AppResult<usize> {
        if input.session_id.trim().is_empty() {
            return Err(AppError::bad_request("sessionId required"));
        }
        let now = now_ms();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::internal("Jam store is unavailable."))?;
        Self::cleanup_locked(&mut sessions, now);

        let session = sessions
            .entry(input.session_id.clone())
            .or_insert_with(|| JamSessionData {
                session_id: input.session_id.clone(),
                host_name: input
                    .host_name
                    .clone()
                    .unwrap_or_else(|| "Aurora Host".to_string()),
                current_track: None,
                is_playing: false,
                progress: 0.0,
                updated_at: now,
                last_heartbeat: now,
                listeners: HashSet::new(),
            });

        session.current_track = input.track;
        session.is_playing = input.is_playing;
        session.progress = input.progress.max(0.0);
        session.updated_at = now;
        session.last_heartbeat = now;

        Ok(session.listeners.len() + 1)
    }

    pub fn join(&self, session_id: &str, listener_id: &str) -> AppResult<JamSession> {
        if session_id.trim().is_empty() {
            return Err(AppError::bad_request("sessionId required"));
        }
        let now = now_ms();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::internal("Jam store is unavailable."))?;
        Self::cleanup_locked(&mut sessions, now);

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::not_found("Jam session not found or ended by host."))?;

        if !listener_id.is_empty() {
            session.listeners.insert(listener_id.to_string());
        }
        session.last_heartbeat = now;
        Ok(session.public())
    }

    pub fn poll(&self, session_id: &str) -> AppResult<JamSession> {
        if session_id.trim().is_empty() {
            return Err(AppError::bad_request("sessionId parameter missing"));
        }
        let now = now_ms();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::internal("Jam store is unavailable."))?;
        Self::cleanup_locked(&mut sessions, now);

        sessions
            .get(session_id)
            .map(JamSessionData::public)
            .ok_or_else(|| AppError::not_found("Jam session not found or inactive."))
    }

    pub fn leave(&self, session_id: &str, listener_id: &str) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::internal("Jam store is unavailable."))?;
        if let Some(session) = sessions.get_mut(session_id) {
            if !listener_id.is_empty() {
                session.listeners.remove(listener_id);
            }
        }
        Ok(())
    }

    fn cleanup_locked(sessions: &mut HashMap<String, JamSessionData>, now: i64) {
        sessions.retain(|_, session| now - session.last_heartbeat <= SESSION_TTL_MS);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input(session_id: &str) -> PublishInput {
        PublishInput {
            session_id: session_id.to_string(),
            track: Some(Track {
                id: "t1".to_string(),
                title: "Song".to_string(),
                author: "Artist".to_string(),
                album: None,
                duration: 180,
                thumbnail: String::new(),
                url: "/api/media/downloads/t1.mp3".to_string(),
                file_path: None,
                source: "youtube".to_string(),
                cloud_url: None,
                external_uri: None,
                file_size: None,
                uploaded_at: Some(1),
            }),
            is_playing: true,
            progress: 12.5,
            host_name: Some("Host".to_string()),
        }
    }

    #[test]
    fn publish_join_poll_leave_round_trip() {
        let store = JamStore::default();
        assert_eq!(store.publish(sample_input("jam-a")).unwrap(), 1);

        let joined = store.join("jam-a", "listener-1").unwrap();
        assert_eq!(joined.host_name, "Host");
        assert_eq!(joined.listeners_count, 2);
        assert_eq!(
            joined.current_track.as_ref().map(|t| t.id.as_str()),
            Some("t1")
        );
        assert!(joined.is_playing);
        assert!((joined.progress - 12.5).abs() < f64::EPSILON);

        let polled = store.poll("jam-a").unwrap();
        assert_eq!(polled.listeners_count, 2);
        store.leave("jam-a", "listener-1").unwrap();
        assert_eq!(store.poll("jam-a").unwrap().listeners_count, 1);
    }

    #[test]
    fn unknown_or_expired_rooms_are_rejected() {
        let store = JamStore::default();
        assert_eq!(store.poll("missing").unwrap_err().code, "NOT_FOUND");
        store.publish(sample_input("jam-expired")).unwrap();
        {
            let mut sessions = store.sessions.lock().unwrap();
            let session = sessions.get_mut("jam-expired").unwrap();
            session.last_heartbeat = now_ms() - SESSION_TTL_MS - 1;
        }
        assert_eq!(store.poll("jam-expired").unwrap_err().code, "NOT_FOUND");
        assert_eq!(
            store.publish(sample_input("")).unwrap_err().code,
            "BAD_REQUEST"
        );
    }
}
