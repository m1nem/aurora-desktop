use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::sync::mpsc::{self, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct AudioPlaybackState {
    pub is_playing: bool,
    pub position: f64,
    pub duration: f64,
    pub ended: bool,
    pub path: Option<String>,
}

struct SharedStatus {
    is_playing: bool,
    duration: f64,
    ended: bool,
    path: Option<String>,
    generation: u64,
}

enum AudioCommand {
    Play {
        path: String,
        volume: f32,
        duration_hint: Option<f64>,
        reply: SyncSender<Result<f64, String>>,
    },
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    GetPosition(SyncSender<f64>),
}

pub struct AudioEngineState {
    tx: Sender<AudioCommand>,
    shared: Arc<Mutex<SharedStatus>>,
}

fn normalize_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let Some(stripped) = s.strip_prefix("asset://localhost/") {
        s = format!("/{}", stripped.trim_start_matches('/'));
    } else if let Some(stripped) = s.strip_prefix("http://asset.localhost/") {
        s = format!("/{}", stripped.trim_start_matches('/'));
    } else if let Some(stripped) = s.strip_prefix("file://") {
        s = stripped.to_string();
    }
    percent_decode(&s)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

impl AudioEngineState {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<AudioCommand>();
        let shared = Arc::new(Mutex::new(SharedStatus {
            is_playing: false,
            duration: 0.0,
            ended: false,
            path: None,
            generation: 0,
        }));
        let shared_thread = Arc::clone(&shared);

        thread::spawn(move || {
            let mut stream_pair: Option<(OutputStream, OutputStreamHandle)> = None;
            let mut current_sink: Option<Sink> = None;
            let mut active_gen: u64 = 0;
            let mut last_known_pos: f64 = 0.0;

            loop {
                match rx.recv_timeout(Duration::from_millis(80)) {
                    Ok(cmd) => match cmd {
                        AudioCommand::Play {
                            path,
                            volume,
                            duration_hint,
                            reply,
                        } => {
                            // Natychmiast zatrzymaj poprzedni utwór
                            if let Some(old_sink) = current_sink.take() {
                                old_sink.stop();
                            }
                            last_known_pos = 0.0;

                            // Leniwa inicjalizacja lub odtworzenie strumienia audio (odporne na restart PipeWire)
                            if stream_pair.is_none() {
                                match OutputStream::try_default() {
                                    Ok(pair) => stream_pair = Some(pair),
                                    Err(e) => {
                                        let _ = reply.send(Err(format!(
                                            "Nie można otworzyć urządzenia audio: {}",
                                            e
                                        )));
                                        continue;
                                    }
                                }
                            }

                            let clean_path = normalize_path(&path);
                            let file = match File::open(&clean_path) {
                                Ok(f) => f,
                                Err(e) => {
                                    let _ = reply.send(Err(format!(
                                        "Nie można otworzyć pliku '{}': {}",
                                        clean_path, e
                                    )));
                                    continue;
                                }
                            };

                            let decoder = match Decoder::new(BufReader::new(file)) {
                                Ok(d) => d,
                                Err(e) => {
                                    let _ = reply.send(Err(format!(
                                        "Błąd dekodowania pliku '{}': {}",
                                        clean_path, e
                                    )));
                                    continue;
                                }
                            };

                            let detected_dur = decoder
                                .total_duration()
                                .map(|d| d.as_secs_f64())
                                .filter(|&d| d > 0.0)
                                .or(duration_hint)
                                .unwrap_or(0.0);

                            let handle = &stream_pair.as_ref().unwrap().1;
                            let sink = match Sink::try_new(handle) {
                                Ok(s) => s,
                                Err(_) => {
                                    // Ponów inicjalizację urządzenia wyjściowego w razie zmiany wyjścia audio
                                    stream_pair = OutputStream::try_default().ok();
                                    let Some((_, ref h)) = stream_pair else {
                                        let _ = reply.send(Err(
                                            "Urządzenie wyjściowe audio jest niedostępne".into(),
                                        ));
                                        continue;
                                    };
                                    match Sink::try_new(h) {
                                        Ok(s) => s,
                                        Err(e) => {
                                            let _ = reply
                                                .send(Err(format!("Błąd tworzenia Sink: {}", e)));
                                            continue;
                                        }
                                    }
                                }
                            };

                            sink.set_volume(volume.clamp(0.0, 1.5));
                            sink.append(decoder);
                            sink.play();

                            {
                                let mut st = shared_thread.lock().unwrap();
                                st.generation += 1;
                                active_gen = st.generation;
                                st.is_playing = true;
                                st.duration = detected_dur;
                                st.ended = false;
                                st.path = Some(clean_path);
                            }

                            current_sink = Some(sink);
                            let _ = reply.send(Ok(detected_dur));
                        }
                        AudioCommand::Pause => {
                            if let Some(ref sink) = current_sink {
                                sink.pause();
                                last_known_pos = sink.get_pos().as_secs_f64();
                            }
                            let mut st = shared_thread.lock().unwrap();
                            st.is_playing = false;
                        }
                        AudioCommand::Resume => {
                            if let Some(ref sink) = current_sink {
                                sink.play();
                            }
                            let mut st = shared_thread.lock().unwrap();
                            if !st.ended {
                                st.is_playing = true;
                            }
                        }
                        AudioCommand::Stop => {
                            if let Some(old_sink) = current_sink.take() {
                                old_sink.stop();
                            }
                            last_known_pos = 0.0;
                            let mut st = shared_thread.lock().unwrap();
                            st.is_playing = false;
                            st.ended = false;
                        }
                        AudioCommand::Seek(pos_secs) => {
                            if let Some(ref sink) = current_sink {
                                let target = Duration::from_secs_f64(pos_secs.max(0.0));
                                if sink.try_seek(target).is_ok() {
                                    last_known_pos = pos_secs.max(0.0);
                                }
                            }
                        }
                        AudioCommand::SetVolume(vol) => {
                            if let Some(ref sink) = current_sink {
                                sink.set_volume(vol.clamp(0.0, 1.5));
                            }
                        }
                        AudioCommand::GetPosition(reply) => {
                            let pos = if let Some(ref sink) = current_sink {
                                let p = sink.get_pos().as_secs_f64();
                                last_known_pos = p;
                                p
                            } else {
                                last_known_pos
                            };
                            let _ = reply.send(pos);
                        }
                    },
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if let Some(ref sink) = current_sink {
                            if sink.empty() {
                                let mut st = shared_thread.lock().unwrap();
                                if st.generation == active_gen && st.is_playing && !st.ended {
                                    st.is_playing = false;
                                    st.ended = true;
                                }
                            } else {
                                last_known_pos = sink.get_pos().as_secs_f64();
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Self { tx, shared }
    }
}

#[tauri::command]
pub fn audio_play(
    state: State<'_, AudioEngineState>,
    path: String,
    volume: Option<f32>,
    duration_hint: Option<f64>,
) -> Result<f64, String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    state
        .tx
        .send(AudioCommand::Play {
            path,
            volume: volume.unwrap_or(1.0),
            duration_hint,
            reply: reply_tx,
        })
        .map_err(|_| "Wątek audio został zamknięty".to_string())?;

    reply_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Timeout inicjalizacji odtwarzania audio".to_string())?
}

#[tauri::command]
pub fn audio_pause(state: State<'_, AudioEngineState>) -> Result<(), String> {
    state
        .tx
        .send(AudioCommand::Pause)
        .map_err(|_| "Błąd wysyłania komendy Pause".to_string())
}

#[tauri::command]
pub fn audio_resume(state: State<'_, AudioEngineState>) -> Result<(), String> {
    state
        .tx
        .send(AudioCommand::Resume)
        .map_err(|_| "Błąd wysyłania komendy Resume".to_string())
}

#[tauri::command]
pub fn audio_stop(state: State<'_, AudioEngineState>) -> Result<(), String> {
    state
        .tx
        .send(AudioCommand::Stop)
        .map_err(|_| "Błąd wysyłania komendy Stop".to_string())
}

#[tauri::command]
pub fn audio_seek(state: State<'_, AudioEngineState>, position_secs: f64) -> Result<(), String> {
    state
        .tx
        .send(AudioCommand::Seek(position_secs))
        .map_err(|_| "Błąd wysyłania komendy Seek".to_string())
}

#[tauri::command]
pub fn audio_set_volume(state: State<'_, AudioEngineState>, volume: f32) -> Result<(), String> {
    state
        .tx
        .send(AudioCommand::SetVolume(volume))
        .map_err(|_| "Błąd wysyłania komendy SetVolume".to_string())
}

#[tauri::command]
pub fn audio_get_state(state: State<'_, AudioEngineState>) -> Result<AudioPlaybackState, String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    state
        .tx
        .send(AudioCommand::GetPosition(reply_tx))
        .map_err(|_| "Błąd pobierania pozycji audio".to_string())?;

    let position = reply_rx
        .recv_timeout(Duration::from_millis(500))
        .unwrap_or(0.0);

    let st = state.shared.lock().unwrap();
    let final_pos = if st.ended && st.duration > 0.0 {
        st.duration
    } else {
        position
    };

    Ok(AudioPlaybackState {
        is_playing: st.is_playing,
        position: final_pos,
        duration: st.duration,
        ended: st.ended,
        path: st.path.clone(),
    })
}
