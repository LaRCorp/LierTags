use serde::{Deserialize, Serialize};

/// Audio metadata parsed from or written to an audio file
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    pub is_synced_lyrics: bool,
    pub has_artwork: bool,
    pub artwork_mime: Option<String>,
    /// Base64 encoded data URI or raw base64 of embedded artwork for UI display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_base64: Option<String>,
}

/// Technical audio file properties (duration, bitrate, etc.)
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AudioProperties {
    pub duration_seconds: u64,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u8>,
}

/// Complete track record used across Core, Tauri commands, and Frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub extension: String,
    pub metadata: TrackMetadata,
    pub properties: AudioProperties,
    #[serde(default)]
    pub dirty: bool,
}

/// Incoming payload from LierEX-Q browser extension (port 8766)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPayload {
    #[serde(rename = "type")]
    pub item_type: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub artwork_url: Option<String>,
    pub source_url: Option<String>,
    pub track_number: Option<u32>,
    pub comment: Option<String>,
}

/// Payload sent from UI to update track tags
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveTrackPayload {
    pub file_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    #[serde(default)]
    pub save_lrc_file: bool,
    /// Optional base64 or file path for replacing artwork
    pub new_artwork_base64: Option<String>,
    #[serde(default)]
    pub remove_artwork: bool,
}

/// MusicBrainz recording search match
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzRecording {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub release_id: Option<String>,
    pub year: Option<u32>,
}

/// LRCLIB response model
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LrcLibLyrics {
    pub id: Option<i64>,
    #[serde(rename = "trackName")]
    pub track_name: Option<String>,
    #[serde(rename = "artistName")]
    pub artist_name: Option<String>,
    #[serde(rename = "albumName")]
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: Option<bool>,
    #[serde(rename = "plainLyrics")]
    pub plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
}

/// File Organizer Models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizePreviewItem {
    pub original_path: String,
    pub file_name: String,
    pub destination_path: String,
    pub relative_destination: String,
    pub status: String, // "ready", "identical", "missing_tags", "target_exists"
    pub will_move: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizeAction {
    pub original_path: String,
    pub destination_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OrganizeSummary {
    pub moved_count: usize,
    pub skipped_count: usize,
    pub error_count: usize,
    pub logs: Vec<String>,
}

/// Duplicate Finder Models
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateMode {
    Metadata,
    Hash,
    SizeDuration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateFileItem {
    pub track_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub bitrate_kbps: Option<u32>,
    pub extension: String,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub group_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub match_reason: String,
    pub files: Vec<DuplicateFileItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeleteSummary {
    pub deleted_count: usize,
    pub failed_count: usize,
    pub logs: Vec<String>,
}

/// Drag and drop result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropResult {
    pub mode: String,
    pub folder_path: Option<String>,
    pub tracks: Vec<Track>,
}
