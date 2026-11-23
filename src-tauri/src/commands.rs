use std::path::{Path, PathBuf};
use liertags_core::models::{MusicBrainzRecording, SaveTrackPayload, Track};
use liertags_core::tags;
use liertags_core::api;
use serde::Serialize;

#[derive(Serialize)]
pub struct DropResult {
    pub mode: String, // "folder" or "files"
    pub folder_path: Option<String>,
    pub tracks: Vec<Track>,
}

#[tauri::command]
pub async fn scan_folder(folder_path: String, recursive: bool) -> Result<Vec<Track>, String> {
    tags::scan_folder(Path::new(&folder_path), recursive)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_files(file_paths: Vec<String>) -> Result<Vec<Track>, String> {
    let paths: Vec<PathBuf> = file_paths.into_iter().map(PathBuf::from).collect();
    tags::read_files(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn handle_dropped_paths(paths: Vec<String>) -> Result<DropResult, String> {
    if paths.is_empty() {
        return Ok(DropResult {
            mode: "empty".to_string(),
            folder_path: None,
            tracks: Vec::new(),
        });
    }

    // If first item is a directory, treat as folder scan
    let first_path = Path::new(&paths[0]);
    if first_path.is_dir() {
        let folder_str = paths[0].clone();
        let tracks = tags::scan_folder(first_path, true).map_err(|e| e.to_string())?;
        return Ok(DropResult {
            mode: "folder".to_string(),
            folder_path: Some(folder_str),
            tracks,
        });
    }

    // Otherwise, treat as dropped audio files
    let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let parent_folder = path_bufs
        .first()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string());

    let tracks = tags::read_files(&path_bufs).map_err(|e| e.to_string())?;
    Ok(DropResult {
        mode: "files".to_string(),
        folder_path: parent_folder,
        tracks,
    })
}

#[tauri::command]
pub async fn read_track(file_path: String) -> Result<Track, String> {
    tags::read_track(Path::new(&file_path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_track_artwork(file_path: String) -> Result<Option<String>, String> {
    tags::read_track_artwork(Path::new(&file_path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_tags(payload: SaveTrackPayload) -> Result<Track, String> {
    tags::save_track(&payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_musicbrainz(query: String) -> Result<Vec<MusicBrainzRecording>, String> {
    api::search_musicbrainz(&query, 10)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_cover_image(url: String) -> Result<String, String> {
    api::fetch_artwork_as_data_uri(&url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_server_status() -> serde_json::Value {
    serde_json::json!({
        "status": "online",
        "port": liertags_core::server::DEFAULT_SERVER_PORT,
        "extension_target": "LierEX-Q"
    })
}
