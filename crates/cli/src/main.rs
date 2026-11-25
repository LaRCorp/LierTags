use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use liertags_core::models::{ImportPayload, SaveTrackPayload};
use liertags_core::tags::{read_track, save_track, scan_folder};
use std::fs;
use std::path::PathBuf;
use tokio::sync::broadcast;

#[derive(Parser)]
#[command(name = "liertags-cli")]
#[command(about = "LierTags CLI prototype: tag editor and test runner", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Read and display metadata from an audio file
    Read {
        /// Path to audio file (MP3, FLAC, OGG, M4A, etc.)
        file: PathBuf,
    },
    /// Write metadata fields to an audio file
    Write {
        /// Path to audio file
        file: PathBuf,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        artist: Option<String>,
        #[arg(long)]
        album: Option<String>,
        #[arg(long)]
        year: Option<u32>,
        #[arg(long)]
        genre: Option<String>,
        #[arg(long)]
        track: Option<u32>,
        #[arg(long)]
        comment: Option<String>,
        #[arg(long)]
        artwork: Option<PathBuf>,
    },
    /// Import metadata from a LierEX JSON file and apply to track
    ImportJson {
        /// Path to audio file to update
        file: PathBuf,
        /// Path to JSON file containing ImportPayload
        json_file: PathBuf,
    },
    /// Scan a folder for audio files and output list
    Scan {
        /// Folder path to scan
        folder: PathBuf,
        #[arg(short, long)]
        recursive: bool,
    },
    /// Run the standalone local HTTP server (port 8766) to test extension import
    Serve {
        #[arg(short, long, default_value_t = 8766)]
        port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Read { file } => {
            println!("Reading metadata from: {}", file.display());
            let track = read_track(&file)?;
            println!("{}", serde_json::to_string_pretty(&track)?);
        }
        Commands::Write {
            file,
            title,
            artist,
            album,
            year,
            genre,
            track,
            comment,
            artwork,
        } => {
            println!("Writing metadata to: {}", file.display());

            let mut artwork_b64 = None;
            if let Some(art_path) = artwork {
                let bytes = fs::read(&art_path).with_context(|| {
                    format!("Failed to read artwork file: {}", art_path.display())
                })?;
                let b64 =
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                artwork_b64 = Some(b64);
            }

            let payload = SaveTrackPayload {
                file_path: file.to_string_lossy().to_string(),
                title,
                artist,
                album,
                year,
                genre,
                track_number: track,
                track_total: None,
                comment,
                lyrics: None,
                save_lrc_file: false,
                new_artwork_base64: artwork_b64,
                remove_artwork: false,
            };

            let updated = save_track(&payload)?;
            println!("Successfully updated tags!");
            println!("Title: {:?}", updated.metadata.title);
            println!("Artist: {:?}", updated.metadata.artist);
            println!("Album: {:?}", updated.metadata.album);
            println!("Year: {:?}", updated.metadata.year);
        }
        Commands::ImportJson { file, json_file } => {
            let json_str = fs::read_to_string(&json_file)
                .with_context(|| format!("Failed to read JSON file: {}", json_file.display()))?;
            let import_data: ImportPayload = serde_json::from_str(&json_str)
                .context("Failed to deserialize ImportPayload from JSON")?;

            println!("Loaded import payload:");
            println!("Title: {}", import_data.title);
            println!("Artist: {:?}", import_data.artist);
            println!("Album: {:?}", import_data.album);

            let payload = SaveTrackPayload {
                file_path: file.to_string_lossy().to_string(),
                title: Some(import_data.title),
                artist: import_data.artist,
                album: import_data.album,
                year: import_data.year,
                genre: import_data.genre,
                track_number: import_data.track_number,
                track_total: None,
                comment: import_data.comment,
                lyrics: None,
                save_lrc_file: false,
                new_artwork_base64: None,
                remove_artwork: false,
            };

            let updated = save_track(&payload)?;
            println!("Import applied successfully to: {}", updated.file_path);
        }
        Commands::Scan { folder, recursive } => {
            println!(
                "Scanning directory: {} (recursive: {})",
                folder.display(),
                recursive
            );
            let tracks = scan_folder(&folder, recursive)?;
            println!("Found {} supported audio tracks:", tracks.len());
            for (idx, t) in tracks.iter().enumerate() {
                println!(
                    "[{:>3}] {} - {} ({}) [{} kbps, {}s]",
                    idx + 1,
                    t.metadata.artist.as_deref().unwrap_or("<Unknown Artist>"),
                    t.metadata.title.as_deref().unwrap_or(&t.file_name),
                    t.extension.to_uppercase(),
                    t.properties.bitrate_kbps.unwrap_or(0),
                    t.properties.duration_seconds
                );
            }
        }
        Commands::Serve { port } => {
            let (tx, mut rx) = broadcast::channel::<ImportPayload>(32);

            tokio::spawn(async move {
                while let Ok(imported) = rx.recv().await {
                    println!("\n[LierEX Import Event Received!]");
                    println!("Title: {}", imported.title);
                    if let Some(ref a) = imported.artist {
                        println!("Artist: {}", a);
                    }
                    if let Some(ref alb) = imported.album {
                        println!("Album: {}", alb);
                    }
                    if let Some(y) = imported.year {
                        println!("Year: {}", y);
                    }
                    if let Some(ref art) = imported.artwork_url {
                        println!("Artwork URL: {}", art);
                    }
                    println!("-----------------------------------");
                }
            });

            liertags_core::server::start_import_server(port, tx).await?;
        }
    }

    Ok(())
}
