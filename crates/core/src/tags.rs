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
use lofty::tag::{ItemKey, Tag, TagType};
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

    let (lyrics, is_synced_lyrics) = crate::lyrics::read_lyrics_from_tagged_file(&tagged_file, path);

    let metadata = if let Some(tag) = primary_or_first {
        let picture = tag
            .pictures()
            .iter()
            .find(|p| p.pic_type() == PictureType::CoverFront)
            .or_else(|| tag.pictures().first());

        let has_artwork = picture.is_some();
        let artwork_mime = picture.and_then(|p| p.mime_type()).map(|m| m.as_str().to_string());

        let clean_str = |opt: Option<std::borrow::Cow<'_, str>>| {
            opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        };

        TrackMetadata {
            title: clean_str(tag.title()),
            artist: clean_str(tag.artist()),
            album: clean_str(tag.album()),
            year: tag.date().map(|d| d.year as u32).filter(|&y| y > 0),
            genre: clean_str(tag.genre()),
            track_number: tag.track().filter(|&n| n > 0),
            track_total: tag.track_total().filter(|&t| t > 0),
            comment: clean_str(tag.comment()),
            lyrics,
            is_synced_lyrics,
            has_artwork,
            artwork_mime,
            artwork_base64: None, // intentionally omitted during library scan for speed
        }
    } else {
        TrackMetadata {
            lyrics,
            is_synced_lyrics,
            ..Default::default()
        }
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
        dirty: false,
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

    let clean_title = payload.title.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let clean_artist = payload.artist.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let clean_album = payload.album.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let clean_genre = payload.genre.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let clean_comment = payload.comment.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let new_picture = if let Some(ref artwork_b64) = payload.new_artwork_base64 {
        let (raw_bytes, detected_mime) = parse_base64_artwork(artwork_b64)?;
        let mime_type = match detected_mime.as_deref() {
            Some("image/png") => MimeType::Png,
            Some("image/jpeg") | Some("image/jpg") => MimeType::Jpeg,
            _ => MimeType::Jpeg,
        };
        Some(
            Picture::unchecked(raw_bytes)
                .pic_type(PictureType::CoverFront)
                .mime_type(mime_type)
                .build(),
        )
    } else {
        None
    };

    let primary_type = tagged_file.primary_tag_type();
    if tagged_file.tag(primary_type).is_none() {
        tagged_file.insert_tag(Tag::new(primary_type));
    }

    // Synchronize tag modifications across ALL tags present in the audio file
    // (e.g. ID3v1 + ID3v2 in MP3s, RIFF + ID3v2 in WAVs) so stale secondary tags don't retain deleted fields.
    let tag_types: Vec<TagType> = tagged_file.tags().iter().map(|t| t.tag_type()).collect();
    for tt in tag_types {
        if let Some(tag) = tagged_file.tag_mut(tt) {
            // Title
            if let Some(title) = clean_title {
                tag.set_title(title.to_string());
            } else {
                tag.remove_title();
                tag.remove_key(ItemKey::TrackTitle);
            }

            // Artist
            if let Some(artist) = clean_artist {
                tag.set_artist(artist.to_string());
            } else {
                tag.remove_artist();
                tag.remove_key(ItemKey::TrackArtist);
            }

            // Album
            if let Some(album) = clean_album {
                tag.set_album(album.to_string());
            } else {
                tag.remove_album();
                tag.remove_key(ItemKey::AlbumTitle);
                tag.remove_key(ItemKey::OriginalAlbumTitle);
                tag.remove_key(ItemKey::AlbumTitleSortOrder);
            }

            // Year / Date
            if let Some(year) = payload.year.filter(|&y| y > 0) {
                tag.set_date(Timestamp {
                    year: year as u16,
                    ..Default::default()
                });
            } else {
                tag.remove_date();
                tag.remove_key(ItemKey::RecordingDate);
                tag.remove_key(ItemKey::Year);
            }

            // Genre
            if let Some(genre) = clean_genre {
                tag.set_genre(genre.to_string());
            } else {
                tag.remove_genre();
                tag.remove_key(ItemKey::Genre);
            }

            // Track number
            if let Some(num) = payload.track_number.filter(|&n| n > 0) {
                tag.set_track(num);
            } else {
                tag.remove_track();
                tag.remove_key(ItemKey::TrackNumber);
            }

            // Track total
            if let Some(total) = payload.track_total.filter(|&t| t > 0) {
                tag.set_track_total(total);
            } else {
                tag.remove_track_total();
                tag.remove_key(ItemKey::TrackTotal);
            }

            // Comment
            if let Some(comment) = clean_comment {
                tag.set_comment(comment.to_string());
            } else {
                tag.remove_comment();
                tag.remove_key(ItemKey::Comment);
            }

            // Lyrics
            if let Some(ref lyrics_text) = payload.lyrics {
                let trimmed = lyrics_text.trim();
                if trimmed.is_empty() {
                    tag.remove_key(ItemKey::Lyrics);
                    tag.remove_key(ItemKey::UnsyncLyrics);
                } else {
                    tag.insert_text(ItemKey::Lyrics, trimmed.to_string());
                    tag.insert_text(ItemKey::UnsyncLyrics, trimmed.to_string());
                }
            }

            // Artwork
            if payload.remove_artwork {
                tag.remove_picture_type(PictureType::CoverFront);
                tag.remove_picture_type(PictureType::Other);
                while !tag.pictures().is_empty() {
                    tag.remove_picture(0);
                }
            }
            if let Some(ref pic) = new_picture {
                tag.set_picture(0, pic.clone());
            }
        }
    }

    // Manage external .lrc file
    if let Some(ref lyrics_text) = payload.lyrics {
        let trimmed = lyrics_text.trim();
        let is_synced = crate::lyrics::is_synced_lrc(trimmed);
        if trimmed.is_empty() {
            let lrc_path = path.with_extension("lrc");
            if lrc_path.is_file() {
                let _ = fs::remove_file(lrc_path);
            }
        } else if payload.save_lrc_file || is_synced {
            let lrc_path = path.with_extension("lrc");
            let _ = fs::write(lrc_path, trimmed);
        }
    }

    // Save all tags across the file
    tagged_file.save_to_path(path, WriteOptions::default())
        .with_context(|| format!("Failed to save audio tags to: {}", path.display()))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use lofty::tag::TagType;

    fn create_test_wav(path: &Path) {
        let mut f = fs::File::create(path).unwrap();
        f.write_all(b"RIFF\x28\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x04\x00\x00\x00\x00\x00\x00\x00").unwrap();
    }

    fn create_test_mp3(path: &Path) {
        let mut f = fs::File::create(path).unwrap();
        // A few valid MPEG 1 Layer 3 audio frames (417 bytes each for 128kbps, 44.1kHz)
        let frame_header = [0xFF, 0xFB, 0x90, 0x00];
        for _ in 0..5 {
            f.write_all(&frame_header).unwrap();
            f.write_all(&[0u8; 413]).unwrap();
        }
        // Append 128-byte ID3v1 tag at the end
        let mut id3v1 = [0u8; 128];
        id3v1[0..3].copy_from_slice(b"TAG");
        // Title (3..33)
        let title = b"Test Title";
        id3v1[3..3 + title.len()].copy_from_slice(title);
        // Artist (33..63)
        let artist = b"Test Artist";
        id3v1[33..33 + artist.len()].copy_from_slice(artist);
        // Album (63..93)
        let album = b"Old ID3v1 Album";
        id3v1[63..63 + album.len()].copy_from_slice(album);
        // Year (93..97)
        id3v1[93..97].copy_from_slice(b"2024");
        f.write_all(&id3v1).unwrap();
    }

    #[test]
    fn test_mp3_id3v1_and_id3v2_album_clearing() {
        let temp_dir = std::env::temp_dir().join("liertags_test_mp3_tags");
        let _ = fs::create_dir_all(&temp_dir);
        let mp3_path = temp_dir.join("test_song.mp3");
        create_test_mp3(&mp3_path);

        // Verify ID3v1 is parsed
        {
            let tagged_file = Probe::open(&mp3_path).unwrap().read().unwrap();
            println!("Initial MP3 tags count: {}", tagged_file.tags().len());
            for t in tagged_file.tags() {
                println!("Initial MP3 tag: {:?}, album: {:?}", t.tag_type(), t.album());
            }
        }

        // Now save an ID3v2 tag with an album as well
        let payload_set = SaveTrackPayload {
            file_path: mp3_path.to_string_lossy().to_string(),
            title: Some("Test Title".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("ID3v2 Album".to_string()),
            year: Some(2024),
            genre: None,
            track_number: None,
            track_total: None,
            comment: None,
            lyrics: None,
            save_lrc_file: false,
            new_artwork_base64: None,
            remove_artwork: false,
        };
        let _ = save_track(&payload_set).unwrap();

        // Now clear the album
        let payload_clear = SaveTrackPayload {
            file_path: mp3_path.to_string_lossy().to_string(),
            title: Some("Test Title".to_string()),
            artist: Some("Test Artist".to_string()),
            album: None,
            year: Some(2024),
            genre: None,
            track_number: None,
            track_total: None,
            comment: None,
            lyrics: None,
            save_lrc_file: false,
            new_artwork_base64: None,
            remove_artwork: false,
        };
        let res = save_track(&payload_clear).unwrap();
        assert_eq!(res.metadata.album, None);

        let tagged_file_after = Probe::open(&mp3_path).unwrap().read().unwrap();
        for t in tagged_file_after.tags() {
            assert_eq!(t.album(), None, "Tag {:?} must have album cleared", t.tag_type());
        }

        let _ = fs::remove_file(&mp3_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_save_empty_string_album() {
        let temp_dir = std::env::temp_dir().join("liertags_test_empty_album");
        let _ = fs::create_dir_all(&temp_dir);
        let wav_path = temp_dir.join("test_empty.wav");
        create_test_wav(&wav_path);

        let mut id3_tag = Tag::new(TagType::Id3v2);
        id3_tag.set_album("Initial Album".to_string());
        id3_tag.save_to_path(&wav_path, WriteOptions::default()).unwrap();

        let payload_empty_str = SaveTrackPayload {
            file_path: wav_path.to_string_lossy().to_string(),
            title: Some("Title".to_string()),
            artist: Some("Artist".to_string()),
            album: Some("".to_string()),
            year: None,
            genre: None,
            track_number: None,
            track_total: None,
            comment: None,
            lyrics: None,
            save_lrc_file: false,
            new_artwork_base64: None,
            remove_artwork: false,
        };

        let res = save_track(&payload_empty_str).unwrap();
        assert_eq!(res.metadata.album, None);

        let tagged_file_after = Probe::open(&wav_path).unwrap().read().unwrap();
        for t in tagged_file_after.tags() {
            assert_eq!(t.album(), None, "Tag {:?} must have album cleared when empty string passed", t.tag_type());
        }

        let _ = fs::remove_file(&wav_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_save_and_remove_album_multiple_tags() {
        let temp_dir = std::env::temp_dir().join("liertags_test_multitags");
        let _ = fs::create_dir_all(&temp_dir);
        let wav_path = temp_dir.join("test_multi.wav");
        create_test_wav(&wav_path);

        // 1. Manually insert TWO tags into the file: RiffInfo AND Id3v2, both having the album!
        {
            let mut riff_tag = Tag::new(TagType::RiffInfo);
            riff_tag.set_album("Old Riff Album".to_string());
            riff_tag.save_to_path(&wav_path, WriteOptions::default()).unwrap();

            let mut id3_tag = Tag::new(TagType::Id3v2);
            id3_tag.set_album("Old ID3 Album".to_string());
            id3_tag.save_to_path(&wav_path, WriteOptions::default()).unwrap();
        }

        // Verify file has 2 tags
        {
            let tagged_file = Probe::open(&wav_path).unwrap().read().unwrap();
            println!("Tags count in file: {}", tagged_file.tags().len());
            for t in tagged_file.tags() {
                println!("Tag {:?} album: {:?}", t.tag_type(), t.album());
            }
        }

        // 2. Now call save_track with album = None (user deleted the album in UI)
        let payload_clear = SaveTrackPayload {
            file_path: wav_path.to_string_lossy().to_string(),
            title: Some("My Title".to_string()),
            artist: Some("My Artist".to_string()),
            album: None,
            year: Some(2024),
            genre: None,
            track_number: None,
            track_total: None,
            comment: None,
            lyrics: None,
            save_lrc_file: false,
            new_artwork_base64: None,
            remove_artwork: false,
        };

        let res = save_track(&payload_clear).unwrap();
        assert_eq!(res.metadata.album, None);

        let tagged_file_after = Probe::open(&wav_path).unwrap().read().unwrap();
        for t in tagged_file_after.tags() {
            assert_eq!(t.album(), None, "Tag {:?} must have album cleared", t.tag_type());
        }

        let _ = fs::remove_file(&wav_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
