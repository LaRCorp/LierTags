use std::fs;
use std::path::{Path, PathBuf};
use anyhow::{anyhow, Context, Result};
use base64::Engine;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::items::Timestamp;
use lofty::tag::Tag;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::cache::{get_file_mtime_secs, LibraryCache};
use crate::models::{AudioProperties, SaveTrackPayload, Track, TrackMetadata};

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "opus", "m4a", "mp4", "wav", "aiff"];

/// Check if a file extension is supported by LierTags
pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

/// Read audio metadata without loading base64 artwork (optimized for fast bulk scanning of thousands of tracks)
pub fn read_track_summary(path: &Path) -> Result<Track> {
    if !path.exists() {
        return Err(anyhow!("File does not exist: {}", path.display()));
    }

    let file_meta = fs::metadata(path)
        .with_context(|| format!("Failed to read file metadata for: {}", path.display()))?;

    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();

    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let tagged_file = Probe::open(path)
        .with_context(|| format!("Failed to open audio file: {}", path.display()))?
        .read()
        .with_context(|| format!("Failed to parse audio tags: {}", path.display()))?;

    let props = tagged_file.properties();
    let audio_properties = AudioProperties {
        duration_seconds: props.duration().as_secs(),
        bitrate_kbps: props.audio_bitrate(),
        sample_rate_hz: props.sample_rate(),
        channels: props.channels(),
    };

    let primary_or_first = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let metadata = if let Some(tag) = primary_or_first {
        let picture = tag
            .pictures()
            .iter()
            .find(|p| p.pic_type() == PictureType::CoverFront)
            .or_else(|| tag.pictures().first());

        let has_artwork = picture.is_some();
        let artwork_mime = picture.and_then(|p| p.mime_type()).map(|m| m.as_str().to_string());

        TrackMetadata {
            title: tag.title().map(|s| s.to_string()),
            artist: tag.artist().map(|s| s.to_string()),
            album: tag.album().map(|s| s.to_string()),
            year: tag.date().map(|d| d.year as u32),
            genre: tag.genre().map(|s| s.to_string()),
            track_number: tag.track(),
            track_total: tag.track_total(),
            comment: tag.comment().map(|s| s.to_string()),
            has_artwork,
            artwork_mime,
            artwork_base64: None, // intentionally omitted during library scan for speed
        }
    } else {
        TrackMetadata::default()
    };

    let id = format!("{:x}", md5_hash(path.to_string_lossy().as_bytes()));

    Ok(Track {
        id,
        file_path: path.to_string_lossy().to_string(),
        file_name,
        file_size_bytes: file_meta.len(),
        extension,
        metadata,
        properties: audio_properties,
    })
}

/// Read full audio metadata including base64 artwork (used for the currently selected track)
pub fn read_track(path: &Path) -> Result<Track> {
    let mut track = read_track_summary(path)?;
    if track.metadata.has_artwork {
        track.metadata.artwork_base64 = read_track_artwork(path)?;
    }
    Ok(track)
}

/// Extract front cover or first artwork from a file as base64 data URI
pub fn read_track_artwork(path: &Path) -> Result<Option<String>> {
    let tagged_file = Probe::open(path)?.read()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    if let Some(tag) = tag {
        let picture = tag
            .pictures()
            .iter()
            .find(|p| p.pic_type() == PictureType::CoverFront)
            .or_else(|| tag.pictures().first());

        if let Some(pic) = picture {
            let mime = pic
                .mime_type()
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());

            let b64 = base64::engine::general_purpose::STANDARD.encode(pic.data());
            return Ok(Some(format!("data:{};base64,{}", mime, b64)));
        }
    }
    Ok(None)
}

/// Scan a folder for audio files with SQLite cache & Rayon parallelism
pub fn scan_folder(folder_path: &Path, recursive: bool) -> Result<Vec<Track>> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(anyhow!("Directory not found: {}", folder_path.display()));
    }

    let cache = LibraryCache::new().ok();
    let folder_str = folder_path.to_string_lossy().to_string();
    let cached_map = cache
        .as_ref()
        .map(|c| c.get_cached_for_folder(&folder_str))
        .unwrap_or_default();

    // 1. Collect all candidate file paths
    let walker = WalkDir::new(folder_path).max_depth(if recursive { 20 } else { 1 });
    let mut file_entries = Vec::new();

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && is_supported_audio_file(path) {
            if let Ok(meta) = fs::metadata(path) {
                file_entries.push((path.to_path_buf(), meta.len(), get_file_mtime_secs(&meta)));
            }
        }
    }

    // 2. Separate into cached vs uncached
    let mut tracks = Vec::with_capacity(file_entries.len());
    let mut uncached_entries = Vec::new();

    for (path, size, mtime) in file_entries {
        let path_str = path.to_string_lossy();
        if let Some(cached) = cached_map.get(path_str.as_ref()) {
            if cached.file_size == size && cached.mtime == mtime {
                tracks.push(cached.track.clone());
                continue;
            }
        }
        uncached_entries.push((path, mtime));
    }

    // 3. Parse uncached files in parallel using Rayon
    if !uncached_entries.is_empty() {
        let freshly_parsed: Vec<(Track, u64)> = uncached_entries
            .par_iter()
            .filter_map(|(path, mtime)| {
                match read_track_summary(path) {
                    Ok(t) => Some((t, *mtime)),
                    Err(err) => {
                        eprintln!("Warning: skipping unreadable audio file {}: {}", path.display(), err);
                        None
                    }
                }
            })
            .collect();

        // 4. Batch update SQLite cache
        if let Some(ref c) = cache {
            let ref_slice: Vec<(&Track, u64)> = freshly_parsed.iter().map(|(t, m)| (t, *m)).collect();
            let _ = c.save_batch(&ref_slice);
        }

        for (t, _) in freshly_parsed {
            tracks.push(t);
        }
    }

    tracks.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(tracks)
}

/// Read a specific list of file paths (from drag & drop or file dialog)
pub fn read_files(file_paths: &[PathBuf]) -> Result<Vec<Track>> {
    let cache = LibraryCache::new().ok();

    let mut tracks = Vec::new();
    let mut uncached = Vec::new();

    for path in file_paths {
        if path.is_file() && is_supported_audio_file(path) {
            if let Ok(meta) = fs::metadata(path) {
                let size = meta.len();
                let mtime = get_file_mtime_secs(&meta);
                let path_str = path.to_string_lossy();

                if let Some(ref c) = cache {
                    if let Some(cached) = c.get_single(&path_str, size, mtime) {
                        tracks.push(cached);
                        continue;
                    }
                }
                uncached.push((path.clone(), mtime));
            }
        }
    }

    if !uncached.is_empty() {
        let freshly_parsed: Vec<(Track, u64)> = uncached
            .par_iter()
            .filter_map(|(path, mtime)| {
                read_track_summary(path).ok().map(|t| (t, *mtime))
            })
            .collect();

        if let Some(ref c) = cache {
            let ref_slice: Vec<(&Track, u64)> = freshly_parsed.iter().map(|(t, m)| (t, *m)).collect();
            let _ = c.save_batch(&ref_slice);
        }

        for (t, _) in freshly_parsed {
            tracks.push(t);
        }
    }

    tracks.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(tracks)
}

/// Save modified tags and artwork back to an audio file and update cache
pub fn save_track(payload: &SaveTrackPayload) -> Result<Track> {
    let path = Path::new(&payload.file_path);
    if !path.exists() {
        return Err(anyhow!("File not found: {}", path.display()));
    }

    let mut tagged_file = Probe::open(path)
        .with_context(|| format!("Failed to open file: {}", path.display()))?
        .read()
        .with_context(|| format!("Failed to read audio file: {}", path.display()))?;

    let tag_type = tagged_file.primary_tag_type();
    let tag = match tagged_file.tag_mut(tag_type) {
        Some(t) => t,
        None => {
            let new_tag = Tag::new(tag_type);
            tagged_file.insert_tag(new_tag);
            tagged_file.tag_mut(tag_type).ok_or_else(|| anyhow!("Failed to create tag"))?
        }
    };

    // Update text metadata fields
    if let Some(ref title) = payload.title {
        tag.set_title(title.clone());
    } else {
        tag.remove_title();
    }

    if let Some(ref artist) = payload.artist {
        tag.set_artist(artist.clone());
    } else {
        tag.remove_artist();
    }

    if let Some(ref album) = payload.album {
        tag.set_album(album.clone());
    } else {
        tag.remove_album();
    }

    if let Some(year) = payload.year {
        tag.set_date(Timestamp {
            year: year as u16,
            ..Default::default()
        });
    } else {
        tag.remove_date();
    }

    if let Some(ref genre) = payload.genre {
        tag.set_genre(genre.clone());
    } else {
        tag.remove_genre();
    }

    if let Some(num) = payload.track_number {
        tag.set_track(num);
    } else {
        tag.remove_track();
    }

    if let Some(total) = payload.track_total {
        tag.set_track_total(total);
    } else {
        tag.remove_track_total();
    }

    if let Some(ref comment) = payload.comment {
        tag.set_comment(comment.clone());
    } else {
        tag.remove_comment();
    }

    // Artwork management
    if payload.remove_artwork {
        tag.remove_picture_type(PictureType::CoverFront);
    }

    if let Some(ref artwork_b64) = payload.new_artwork_base64 {
        let (raw_bytes, detected_mime) = parse_base64_artwork(artwork_b64)?;
        let mime_type = match detected_mime.as_deref() {
            Some("image/png") => MimeType::Png,
            Some("image/jpeg") | Some("image/jpg") => MimeType::Jpeg,
            _ => MimeType::Jpeg,
        };

        let picture = Picture::unchecked(raw_bytes)
            .pic_type(PictureType::CoverFront)
            .mime_type(mime_type)
            .build();

        tag.set_picture(0, picture);
    }

    // Save tag to file
    tag.save_to_path(path, WriteOptions::default())
        .with_context(|| format!("Failed to save tag to: {}", path.display()))?;

    // Re-read updated track
    let updated = read_track(path)?;

    // Update SQLite cache
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(cache) = LibraryCache::new() {
            let _ = cache.update_single(&updated, get_file_mtime_secs(&meta));
        }
    }

    Ok(updated)
}

/// Helper to parse base64 string (supports data URI schemes)
fn parse_base64_artwork(input: &str) -> Result<(Vec<u8>, Option<String>)> {
    let (data_part, mime) = if let Some(stripped) = input.strip_prefix("data:") {
        if let Some((header, rest)) = stripped.split_once(";base64,") {
            (rest, Some(header.to_string()))
        } else {
            (input, None)
        }
    } else {
        (input, None)
    };

    let cleaned: String = data_part.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&cleaned)
        .context("Invalid base64 artwork payload")?;

    Ok((bytes, mime))
}

/// Simple fast hashing for track ID
pub fn md5_hash(bytes: &[u8]) -> u128 {
    let mut hash: u128 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u128;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
