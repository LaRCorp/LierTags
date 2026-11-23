use std::fs;
use std::path::Path;
use anyhow::Result;

use crate::cache::{get_file_mtime_secs, LibraryCache};
use crate::models::{OrganizeAction, OrganizePreviewItem, OrganizeSummary, Track};
use crate::tags::read_track_summary;

/// Sanitize a path component (folder or filename) removing illegal Windows filesystem characters
pub fn sanitize_path_segment(segment: &str) -> String {
    let forbidden = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut cleaned = String::with_capacity(segment.len());

    for ch in segment.chars() {
        if forbidden.contains(&ch) || (ch as u32) < 32 {
            cleaned.push('_');
        } else {
            cleaned.push(ch);
        }
    }

    // Windows disallows trailing spaces and periods in file/directory names
    let trimmed = cleaned.trim().trim_end_matches('.').trim();

    // Check reserved Windows device names
    let upper = trimmed.to_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    if trimmed.is_empty() {
        "Unknown".to_string()
    } else if reserved.contains(&upper.as_str()) {
        format!("{}_item", trimmed)
    } else {
        trimmed.to_string()
    }
}

/// Substitute template tokens with track metadata and build destination path relative to target folder
pub fn resolve_relative_destination(track: &Track, template: &str) -> String {
    let artist = track
        .metadata
        .artist
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Unknown Artist");

    let album = track
        .metadata
        .album
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Unknown Album");

    let title = track
        .metadata
        .title
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            Path::new(&track.file_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown Track")
        });

    let track_num = track
        .metadata
        .track_number
        .map(|n| format!("{:02}", n))
        .unwrap_or_default();

    let year = track
        .metadata
        .year
        .map(|y| y.to_string())
        .unwrap_or_else(|| "Unknown Year".to_string());

    let genre = track
        .metadata
        .genre
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Unknown Genre");

    let ext = &track.extension;

    // Normalize slashes in template
    let normalized_template = template.replace('\\', "/");

    // Split template into directory segments and file name segment
    let segments: Vec<&str> = normalized_template
        .split('/')
        .filter(|s| !s.trim().is_empty())
        .collect();

    if segments.is_empty() {
        return track.file_name.clone();
    }

    let mut sanitized_parts = Vec::with_capacity(segments.len());

    for (idx, seg) in segments.iter().enumerate() {
        let is_last = idx == segments.len() - 1;

        let mut replaced = seg.to_string();
        replaced = replaced.replace("{Artist}", artist).replace("{artist}", artist);
        replaced = replaced.replace("{Album}", album).replace("{album}", album);
        replaced = replaced.replace("{Title}", title).replace("{title}", title);
        replaced = replaced
            .replace("{TrackNumber}", &track_num)
            .replace("{tracknumber}", &track_num)
            .replace("{Track}", &track_num)
            .replace("{track}", &track_num);
        replaced = replaced.replace("{Year}", &year).replace("{year}", &year);
        replaced = replaced.replace("{Genre}", genre).replace("{genre}", genre);
        replaced = replaced.replace("{ext}", ext).replace("{Ext}", ext);

        // Clean double spaces or leading/trailing hyphens from empty track numbers
        let cleaned = replaced
            .replace(" - - ", " - ")
            .trim_start_matches("- ")
            .trim_start_matches(" -")
            .trim()
            .to_string();

        let mut sanitized = sanitize_path_segment(&cleaned);

        // Ensure the last segment (file name) has the correct audio extension
        if is_last {
            let ext_suffix = format!(".{}", ext.to_ascii_lowercase());
            if !sanitized.to_ascii_lowercase().ends_with(&ext_suffix) {
                sanitized.push_str(&ext_suffix);
            }
        }

        sanitized_parts.push(sanitized);
    }

    sanitized_parts.join("/")
}

/// Generate a preview list of planned file moves before executing
pub fn preview_organization(
    tracks: &[Track],
    base_dest_folder: &Path,
    template: &str,
) -> Vec<OrganizePreviewItem> {
    tracks
        .iter()
        .map(|track| {
            let original_p = Path::new(&track.file_path);
            let rel_dest = resolve_relative_destination(track, template);
            let full_dest = base_dest_folder.join(rel_dest.replace('/', std::path::MAIN_SEPARATOR_STR));

            let original_canon = original_p.canonicalize().unwrap_or_else(|_| original_p.to_path_buf());
            let dest_canon = full_dest.canonicalize().unwrap_or_else(|_| full_dest.clone());

            let is_missing_metadata = track.metadata.artist.is_none() && track.metadata.title.is_none();

            let (status, will_move) = if original_canon == dest_canon {
                ("identical".to_string(), false)
            } else if full_dest.exists() {
                ("target_exists".to_string(), false)
            } else if is_missing_metadata {
                ("missing_tags".to_string(), true)
            } else {
                ("ready".to_string(), true)
            };

            OrganizePreviewItem {
                original_path: track.file_path.clone(),
                file_name: track.file_name.clone(),
                destination_path: full_dest.to_string_lossy().to_string(),
                relative_destination: rel_dest,
                status,
                will_move,
            }
        })
        .collect()
}

/// Execute file moves safely with cross-volume fallback, LRC companion moving, and SQLite cache sync
pub fn organize_files(actions: &[OrganizeAction]) -> Result<OrganizeSummary> {
    let mut summary = OrganizeSummary::default();
    let cache = LibraryCache::new().ok();

    for action in actions {
        let src = Path::new(&action.original_path);
        let dst = Path::new(&action.destination_path);

        if src == dst {
            summary.skipped_count += 1;
            summary.logs.push(format!("Пропущено (пути совпадают): {}", src.display()));
            continue;
        }

        if !src.exists() {
            summary.error_count += 1;
            summary.logs.push(format!("Ошибка: исходный файл не существует: {}", src.display()));
            continue;
        }

        // Ensure destination folder exists
        if let Some(parent) = dst.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                summary.error_count += 1;
                summary.logs.push(format!(
                    "Ошибка создания директории {}: {}",
                    parent.display(),
                    err
                ));
                continue;
            }
        }

        // Prevent overwriting existing file
        if dst.exists() {
            summary.skipped_count += 1;
            summary.logs.push(format!(
                "Пропущено: целевой файл уже существует: {}",
                dst.display()
            ));
            continue;
        }

        // Try atomic rename; if fails (e.g. cross-drive move), fallback to copy + remove
        let move_result = fs::rename(src, dst).or_else(|_| {
            fs::copy(src, dst).and_then(|_| fs::remove_file(src))
        });

        match move_result {
            Ok(()) => {
                summary.moved_count += 1;
                summary.logs.push(format!(
                    "Перемещено: {} -> {}",
                    src.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                    dst.display()
                ));

                // Also move companion .lrc file if it exists
                let src_lrc = src.with_extension("lrc");
                let dst_lrc = dst.with_extension("lrc");
                if src_lrc.is_file() {
                    let _ = fs::rename(&src_lrc, &dst_lrc).or_else(|_| {
                        fs::copy(&src_lrc, &dst_lrc).and_then(|_| fs::remove_file(&src_lrc))
                    });
                }

                // Synchronize SQLite cache: remove old path and insert new path
                if let Some(ref c) = cache {
                    let _ = c.remove_path(&action.original_path);
                    if let Ok(meta) = fs::metadata(dst) {
                        if let Ok(new_track) = read_track_summary(dst) {
                            let _ = c.update_single(&new_track, get_file_mtime_secs(&meta));
                        }
                    }
                }
            }
            Err(err) => {
                summary.error_count += 1;
                summary.logs.push(format!(
                    "Ошибка перемещения {}: {}",
                    src.display(),
                    err
                ));
            }
        }
    }

    Ok(summary)
}