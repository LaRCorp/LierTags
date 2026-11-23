use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::models::{AudioProperties, Track, TrackMetadata};

pub struct TrackCacheEntry {
    pub file_size: u64,
    pub mtime: u64,
    pub track: Track,
}

pub struct LibraryCache {
    db_path: PathBuf,
}

impl LibraryCache {
    /// Open or create the library cache database in application data directory
    pub fn new() -> Result<Self> {
        let base_dir = std::env::var_os("LIERTAGS_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| dirs::data_dir().map(|d| d.join("LierTags")))
            .unwrap_or_else(|| PathBuf::from("./data"));

        fs::create_dir_all(&base_dir)
            .with_context(|| format!("Failed to create cache directory: {}", base_dir.display()))?;

        let db_path = base_dir.join("library_cache.db");
        let cache = Self { db_path };
        cache.init()?;
        Ok(cache)
    }

    fn connect(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)
            .with_context(|| format!("Failed to open cache database at {}", self.db_path.display()))?;
        // WAL mode for fast concurrent reading/writing
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        Ok(conn)
    }

    fn init(&self) -> Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS track_cache (
                file_path TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                mtime INTEGER NOT NULL,
                extension TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                year INTEGER,
                genre TEXT,
                track_number INTEGER,
                track_total INTEGER,
                comment TEXT,
                has_artwork INTEGER NOT NULL,
                artwork_mime TEXT,
                duration_seconds INTEGER NOT NULL,
                bitrate_kbps INTEGER,
                sample_rate_hz INTEGER,
                channels INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_track_cache_folder ON track_cache(file_path);",
        )?;
        Ok(())
    }

    /// Load all cached track records for a given folder prefix into memory map
    pub fn get_cached_for_folder(&self, folder_str: &str) -> HashMap<String, TrackCacheEntry> {
        let mut map = HashMap::new();
        let Ok(conn) = self.connect() else { return map };

        let pattern = format!("{}%", folder_str);
        let mut stmt = match conn.prepare(
            "SELECT file_path, file_name, file_size, mtime, extension,
                    title, artist, album, year, genre, track_number, track_total, comment,
                    has_artwork, artwork_mime, duration_seconds, bitrate_kbps, sample_rate_hz, channels
             FROM track_cache
             WHERE file_path LIKE ?1",
        ) {
            Ok(s) => s,
            Err(_) => return map,
        };

        let rows = stmt.query_map(params![pattern], |row| {
            let file_path: String = row.get(0)?;
            let file_name: String = row.get(1)?;
            let file_size: u64 = row.get::<_, i64>(2)? as u64;
            let mtime: u64 = row.get::<_, i64>(3)? as u64;
            let extension: String = row.get(4)?;

            let title: Option<String> = row.get(5)?;
            let artist: Option<String> = row.get(6)?;
            let album: Option<String> = row.get(7)?;
            let year: Option<u32> = row.get(8)?;
            let genre: Option<String> = row.get(9)?;
            let track_number: Option<u32> = row.get(10)?;
            let track_total: Option<u32> = row.get(11)?;
            let comment: Option<String> = row.get(12)?;
            let has_artwork: bool = row.get::<_, i64>(13)? != 0;
            let artwork_mime: Option<String> = row.get(14)?;

            let duration_seconds: u64 = row.get::<_, i64>(15)? as u64;
            let bitrate_kbps: Option<u32> = row.get(16)?;
            let sample_rate_hz: Option<u32> = row.get(17)?;
            let channels: Option<u8> = row.get(18)?;

            let id = format!("{:x}", crate::tags::md5_hash(file_path.as_bytes()));

            let track = Track {
                id,
                file_path: file_path.clone(),
                file_name,
                file_size_bytes: file_size,
                extension,
                metadata: TrackMetadata {
                    title,
                    artist,
                    album,
                    year,
                    genre,
                    track_number,
                    track_total,
                    comment,
                    lyrics: None,
                    is_synced_lyrics: false,
                    has_artwork,
                    artwork_mime,
                    artwork_base64: None, // lazy loaded
                },
                properties: AudioProperties {
                    duration_seconds,
                    bitrate_kbps,
                    sample_rate_hz,
                    channels,
                },
                dirty: false,
            };

            Ok((file_path, TrackCacheEntry { file_size, mtime, track }))
        });

        if let Ok(entries) = rows {
            for entry in entries.flatten() {
                map.insert(entry.0, entry.1);
            }
        }

        map
    }

    /// Retrieve single cached track if size and mtime match
    pub fn get_single(&self, path_str: &str, file_size: u64, mtime: u64) -> Option<Track> {
        let conn = self.connect().ok()?;
        let mut stmt = conn.prepare(
            "SELECT file_path, file_name, file_size, mtime, extension,
                    title, artist, album, year, genre, track_number, track_total, comment,
                    has_artwork, artwork_mime, duration_seconds, bitrate_kbps, sample_rate_hz, channels
             FROM track_cache
             WHERE file_path = ?1 AND file_size = ?2 AND mtime = ?3",
        ).ok()?;

        let mut rows = stmt.query_map(params![path_str, file_size as i64, mtime as i64], |row| {
            let file_path: String = row.get(0)?;
            let file_name: String = row.get(1)?;
            let extension: String = row.get(4)?;

            let title: Option<String> = row.get(5)?;
            let artist: Option<String> = row.get(6)?;
            let album: Option<String> = row.get(7)?;
            let year: Option<u32> = row.get(8)?;
            let genre: Option<String> = row.get(9)?;
            let track_number: Option<u32> = row.get(10)?;
            let track_total: Option<u32> = row.get(11)?;
            let comment: Option<String> = row.get(12)?;
            let has_artwork: bool = row.get::<_, i64>(13)? != 0;
            let artwork_mime: Option<String> = row.get(14)?;

            let duration_seconds: u64 = row.get::<_, i64>(15)? as u64;
            let bitrate_kbps: Option<u32> = row.get(16)?;
            let sample_rate_hz: Option<u32> = row.get(17)?;
            let channels: Option<u8> = row.get(18)?;

            let id = format!("{:x}", crate::tags::md5_hash(file_path.as_bytes()));

            Ok(Track {
                id,
                file_path,
                file_name,
                file_size_bytes: file_size,
                extension,
                metadata: TrackMetadata {
                    title,
                    artist,
                    album,
                    year,
                    genre,
                    track_number,
                    track_total,
                    comment,
                    lyrics: None,
                    is_synced_lyrics: false,
                    has_artwork,
                    artwork_mime,
                    artwork_base64: None,
                },
                properties: AudioProperties {
                    duration_seconds,
                    bitrate_kbps,
                    sample_rate_hz,
                    channels,
                },
                dirty: false,
            })
        }).ok()?;

        rows.next()?.ok()
    }

    /// Batch insert or update tracks in a single transaction for maximum speed
    pub fn save_batch(&self, items: &[(&Track, u64)]) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }

        let mut conn = self.connect()?;
        let tx = conn.transaction()?;

        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO track_cache (
                    file_path, file_name, file_size, mtime, extension,
                    title, artist, album, year, genre, track_number, track_total, comment,
                    has_artwork, artwork_mime, duration_seconds, bitrate_kbps, sample_rate_hz, channels
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                ON CONFLICT(file_path) DO UPDATE SET
                    file_name = excluded.file_name,
                    file_size = excluded.file_size,
                    mtime = excluded.mtime,
                    extension = excluded.extension,
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    year = excluded.year,
                    genre = excluded.genre,
                    track_number = excluded.track_number,
                    track_total = excluded.track_total,
                    comment = excluded.comment,
                    has_artwork = excluded.has_artwork,
                    artwork_mime = excluded.artwork_mime,
                    duration_seconds = excluded.duration_seconds,
                    bitrate_kbps = excluded.bitrate_kbps,
                    sample_rate_hz = excluded.sample_rate_hz,
                    channels = excluded.channels;",
            )?;

            for (track, mtime) in items {
                stmt.execute(params![
                    track.file_path,
                    track.file_name,
                    track.file_size_bytes as i64,
                    *mtime as i64,
                    track.extension,
                    track.metadata.title,
                    track.metadata.artist,
                    track.metadata.album,
                    track.metadata.year,
                    track.metadata.genre,
                    track.metadata.track_number,
                    track.metadata.track_total,
                    track.metadata.comment,
                    if track.metadata.has_artwork { 1 } else { 0 },
                    track.metadata.artwork_mime,
                    track.properties.duration_seconds as i64,
                    track.properties.bitrate_kbps,
                    track.properties.sample_rate_hz,
                    track.properties.channels,
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    /// Invalidate or update single track
    pub fn update_single(&self, track: &Track, mtime: u64) -> Result<()> {
        self.save_batch(&[(track, mtime)])
    }

    /// Remove a single file path from cache
    pub fn remove_path(&self, file_path: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM track_cache WHERE file_path = ?1", params![file_path])?;
        Ok(())
    }

    /// Remove multiple paths from cache in a single transaction
    pub fn remove_paths(&self, file_paths: &[String]) -> Result<()> {
        let mut conn = self.connect()?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached("DELETE FROM track_cache WHERE file_path = ?1")?;
            for p in file_paths {
                let _ = stmt.execute(params![p]);
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Paginated query directly from SQLite cache with optional folder and search filtering
    pub fn get_tracks_paged(
        &self,
        folder_prefix: Option<&str>,
        search_query: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<Track>, usize)> {
        let conn = self.connect()?;

        let mut where_conditions = Vec::new();
        let mut query_params: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(folder) = folder_prefix {
            if !folder.is_empty() {
                where_conditions.push("file_path LIKE ?".to_string());
                query_params.push(format!("{}%", folder).into());
            }
        }

        if let Some(query) = search_query {
            let q = query.trim();
            if !q.is_empty() {
                let pat = format!("%{}%", q);
                where_conditions.push(
                    "(title LIKE ? OR artist LIKE ? OR album LIKE ? OR file_name LIKE ? OR file_path LIKE ?)"
                        .to_string(),
                );
                query_params.push(pat.clone().into());
                query_params.push(pat.clone().into());
                query_params.push(pat.clone().into());
                query_params.push(pat.clone().into());
                query_params.push(pat.into());
            }
        }

        let where_clause = if where_conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_conditions.join(" AND "))
        };

        // 1. Total count query
        let count_sql = format!("SELECT COUNT(*) FROM track_cache {}", where_clause);
        let mut count_stmt = conn.prepare(&count_sql)?;
        let total_count: i64 = count_stmt.query_row(
            rusqlite::params_from_iter(query_params.iter()),
            |row| row.get(0),
        )?;

        // 2. Paginated rows query
        let rows_sql = format!(
            "SELECT file_path, file_name, file_size, mtime, extension,
                    title, artist, album, year, genre, track_number, track_total, comment,
                    has_artwork, artwork_mime, duration_seconds, bitrate_kbps, sample_rate_hz, channels
             FROM track_cache
             {}
             ORDER BY file_name COLLATE NOCASE ASC
             LIMIT ? OFFSET ?",
            where_clause
        );

        let mut paginated_params = query_params;
        paginated_params.push((limit as i64).into());
        paginated_params.push((offset as i64).into());

        let mut stmt = conn.prepare(&rows_sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(paginated_params.iter()), |row| {
            let file_path: String = row.get(0)?;
            let file_name: String = row.get(1)?;
            let file_size: u64 = row.get::<_, i64>(2)? as u64;
            let extension: String = row.get(4)?;

            let title: Option<String> = row.get(5)?;
            let artist: Option<String> = row.get(6)?;
            let album: Option<String> = row.get(7)?;
            let year: Option<u32> = row.get(8)?;
            let genre: Option<String> = row.get(9)?;
            let track_number: Option<u32> = row.get(10)?;
            let track_total: Option<u32> = row.get(11)?;
            let comment: Option<String> = row.get(12)?;
            let has_artwork: bool = row.get::<_, i64>(13)? != 0;
            let artwork_mime: Option<String> = row.get(14)?;

            let duration_seconds: u64 = row.get::<_, i64>(15)? as u64;
            let bitrate_kbps: Option<u32> = row.get(16)?;
            let sample_rate_hz: Option<u32> = row.get(17)?;
            let channels: Option<u8> = row.get(18)?;

            let id = format!("{:x}", crate::tags::md5_hash(file_path.as_bytes()));

            Ok(Track {
                id,
                file_path,
                file_name,
                file_size_bytes: file_size,
                extension,
                metadata: TrackMetadata {
                    title,
                    artist,
                    album,
                    year,
                    genre,
                    track_number,
                    track_total,
                    comment,
                    lyrics: None,
                    is_synced_lyrics: false,
                    has_artwork,
                    artwork_mime,
                    artwork_base64: None,
                },
                properties: AudioProperties {
                    duration_seconds,
                    bitrate_kbps,
                    sample_rate_hz,
                    channels,
                },
                dirty: false,
            })
        })?;

        let mut tracks = Vec::new();
        for r in rows {
            if let Ok(track) = r {
                tracks.push(track);
            }
        }

        Ok((tracks, total_count as usize))
    }
}

pub fn get_file_mtime_secs(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
