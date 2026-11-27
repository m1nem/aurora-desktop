use crate::error::AppResult;
use crate::models::library::{LibraryPayload, Playlist};
use crate::models::track::Track;

use super::{Db, now_ms};

impl Db {
    pub async fn get_library(&self, user_id: &str) -> AppResult<LibraryPayload> {
        let row: Option<(String, String, i64)> =
            sqlx::query_as("SELECT tracks, playlists, updated_at FROM libraries WHERE user_id = ?")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;

        let Some((tracks_json, playlists_json, updated_at)) = row else {
            return Ok(LibraryPayload {
                tracks: Vec::new(),
                playlists: Vec::new(),
                updated_at: 0,
            });
        };

        let tracks: Vec<Track> = serde_json::from_str(&tracks_json).unwrap_or_default();
        let playlists: Vec<Playlist> = serde_json::from_str(&playlists_json).unwrap_or_default();

        Ok(LibraryPayload {
            tracks,
            playlists,
            updated_at,
        })
    }

    pub async fn save_library(
        &self,
        user_id: &str,
        tracks: &[Track],
        playlists: &[Playlist],
        updated_at: i64,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO libraries (user_id, tracks, playlists, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                tracks = excluded.tracks,
                playlists = excluded.playlists,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(user_id)
        .bind(serde_json::to_string(tracks)?)
        .bind(serde_json::to_string(playlists)?)
        .bind(updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Inserts or replaces a track inside the signed-in user's library without
    /// touching playlists. Used by upload/download so a failed client sync can
    /// never lose a freshly created track.
    pub async fn upsert_track(&self, user_id: &str, track: &Track) -> AppResult<()> {
        let mut library = self.get_library(user_id).await?;
        if let Some(existing) = library
            .tracks
            .iter_mut()
            .find(|existing| existing.id == track.id)
        {
            *existing = track.clone();
        } else {
            library.tracks.push(track.clone());
        }
        library.updated_at = now_ms();
        self.save_library(
            user_id,
            &library.tracks,
            &library.playlists,
            library.updated_at,
        )
        .await
    }
}
