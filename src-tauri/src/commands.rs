use liertags_core::api;
use liertags_core::models::{MusicBrainzRecording, SaveTrackPayload, Track};
use liertags_core::tags;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct PagedTracksResult {
    pub tracks: Vec<Track>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Serialize)]
pub struct DropResult {
    pub mode: String, // "folder" or "files"
    pub folder_path: Option<String>,
    pub tracks: Vec<Track>,
}

#[tauri::command]
pub async fn get_tracks_paged(
    folder_path: Option<String>,
    search: Option<String>,
    offset: usize,
    limit: usize,
) -> Result<PagedTracksResult, String> {
    let cache = liertags_core::cache::LibraryCache::new().map_err(|e| e.to_string())?;
    let (tracks, total) = cache
        .get_tracks_paged(folder_path.as_deref(), search.as_deref(), offset, limit)
        .map_err(|e| e.to_string())?;
    Ok(PagedTracksResult {
        tracks,
        total,
        offset,
        limit,
    })
}

#[tauri::command]
pub async fn scan_folder(folder_path: String, recursive: bool) -> Result<Vec<Track>, String> {
    tags::scan_folder(Path::new(&folder_path), recursive).map_err(|e| e.to_string())
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
    tags::read_track(Path::new(&file_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_track_artwork(file_path: String) -> Result<Option<String>, String> {
    tags::read_track_artwork(Path::new(&file_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_tags(payload: SaveTrackPayload) -> Result<Track, String> {
    tags::save_track(&payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_musicbrainz(query: String) -> Result<Vec<MusicBrainzRecording>, String> {
    api::search_musicbrainz(&query, 10).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_cover_image(url: String) -> Result<String, String> {
    api::fetch_artwork_as_data_uri(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_server_status() -> serde_json::Value {
    serde_json::json!({
        "status": "online",
        "port": liertags_core::server::DEFAULT_SERVER_PORT,
        "extension_target": "LierEX-Q"
    })
}

#[tauri::command]
pub async fn find_lyrics(
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u64>,
) -> Result<Option<liertags_core::models::LrcLibLyrics>, String> {
    liertags_core::lyrics::find_lyrics(&title, artist.as_deref(), album.as_deref(), duration)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_lyrics(
    file_path: String,
    lyrics: String,
    save_lrc_file: bool,
) -> Result<(), String> {
    liertags_core::lyrics::save_lyrics_to_file(Path::new(&file_path), &lyrics, save_lrc_file)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_organize(
    folder_path: Option<String>,
    target_folder: Option<String>,
    template: String,
    tracks: Option<Vec<Track>>,
) -> Result<Vec<liertags_core::models::OrganizePreviewItem>, String> {
    let track_list = if let Some(trks) = tracks {
        if !trks.is_empty() {
            trks
        } else if let Some(ref fp) = folder_path {
            tags::scan_folder(Path::new(fp), true).map_err(|e| e.to_string())?
        } else {
            Vec::new()
        }
    } else if let Some(ref fp) = folder_path {
        tags::scan_folder(Path::new(fp), true).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };

    let base_folder_str = target_folder
        .or(folder_path)
        .ok_or_else(|| "Целевая папка не указана".to_string())?;

    let base_path = Path::new(&base_folder_str);
    Ok(liertags_core::organizer::preview_organization(
        &track_list,
        base_path,
        &template,
    ))
}

#[tauri::command]
pub async fn organize_files(
    actions: Vec<liertags_core::models::OrganizeAction>,
) -> Result<liertags_core::models::OrganizeSummary, String> {
    liertags_core::organizer::organize_files(&actions).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_duplicates(
    folder_path: Option<String>,
    mode: liertags_core::models::DuplicateMode,
    tracks: Option<Vec<Track>>,
) -> Result<Vec<liertags_core::models::DuplicateGroup>, String> {
    let track_list = if let Some(trks) = tracks {
        if !trks.is_empty() {
            trks
        } else if let Some(ref fp) = folder_path {
            tags::scan_folder(Path::new(fp), true).map_err(|e| e.to_string())?
        } else {
            Vec::new()
        }
    } else if let Some(ref fp) = folder_path {
        tags::scan_folder(Path::new(fp), true).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };

    Ok(liertags_core::duplicates::find_duplicates(
        &track_list,
        mode,
    ))
}

#[tauri::command]
pub async fn delete_duplicate_files(
    file_paths: Vec<String>,
) -> Result<liertags_core::models::DeleteSummary, String> {
    liertags_core::duplicates::delete_duplicate_files(&file_paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn probe_lier_ecosystem() -> Vec<liertags_core::ecosystem::EcosystemAppStatus> {
    tokio::task::spawn_blocking(liertags_core::ecosystem::probe_ecosystem)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn send_paths_to_liersync(
    paths: Vec<String>,
    target: Option<String>,
) -> Result<liertags_core::ecosystem::LierSyncSendResult, String> {
    tokio::task::spawn_blocking(move || {
        liertags_core::ecosystem::send_paths_to_liersync(&paths, target.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_lierkour_ost(
    query: String,
) -> Result<Vec<liertags_core::ecosystem::LierkourOstCandidate>, String> {
    tokio::task::spawn_blocking(move || liertags_core::ecosystem::search_lierkour_ost(&query))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
