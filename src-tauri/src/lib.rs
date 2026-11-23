mod commands;

use commands::*;
use liertags_core::models::ImportPayload;
use liertags_core::server::{start_import_server, DEFAULT_SERVER_PORT};
use tauri::Emitter;
use tokio::sync::broadcast;

#[cfg(target_os = "windows")]
fn trim_process_memory() {
    unsafe {
        #[link(name = "psapi")]
        unsafe extern "system" {
            fn EmptyWorkingSet(hProcess: isize) -> i32;
            fn GetCurrentProcess() -> isize;
        }
        EmptyWorkingSet(GetCurrentProcess());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                #[cfg(target_os = "windows")]
                trim_process_memory();
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Channel for HTTP import server
            let (tx, mut rx) = broadcast::channel::<ImportPayload>(32);

            // Spawn local Axum HTTP server on port 8766
            tauri::async_runtime::spawn(async move {
                if let Err(err) = start_import_server(DEFAULT_SERVER_PORT, tx).await {
                    eprintln!("Failed to run LierTags import server: {}", err);
                }
            });

            // Bridge HTTP server broadcast into Tauri UI events
            tauri::async_runtime::spawn(async move {
                while let Ok(payload) = rx.recv().await {
                    println!("Forwarding imported track to UI: {}", payload.title);
                    if let Err(err) = app_handle.emit("track_imported", payload) {
                        eprintln!("Failed to emit Tauri event: {}", err);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tracks_paged,
            scan_folder,
            open_files,
            handle_dropped_paths,
            read_track,
            read_track_artwork,
            save_tags,
            search_musicbrainz,
            fetch_cover_image,
            get_server_status,
            find_lyrics,
            save_lyrics,
            preview_organize,
            organize_files,
            find_duplicates,
            delete_duplicate_files
        ])
        .run(tauri::generate_context!())
        .expect("Error while running LierTags application");
}
