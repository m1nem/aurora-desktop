
#[allow(dead_code)]
fn format_mm_ss_bar(elapsed: Option<f64>, duration: Option<f64>, is_playing: bool) -> String {
    let fmt = |secs: f64| -> String {
        let s = secs.max(0.0).floor() as u64;
        let h = s / 3600;
        let m = (s % 3600) / 60;
        let sec = s % 60;
        if h > 0 { format!("{:02}:{:02}:{:02}", h, m, sec) } else { format!("{:02}:{:02}", m, sec) }
    };
    let pos = elapsed.unwrap_or(0.0);
    let dur = duration.unwrap_or(0.0);
    let bar = if dur > 0.0 { format!("{} / {}", fmt(pos), fmt(dur)) } else { fmt(pos) };
    if is_playing { bar } else { format!("Paused • {}", bar) }
}

use std::io::{Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use crate::storage::paths::AppPaths;

pub const DEFAULT_CLIENT_ID: &str = "1548485673789423636";
const APP_ORIGIN: &str = "https://auroramp.vercel.app";
const SMALL_IMAGE_KEY: &str = "auroramp_logo";
const SMALL_IMAGE_TEXT: &str = "AuroraMP";
const LARGE_IMAGE_FALLBACK: &str = "aurora_logo";
const TEXT_LIMIT: usize = 128;
const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    pub ready: bool,
    pub app_id: Option<String>,
    pub activity: Option<String>,
    pub error: Option<String>,
}

pub enum DiscordCommand {
    Set(Value),
    Probe(String),
    Clear,
    Shutdown,
}

#[derive(Clone)]
pub struct DiscordHandle {
    sender: Sender<DiscordCommand>,
    status: Arc<Mutex<DiscordStatus>>,
}

impl DiscordHandle {
    pub fn spawn(_paths: AppPaths) -> Self {
        let (sender, receiver) = mpsc::channel();
        let status = Arc::new(Mutex::new(DiscordStatus {
            ready: false,
            app_id: None,
            activity: None,
            error: None,
        }));
        let worker_status = Arc::clone(&status);
        std::thread::Builder::new()
            .name("aurora-discord-ipc".to_string())
            .spawn(move || worker_loop(receiver, worker_status))
            .ok();

        Self { sender, status }
    }

    pub fn send_activity(&self, payload: Value) -> bool {
        self.sender.send(DiscordCommand::Set(payload)).is_ok()
    }

    /// Opens (or reuses) the IPC connection without setting an activity.
    pub fn probe(&self, app_id: Option<&str>) {
        let app_id = normalize_app_id(app_id).unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
        let _ = self.sender.send(DiscordCommand::Probe(app_id));
    }

    pub fn clear(&self) {
        let _ = self.sender.send(DiscordCommand::Clear);
    }

    pub fn shutdown(&self) {
        let _ = self.sender.send(DiscordCommand::Shutdown);
    }

    pub fn status(&self) -> DiscordStatus {
        self.status
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }
}

fn worker_loop(receiver: mpsc::Receiver<DiscordCommand>, status: Arc<Mutex<DiscordStatus>>) {
    let mut connection: Option<Connection> = None;
    let mut active_app_id: Option<String> = None;
    let mut last_activity: Option<Value> = None;

    loop {
        let command = match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };

        match command {
            DiscordCommand::Shutdown => {
                if let Some(connection) = connection.as_mut() {
                    let _ = connection.send_activity(Value::Null);
                }
                break;
            }
            DiscordCommand::Probe(app_id) => {
                if active_app_id.as_deref() != Some(app_id.as_str()) {
                    connection = None;
                    active_app_id = Some(app_id.clone());
                }
                if connection.is_none() {
                    match Connection::connect(&app_id) {
                        Ok(value) => {
                            connection = Some(value);
                            if let Ok(mut status) = status.lock() {
                                status.ready = true;
                                status.app_id = Some(app_id.clone());
                                status.error = None;
                            }
                        }
                        Err(error) => {
                            if let Ok(mut status) = status.lock() {
                                status.ready = false;
                                status.app_id = Some(app_id.clone());
                                status.error = Some(error);
                            }
                        }
                    }
                } else if let Ok(mut status) = status.lock() {
                    status.ready = true;
                    status.app_id = Some(app_id.clone());
                    status.error = None;
                }
            }
            DiscordCommand::Clear => {
                last_activity = None;
                if let Some(connection) = connection.as_mut() {
                    let _ = connection.send_activity(Value::Null);
                }
                if let Ok(mut status) = status.lock() {
                    status.activity = None;
                    status.error = None;
                }
            }
            DiscordCommand::Set(payload) => {
                let app_id = normalize_app_id(payload.get("appId").and_then(Value::as_str))
                    .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());

                if active_app_id.as_deref() != Some(app_id.as_str()) {
                    connection = None;
                    active_app_id = Some(app_id.clone());
                }

                if connection.is_none() {
                    match Connection::connect(&app_id) {
                        Ok(value) => {
                            if let Ok(mut status) = status.lock() {
                                status.ready = true;
                                status.app_id = Some(app_id.clone());
                                status.error = None;
                            }
                            connection = Some(value);
                        }
                        Err(error) => {
                            if let Ok(mut status) = status.lock() {
                                status.ready = false;
                                status.app_id = Some(app_id.clone());
                                status.error = Some(error);
                            }
                            continue;
                        }
                    }
                }

                let activity = build_activity(&payload);
                let summary = format!(
                    "{} - {} [{}]",
                    activity
                        .get("details")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown title"),
                    payload
                        .get("track")
                        .and_then(|track| track.get("author"))
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown artist"),
                    if payload
                        .get("isPlaying")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        "PLAY"
                    } else {
                        "PAUSE"
                    }
                );

                let send_result = connection
                    .as_mut()
                    .map(|value| value.send_activity(activity))
                    .unwrap_or(Err("Discord is not connected.".to_string()));

                match send_result {
                    Ok(()) => {
                        last_activity = Some(payload);
                        if let Ok(mut status) = status.lock() {
                            status.ready = true;
                            status.activity = Some(summary);
                            status.error = None;
                        }
                    }
                    Err(error) => {
                        connection = None;
                        if let Ok(mut status) = status.lock() {
                            status.ready = false;
                            status.error = Some(error);
                        }
                    }
                }
            }
        }

        // Reconnect with the most recent activity if the socket dropped and a
        // later command only wanted diagnostics. This keeps the last presence.
        if connection.is_none() {
            if let Some(activity) = last_activity.as_ref() {
                let app_id = normalize_app_id(activity.get("appId").and_then(Value::as_str))
                    .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
                if let Ok(value) = Connection::connect(&app_id) {
                    connection = Some(value);
                }
            }
        }
    }
}

fn normalize_app_id(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.len() >= 17 && value.len() <= 20 && value.chars().all(|ch| ch.is_ascii_digit()) {
        Some(value.to_string())
    } else {
        None
    }
}

fn truncate(value: &str, fallback: &str) -> String {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = if text.is_empty() {
        fallback.to_string()
    } else {
        text
    };
    text.chars().take(TEXT_LIMIT).collect()
}

fn source_label(source: Option<&str>) -> &'static str {
    match source {
        Some("youtube") => "YouTube Music",
        Some("local") => "Local library",
        Some("cloud") => "AuroraMP Cloud",
        _ => "AuroraMP",
    }
}

fn build_presence_text(track: &Value, is_playing: bool) -> (String, String) {
    let details = truncate(
        track.get("title").and_then(Value::as_str).unwrap_or(""),
        "Unknown title",
    );
    let author = truncate(
        track.get("author").and_then(Value::as_str).unwrap_or(""),
        "Unknown artist",
    );
    let source = source_label(track.get("source").and_then(Value::as_str));

    let mut state = if author == details {
        source.to_string()
    } else {
        format!("{author} • {source}")
    };
    if state == details {
        state = format!("{source} • AuroraMP");
    }
    if !is_playing {
        state = format!("Paused • {state}");
    }
    if state == details {
        state = format!("{state} • AuroraMP");
    }

    (details, state.chars().take(TEXT_LIMIT).collect())
}

fn build_activity(payload: &Value) -> Value {
    let track = payload.get("track").cloned().unwrap_or_else(|| json!({}));
    let is_playing = payload
        .get("isPlaying")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let duration = payload
        .get("duration")
        .and_then(Value::as_f64)
        .or_else(|| track.get("duration").and_then(Value::as_f64))
        .unwrap_or(0.0)
        .max(0.0);
    let progress = payload
        .get("progress")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .max(0.0);

    let now = crate::database::now_ms();
    let (details, state) = build_presence_text(&track, is_playing);

    let timestamps = if is_playing {
        let start = now - (progress * 1000.0) as i64;
        let mut timestamps = json!({ "start": start });
        if duration > 0.0 {
            let end = now + ((duration - progress).max(0.0) * 1000.0) as i64;
            if end > start {
                timestamps["end"] = json!(end);
            }
        }
        Some(timestamps)
    } else {
        None
    };

    let title = track
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Unknown title");
    let thumbnail = track
        .get("thumbnail")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("https://"))
        .unwrap_or(LARGE_IMAGE_FALLBACK);

    let track_id =
        urlencoding::encode(track.get("id").and_then(Value::as_str).unwrap_or("current"));
    let session_id = urlencoding::encode(
        payload
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or("live"),
    );

    let mut activity = json!({
        "type": 2,
        "details": details,
        "state": state,
        "assets": {
            "large_image": thumbnail,
            "large_text": truncate(title, "Unknown title"),
            "small_image": SMALL_IMAGE_KEY,
            "small_text": SMALL_IMAGE_TEXT
        },
        "buttons": [
            { "label": "Show Track", "url": format!("{APP_ORIGIN}/track/{track_id}") },
            { "label": "Listen Along (WIP)", "url": format!("{APP_ORIGIN}/jam/{session_id}") }
        ],
        "instance": false
    });

    if let Some(timestamps) = timestamps {
        activity["timestamps"] = timestamps;
    }

    activity
}

#[cfg(unix)]
struct Connection {
    stream: std::os::unix::net::UnixStream,
}

#[cfg(not(unix))]
struct Connection;

#[cfg(unix)]
impl Connection {
    fn connect(app_id: &str) -> Result<Self, String> {
        let socket = find_discord_socket().ok_or_else(|| {
            "Discord IPC socket was not found. Is the Discord desktop app running?".to_string()
        })?;
        let stream = std::os::unix::net::UnixStream::connect(&socket)
            .map_err(|error| format!("Could not connect to {}: {error}", socket.display()))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(7)))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(7)))
            .map_err(|error| error.to_string())?;

        let mut connection = Self { stream };
        connection
            .send_frame(0, &json!({ "v": 1, "client_id": app_id }))
            .map_err(|error| format!("Discord handshake failed: {error}"))?;

        // Wait for the READY frame (PING is answered transparently).
        loop {
            let (opcode, payload) = connection.read_frame()?;
            match opcode {
                1 => {
                    if payload.get("ev").and_then(Value::as_str) == Some("READY")
                        || payload.get("cmd").and_then(Value::as_str) == Some("DISPATCH")
                    {
                        break;
                    }
                    if let Some(event) = payload.get("ev").and_then(Value::as_str) {
                        if event == "ERROR" {
                            return Err("Discord rejected the Rich Presence handshake.".to_string());
                        }
                    }
                }
                3 => {
                    let _ = connection.send_frame(4, &payload);
                }
                2 => {
                    return Err("Discord closed the IPC connection during login.".to_string());
                }
                _ => {}
            }
        }

        Ok(connection)
    }

    fn send_activity(&mut self, activity: Value) -> Result<(), String> {
        let nonce = uuid::Uuid::new_v4().to_string();
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": nonce
        });
        self.send_frame(1, &payload)
            .map_err(|error| format!("Discord IPC send failed: {error}"))
    }

    fn send_frame(&mut self, opcode: u32, payload: &Value) -> std::io::Result<()> {
        let body = serde_json::to_vec(payload)?;
        let mut header = [0u8; 8];
        header[0..4].copy_from_slice(&opcode.to_le_bytes());
        header[4..8].copy_from_slice(&(body.len() as u32).to_le_bytes());
        self.stream.write_all(&header)?;
        self.stream.write_all(&body)?;
        self.stream.flush()
    }

    fn read_frame(&mut self) -> Result<(u32, Value), String> {
        let mut header = [0u8; 8];
        self.stream
            .read_exact(&mut header)
            .map_err(|error| format!("Discord IPC read failed: {error}"))?;
        let opcode = u32::from_le_bytes(header[0..4].try_into().unwrap_or([0; 4]));
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap_or([0; 4])) as usize;
        if length > MAX_FRAME_BYTES {
            return Err("Discord IPC frame was too large.".to_string());
        }
        let mut body = vec![0u8; length];
        self.stream
            .read_exact(&mut body)
            .map_err(|error| format!("Discord IPC read failed: {error}"))?;
        let payload: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        Ok((opcode, payload))
    }
}

#[cfg(not(unix))]
impl Connection {
    fn connect(_app_id: &str) -> Result<Self, String> {
        Err(
            "Discord Rich Presence is currently implemented for Unix sockets (Linux/macOS)."
                .to_string(),
        )
    }

    fn send_activity(&mut self, _activity: Value) -> Result<(), String> {
        Err("Discord IPC is unavailable on this platform.".to_string())
    }
}

#[cfg(unix)]
fn find_discord_socket() -> Option<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(value) = std::env::var("XDG_RUNTIME_DIR") {
        roots.push(std::path::PathBuf::from(value));
    }
    if let Ok(value) = std::env::var("TMPDIR") {
        roots.push(std::path::PathBuf::from(value));
    }
    roots.push(std::path::PathBuf::from("/tmp"));

    if let Ok(uid) = std::env::var("UID") {
        roots.push(std::path::PathBuf::from(format!("/run/user/{uid}")));
    }

    let mut candidates = Vec::new();
    for root in roots {
        for suffix in [
            "discord-ipc-{i}",
            "app/com.discordapp.Discord/discord-ipc-{i}",
            "app/com.discordapp.DiscordCanary/discord-ipc-{i}",
            "app/dev.vencord.Vesktop/discord-ipc-{i}",
        ] {
            for index in 0..10 {
                candidates.push(root.join(suffix.replace("{i}", &index.to_string())));
            }
        }
    }

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::paths::AppPaths;
    use serde_json::json;

    #[test]
    fn activity_matches_listening_contract() {
        let activity = build_activity(&json!({
            "track": {
                "id": "abc",
                "title": "Song",
                "author": "Artist",
                "source": "youtube",
                "thumbnail": "https://example.com/art.jpg",
                "duration": 200
            },
            "isPlaying": true,
            "progress": 50.0,
            "sessionId": "jam-abc"
        }));

        assert_eq!(activity["type"], 2);
        assert_eq!(activity["details"], "Song");
        assert!(activity["state"].as_str().unwrap().contains("Artist"));
        assert!(
            activity["state"]
                .as_str()
                .unwrap()
                .contains("YouTube Music")
        );
        assert_eq!(
            activity["assets"]["large_image"],
            "https://example.com/art.jpg"
        );
        assert_eq!(activity["buttons"].as_array().unwrap().len(), 2);
        let start = activity["timestamps"]["start"].as_i64().unwrap();
        let end = activity["timestamps"]["end"].as_i64().unwrap();
        assert!(end > start);
    }

    #[test]
    fn paused_activity_omits_timestamps() {
        let activity = build_activity(&json!({
            "track": {
                "id": "abc",
                "title": "Song",
                "author": "Artist",
                "source": "local",
                "thumbnail": ""
            },
            "isPlaying": false,
            "progress": 50.0
        }));
        assert!(activity.get("timestamps").is_none());
        assert!(activity["state"].as_str().unwrap().starts_with("Paused"));
        assert_eq!(activity["assets"]["large_image"], LARGE_IMAGE_FALLBACK);
    }

    #[tokio::test]
    #[ignore = "requires the Discord desktop client on this machine"]
    async fn live_discord_handshake() {
        let root = std::env::temp_dir().join(format!("aurora-discord-{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_root(root.clone()).expect("paths");
        let handle = DiscordHandle::spawn(paths);
        handle.probe(Some(DEFAULT_CLIENT_ID));
        let mut result = None;
        for _ in 0..80 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let status = handle.status();
            if status.ready || status.error.is_some() {
                result = Some(status);
                break;
            }
        }
        let status = result.unwrap_or_else(|| handle.status());
        assert!(status.ready, "Discord IPC error: {:?}", status.error);
        handle.shutdown();
        std::fs::remove_dir_all(root).unwrap();
    }
}
