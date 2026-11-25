use anyhow::Result;
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use crate::cache::LibraryCache;
use crate::models::{DeleteSummary, DuplicateFileItem, DuplicateGroup, DuplicateMode, Track};

/// Compute SHA-256 hash of a file on disk
fn compute_file_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024]; // 64 KB buffer

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Normalize strings for metadata comparison
fn normalize_str(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Find duplicate tracks using the selected mode
pub fn find_duplicates(tracks: &[Track], mode: DuplicateMode) -> Vec<DuplicateGroup> {
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    match mode {
        DuplicateMode::SizeDuration => {
            let mut buckets: HashMap<(u64, u64), Vec<&Track>> = HashMap::new();
            for track in tracks {
                if track.file_size_bytes > 0 && track.properties.duration_seconds > 0 {
                    buckets
                        .entry((track.file_size_bytes, track.properties.duration_seconds))
                        .or_default()
                        .push(track);
                }
            }

            for ((size, duration), items) in buckets {
                if items.len() >= 2 {
                    let first = items[0];
                    let title = first
                        .metadata
                        .title
                        .clone()
                        .unwrap_or_else(|| first.file_name.clone());
                    let artist = first.metadata.artist.clone();

                    groups.push(build_duplicate_group(
                        title,
                        artist,
                        format!(
                            "Одинаковый размер ({} байт) и длительность ({} сек)",
                            size, duration
                        ),
                        items,
                    ));
                }
            }
        }

        DuplicateMode::Metadata => {
            let mut buckets: HashMap<(String, String), Vec<&Track>> = HashMap::new();

            for track in tracks {
                let title = track.metadata.title.as_deref().unwrap_or("").trim();
                let artist = track.metadata.artist.as_deref().unwrap_or("").trim();

                if !title.is_empty() {
                    let key = (normalize_str(title), normalize_str(artist));
                    buckets.entry(key).or_default().push(track);
                }
            }

            for ((_norm_t, _norm_a), items) in buckets {
                if items.len() >= 2 {
                    let first = items[0];
                    let title = first
                        .metadata
                        .title
                        .clone()
                        .unwrap_or_else(|| first.file_name.clone());
                    let artist = first.metadata.artist.clone();

                    groups.push(build_duplicate_group(
                        title,
                        artist,
                        "Совпадение названия трека и исполнителя".to_string(),
                        items,
                    ));
                }
            }
        }

        DuplicateMode::Hash => {
            // Optimization: Only compute hash for files that share identical byte sizes
            let mut size_buckets: HashMap<u64, Vec<&Track>> = HashMap::new();
            for track in tracks {
                if track.file_size_bytes > 0 {
                    size_buckets
                        .entry(track.file_size_bytes)
                        .or_default()
                        .push(track);
                }
            }

            // Collect candidate files that have potential size collisions
            let candidate_tracks: Vec<&Track> = size_buckets
                .into_iter()
                .filter(|(_, items)| items.len() >= 2)
                .flat_map(|(_, items)| items)
                .collect();

            // Compute SHA-256 in parallel using Rayon
            let hashed_items: Vec<(&Track, String)> = candidate_tracks
                .par_iter()
                .filter_map(|&track| {
                    let path = Path::new(&track.file_path);
                    compute_file_sha256(path).ok().map(|hash| (track, hash))
                })
                .collect();

            let mut hash_buckets: HashMap<String, Vec<&Track>> = HashMap::new();
            for (track, hash) in hashed_items {
                hash_buckets.entry(hash).or_default().push(track);
            }

            for (hash, items) in hash_buckets {
                if items.len() >= 2 {
                    let first = items[0];
                    let title = first
                        .metadata
                        .title
                        .clone()
                        .unwrap_or_else(|| first.file_name.clone());
                    let artist = first.metadata.artist.clone();

                    let short_hash = if hash.len() > 12 { &hash[..12] } else { &hash };
                    groups.push(build_duplicate_group(
                        title,
                        artist,
                        format!("Идентичный SHA-256 хеш ({})", short_hash),
                        items,
                    ));
                }
            }
        }
    }

    // Sort groups alphabetically by title
    groups.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    groups
}

/// Helper to build and sort a DuplicateGroup
fn build_duplicate_group(
    title: String,
    artist: Option<String>,
    match_reason: String,
    items: Vec<&Track>,
) -> DuplicateGroup {
    let mut file_items: Vec<DuplicateFileItem> = items
        .into_iter()
        .map(|t| DuplicateFileItem {
            track_id: t.id.clone(),
            file_path: t.file_path.clone(),
            file_name: t.file_name.clone(),
            file_size_bytes: t.file_size_bytes,
            bitrate_kbps: t.properties.bitrate_kbps,
            extension: t.extension.clone(),
            duration_seconds: t.properties.duration_seconds,
        })
        .collect();

    // Sort files within the group: highest bitrate and size first (best quality first)
    file_items.sort_by(|a, b| {
        b.bitrate_kbps
            .unwrap_or(0)
            .cmp(&a.bitrate_kbps.unwrap_or(0))
            .then_with(|| b.file_size_bytes.cmp(&a.file_size_bytes))
    });

    let group_id = format!(
        "{:x}",
        crate::tags::md5_hash(format!("{}:{:?}", title, artist).as_bytes())
    );

    DuplicateGroup {
        group_id,
        title,
        artist,
        match_reason,
        files: file_items,
    }
}

/// Delete selected duplicate files from disk and SQLite cache
pub fn delete_duplicate_files(file_paths: &[String]) -> Result<DeleteSummary> {
    let mut summary = DeleteSummary::default();
    let cache = LibraryCache::new().ok();

    for path_str in file_paths {
        let path = Path::new(path_str);
        if !path.exists() {
            summary.failed_count += 1;
            summary
                .logs
                .push(format!("Файл не найден для удаления: {}", path_str));
            continue;
        }

        match fs::remove_file(path) {
            Ok(()) => {
                summary.deleted_count += 1;
                summary.logs.push(format!("Удален файл: {}", path_str));

                // Also delete companion .lrc file if present
                let lrc_path = path.with_extension("lrc");
                if lrc_path.is_file() {
                    let _ = fs::remove_file(&lrc_path);
                }

                // Invalidate SQLite cache
                if let Some(ref c) = cache {
                    let _ = c.remove_path(path_str);
                }
            }
            Err(err) => {
                summary.failed_count += 1;
                summary
                    .logs
                    .push(format!("Не удалось удалить {}: {}", path_str, err));
            }
        }
    }

    Ok(summary)
}
