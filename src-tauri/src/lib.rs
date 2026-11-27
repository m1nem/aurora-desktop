pub mod audio_engine;
mod auth;
mod commands;
mod database;
mod desktop;
mod discord;
mod error;
mod jam;
mod marketplace;
mod media;
mod migrations;
mod models;
mod networking;
mod plugins;
mod services;
mod state;
mod storage;

use tauri::Manager;

use crate::storage::paths::AppPaths;

// AURORA_FIX_TAURI_LIB_V1
pub fn run() {
    let startup_started = std::time::Instant::now();

    // On Linux Wayland compositors (including COSMIC), WebKitGTK's DMA-BUF
    // renderer can stall window readiness for ~10-15 seconds on first paint.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
    {
        // Executed on the main thread before Tauri/GTK spawns worker threads.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    let paths = match AppPaths::new() {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("Aurora could not initialise its data directory: {error}");
            std::process::exit(1);
        }
    };

    // The default log target is `$XDG_DATA_HOME/<bundle-id>/logs`, which does
    // not follow AURORA_APP_DATA_DIR and breaks read-only/portable setups.
    // Keep logs next to the database instead.
    let log_plugin = tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                path: paths.logs_dir.clone(),
                file_name: Some("aurora.log".to_string()),
            }),
        ])
        .build();
    let media_dir = paths.media_dir.clone();

    tauri::Builder::default()
        .manage(audio_engine::AudioEngineState::new())
        .plugin(log_plugin)
        .setup(move |app| {
            log::info!("Aurora data directory: {}", paths.data_dir.display());

            // The media root is outside the bundle, so the asset protocol scope
            // is extended at runtime as well as in tauri.conf.json. This keeps
            // local playback working when XDG_DATA_HOME is customised.
            app.asset_protocol_scope()
                .allow_directory(&media_dir, true)
                .map_err(|error| {
                    Box::<dyn std::error::Error>::from(format!(
                        "could not allow the media directory: {error}"
                    ))
                })?;

            app.manage(state::AppState::new(paths));
            log::info!(
                "Aurora state initialized in {:?}",
                startup_started.elapsed()
            );

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Defer legacy migration check so initial SQLite session/library
                // queries run uncontended during startup.
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let state = handle.state::<state::AppState>();
                if let Some(stats) = migrations::legacy::auto_import(&state).await {
                    log::info!("legacy data import finished: {stats}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::register,
            commands::auth::current_user,
            commands::auth::logout,
            commands::auth::totp_setup,
            commands::auth::totp_enable,
            commands::auth::verify_two_factor,
            commands::auth::send_two_factor_email,
            commands::auth::set_email_two_factor,
            commands::auth::disable_two_factor,
            commands::auth::send_disable_two_factor_email,
            commands::library::get_library,
            commands::library::save_library,
            commands::library::recover_library,
            commands::library::import_playlist_csv,
            commands::library::export_playlist_csv,
            commands::media::search_youtube,
            commands::media::search_youtube_external,
            commands::media::download_track,
            commands::media::upload_local_file,
            commands::media::fetch_lyrics,
            commands::media::resolve_media_url,
            commands::plugins::get_plugin_state,
            commands::plugins::save_plugin_state,
            commands::plugins::save_preferences,
            commands::plugins::list_community_plugins,
            commands::plugins::upload_community_plugin,
            commands::plugins::delete_community_plugin,
            commands::plugins::read_community_plugin,
            commands::misc::jam_publish,
            commands::misc::jam_join,
            commands::misc::jam_poll,
            commands::misc::jam_leave,
            commands::misc::send_discord_presence,
            commands::misc::clear_discord_presence,
            commands::misc::discord_probe,
            commands::misc::discord_status,
            commands::misc::ytdlp_status,
            commands::misc::audio_integration_status,
            commands::misc::set_default_music_player,
            commands::misc::restore_default_music_player,
            commands::misc::take_startup_audio,
            commands::misc::open_external_url,
            commands::misc::generate_qr_code,
            commands::misc::send_email,
            audio_engine::audio_play,
            audio_engine::audio_pause,
            audio_engine::audio_resume,
            audio_engine::audio_stop,
            audio_engine::audio_seek,
            audio_engine::audio_set_volume,
            audio_engine::audio_get_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Aurora")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<state::AppState>();
                state.discord.shutdown();
            }
        });
}
