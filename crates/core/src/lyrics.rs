use anyhow::{Context, Result};
use lofty::config::WriteOptions;
use lofty::file::{TaggedFile, TaggedFileExt};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use std::fs;
use std::path::Path;

use crate::models::LrcLibLyrics;

const USER_AGENT: &str = "LierTags/1.1.0 (https://github.com/LaRCorp/LierTags)";

/// Search lyrics from LRCLIB open API
pub async fn find_lyrics(
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<u64>,
) -> Result<Option<LrcLibLyrics>> {
    search_lrclib(title, artist, album, duration).await
}

/// Fetch lyrics from LRCLIB open API using lightweight `ureq`
pub async fn search_lrclib(
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<u64>,
) -> Result<Option<LrcLibLyrics>> {
    let title = title.to_string();
    let artist = artist.map(|s| s.to_string());
    let album = album.map(|s| s.to_string());

    tokio::task::spawn_blocking(move || -> Result<Option<LrcLibLyrics>> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(10)))
            .build()
            .into();

        // 1. Try exact match /api/get if title and artist are present
        if let Some(ref art) = artist {
            let mut req = agent
                .get("https://lrclib.net/api/get")
                .header("User-Agent", USER_AGENT)
                .query("track_name", &title)
                .query("artist_name", art);
            if let Some(ref alb) = album {
                req = req.query("album_name", alb);
            }
            if let Some(d) = duration {
                req = req.query("duration", &d.to_string());
            }

            if let Ok(mut res) = req.call() {
                if let Ok(lyrics) = res.body_mut().read_json::<LrcLibLyrics>() {
                    if lyrics.plain_lyrics.is_some() || lyrics.synced_lyrics.is_some() {
                        return Ok(Some(lyrics));
                    }
                }
            }
        }

        // 2. Fallback to /api/search?track_name=...&artist_name=...
        let mut req = agent
            .get("https://lrclib.net/api/search")
            .header("User-Agent", USER_AGENT)
            .query("track_name", &title);
        if let Some(ref art) = artist {
            req = req.query("artist_name", art);
        }

        let mut res = req.call().context("Failed to query LRCLIB search API")?;
        let items: Vec<LrcLibLyrics> = res.body_mut().read_json().unwrap_or_default();
        if let Some(first) = items
            .into_iter()
            .find(|l| l.plain_lyrics.is_some() || l.synced_lyrics.is_some())
        {
            return Ok(Some(first));
        }

        Ok(None)
    })
    .await
    .map_err(|e| anyhow::anyhow!("LRCLIB task failed: {e}"))?
}

/// Read lyrics from an already probed TaggedFile or companion .lrc file
pub fn read_lyrics_from_tagged_file(
    tagged_file: &TaggedFile,
    path: &Path,
) -> (Option<String>, bool) {
    // 1. First check companion .lrc file next to the audio file
    let lrc_path = path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(content) = fs::read_to_string(&lrc_path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                let is_synced = is_synced_lrc(trimmed);
                return (Some(trimmed.to_string()), is_synced);
            }
        }
    }

    // 2. Check embedded audio tags across all available tag formats (ID3v2, Vorbis, MP4, APE)
    for tag in tagged_file.tags() {
        // A. Check standard Lofty ItemKey::UnsyncLyrics (ID3v2 USLT) and ItemKey::Lyrics (Vorbis/MP4)
        for str_val in tag
            .get_strings(ItemKey::UnsyncLyrics)
            .chain(tag.get_strings(ItemKey::Lyrics))
        {
            let trimmed = str_val.trim();
            if !trimmed.is_empty() {
                let is_synced = is_synced_lrc(trimmed);
                return (Some(trimmed.to_string()), is_synced);
            }
        }

        // B. Also iterate all items for case-insensitive or custom lyrics tags
        for item in tag.items() {
            let is_lyrics_key =
                item.key() == ItemKey::UnsyncLyrics || item.key() == ItemKey::Lyrics;
            let desc = item.description().to_ascii_lowercase();
            let is_lyrics_desc = desc.contains("lyrics") || desc.contains("unsynced");

            if is_lyrics_key || is_lyrics_desc {
                if let Some(text) = item.value().text() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let is_synced = is_synced_lrc(trimmed);
                        return (Some(trimmed.to_string()), is_synced);
                    }
                }
            }
        }
    }

    (None, false)
}

/// Read lyrics from audio tags or companion .lrc file by opening the path
pub fn read_lyrics_from_path(path: &Path) -> (Option<String>, bool) {
    if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read().map_err(Into::into)) {
        read_lyrics_from_tagged_file(&tagged_file, path)
    } else {
        let lrc_path = path.with_extension("lrc");
        if lrc_path.is_file() {
            if let Ok(content) = fs::read_to_string(&lrc_path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    let is_synced = is_synced_lrc(trimmed);
                    return (Some(trimmed.to_string()), is_synced);
                }
            }
        }
        (None, false)
    }
}

/// Save lyrics into audio file tags and optionally create .lrc companion file
pub fn save_lyrics_to_file(path: &Path, lyrics_text: &str, save_lrc_file: bool) -> Result<()> {
    if !path.exists() {
        return Err(anyhow::anyhow!("File does not exist: {}", path.display()));
    }

    // 1. Save into audio tags
    let mut tagged_file = Probe::open(path)
        .with_context(|| format!("Failed to open file: {}", path.display()))?
        .read()
        .with_context(|| format!("Failed to read tags: {}", path.display()))?;

    let tag_type = tagged_file.primary_tag_type();
    let tag = match tagged_file.tag_mut(tag_type) {
        Some(t) => t,
        None => {
            let new_tag = Tag::new(tag_type);
            tagged_file.insert_tag(new_tag);
            tagged_file
                .tag_mut(tag_type)
                .ok_or_else(|| anyhow::anyhow!("Failed to create tag"))?
        }
    };

    let is_synced = is_synced_lrc(lyrics_text);

    // Lofty: UnsyncLyrics maps to ID3 USLT; Lyrics maps to Vorbis LYRICS
    tag.insert_text(ItemKey::Lyrics, lyrics_text.to_string());
    tag.insert_text(ItemKey::UnsyncLyrics, lyrics_text.to_string());

    tag.save_to_path(path, WriteOptions::default())
        .with_context(|| format!("Failed to write lyrics tag to: {}", path.display()))?;

    // 2. Optionally save companion .lrc file
    if save_lrc_file || is_synced {
        let lrc_path = path.with_extension("lrc");
        let _ = fs::write(lrc_path, lyrics_text);
    }

    Ok(())
}

/// Detect if text format is synchronized LRC ([mm:ss.xx] timestamped)
pub fn is_synced_lrc(text: &str) -> bool {
    text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with('[')
            && trimmed.contains(']')
            && (trimmed.contains(':') || trimmed.contains('.'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_synced_lrc() {
        assert!(is_synced_lrc("[00:12.34] Hello world"));
        assert!(is_synced_lrc("[01:23:45] Line with full timecode"));
        assert!(!is_synced_lrc(
            "Plain lyrics line 1\nLine 2 without timecode"
        ));
        assert!(!is_synced_lrc("[Intro]\nSome guitar solo"));
    }

    #[test]
    fn test_companion_lrc_file() {
        let temp_dir = std::env::temp_dir().join("liertags_test_lyrics");
        let _ = fs::create_dir_all(&temp_dir);
        let audio_path = temp_dir.join("test_song.mp3");
        let lrc_path = temp_dir.join("test_song.lrc");

        let lyrics_content = "[00:05.10]First line\n[00:10.20]Second line";
        fs::write(&lrc_path, lyrics_content).unwrap();

        let (read_text, is_synced) = read_lyrics_from_path(&audio_path);
        assert_eq!(read_text.as_deref(), Some(lyrics_content));
        assert!(is_synced);

        let _ = fs::remove_file(&lrc_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
