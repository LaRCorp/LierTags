use std::fs;
use std::path::Path;
use anyhow::{Context, Result};
use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};

use crate::models::LrcLibLyrics;

const USER_AGENT: &str = "LierTags/0.1.0 (https://github.com/LaRevole/LierTags)";

/// Search lyrics from LRCLIB open API
pub async fn find_lyrics(
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<u64>,
) -> Result<Option<LrcLibLyrics>> {
    search_lrclib(title, artist, album, duration).await
}

/// Fetch lyrics from LRCLIB open API
pub async fn search_lrclib(
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<u64>,
) -> Result<Option<LrcLibLyrics>> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()?;

    // 1. Try exact match /api/get if title and artist are present
    if let Some(art) = artist {
        let mut params = vec![
            ("track_name", title.to_string()),
            ("artist_name", art.to_string()),
        ];
        if let Some(alb) = album {
            params.push(("album_name", alb.to_string()));
        }
        if let Some(d) = duration {
            params.push(("duration", d.to_string()));
        }

        let resp = client
            .get("https://lrclib.net/api/get")
            .query(&params)
            .send()
            .await;

        if let Ok(res) = resp {
            if res.status().is_success() {
                if let Ok(lyrics) = res.json::<LrcLibLyrics>().await {
                    if lyrics.plain_lyrics.is_some() || lyrics.synced_lyrics.is_some() {
                        return Ok(Some(lyrics));
                    }
                }
            }
        }
    }

    // 2. Fallback to /api/search?q=... or track_name & artist_name search
    let mut search_params = vec![("track_name", title.to_string())];
    if let Some(art) = artist {
        search_params.push(("artist_name", art.to_string()));
    }

    let resp = client
        .get("https://lrclib.net/api/search")
        .query(&search_params)
        .send()
        .await
        .context("Failed to query LRCLIB search API")?;

    if resp.status().is_success() {
        let items: Vec<LrcLibLyrics> = resp.json().await.unwrap_or_default();
        if let Some(first) = items.into_iter().find(|l| l.plain_lyrics.is_some() || l.synced_lyrics.is_some()) {
            return Ok(Some(first));
        }
    }

    Ok(None)
}

/// Read lyrics from audio tags or companion .lrc file
pub fn read_lyrics_from_path(path: &Path) -> (Option<String>, bool) {
    // 1. First check companion .lrc file
    let lrc_path = path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(content) = fs::read_to_string(&lrc_path) {
            let is_synced = is_synced_lrc(&content);
            return (Some(content), is_synced);
        }
    }

    // 2. Check embedded audio tags
    if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read().map_err(Into::into)) {
        if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
            let lyrics_str = tag
                .get_string(ItemKey::Lyrics)
                .or_else(|| tag.get_string(ItemKey::UnsyncLyrics))
                .map(|s| s.to_string());

            if let Some(text) = lyrics_str {
                let is_synced = is_synced_lrc(&text);
                return (Some(text), is_synced);
            }
        }
    }

    (None, false)
}

/// Save lyrics into audio file tags and optionally create .lrc companion file
pub fn save_lyrics_to_file(
    path: &Path,
    lyrics_text: &str,
    save_lrc_file: bool,
) -> Result<()> {
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
            tagged_file.tag_mut(tag_type).ok_or_else(|| anyhow::anyhow!("Failed to create tag"))?
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
        trimmed.starts_with('[') && trimmed.contains(']') && (trimmed.contains(':') || trimmed.contains('.'))
    })
}

