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
    /// Optional base64 or file path for replacing artwork
    pub new_artwork_base64: Option<String>,
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
