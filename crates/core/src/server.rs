use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::State,
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use serde_json::json;
use std::net::SocketAddr;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};

use crate::models::ImportPayload;

pub const DEFAULT_SERVER_PORT: u16 = 8766;

#[derive(Debug, serde::Deserialize)]
struct OstFromLierkourRequest {
    title: String,
    #[serde(default)]
    original_title: Option<String>,
    #[serde(default)]
    creator: Option<String>,
    #[serde(default)]
    year: Option<u32>,
    #[serde(default)]
    genres: Option<String>,
    #[serde(default)]
    artwork_url: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
}

/// Shared state for Axum import server
#[derive(Clone)]
pub struct ServerState {
    pub import_tx: broadcast::Sender<ImportPayload>,
}

/// Handler for POST /api/import (called by LierEX-Q extension)
async fn import_handler(
    State(state): State<ServerState>,
    Json(payload): Json<ImportPayload>,
) -> impl IntoResponse {
    // Validate type: LierTags only accepts 'track'
    if payload.item_type != "track" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": format!("Unsupported item type '{}'. LierTags only accepts 'track'.", payload.item_type)
            })),
        );
    }

    // Broadcast the imported payload to active listeners (UI / Tauri event emitter)
    let _ = state.import_tx.send(payload.clone());

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": format!("Track '{}' received by LierTags", payload.title),
            "title": payload.title
        })),
    )
}

/// Handler for GET /api/status & GET /api/lier/info
async fn status_handler() -> impl IntoResponse {
    Json(json!({
        "ecosystem": "LIER",
        "status": "running",
        "app": "LierTags",
        "version": env!("CARGO_PKG_VERSION"),
        "port": DEFAULT_SERVER_PORT,
        "platform": std::env::consts::OS,
        "license": "GPL-3.0-only",
        "capabilities": ["track_metadata", "artwork", "lyrics", "ost_import", "lofty"]
    }))
}

/// Handler for POST /api/ost/from-lierkour (bridges film/game OST metadata from Lierkour)
async fn ost_from_lierkour_handler(
    State(state): State<ServerState>,
    Json(req): Json<OstFromLierkourRequest>,
) -> impl IntoResponse {
    let album_name = req
        .original_title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("{} OST", req.title.trim()));
    let payload = ImportPayload {
        item_type: "track".to_string(),
        title: req.title.trim().to_string(),
        artist: req.creator,
        album: Some(album_name),
        year: req.year,
        genre: req.genres,
        artwork_url: req.artwork_url,
        source_url: req.source_url,
        track_number: None,
        comment: Some("Imported from Lierkour OST".to_string()),
    };
    let _ = state.import_tx.send(payload);
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": format!("OST '{}' forwarded to LierTags", req.title)
        })),
    )
}

/// Start the Axum HTTP server on 127.0.0.1:port
pub async fn start_import_server(
    port: u16,
    import_tx: broadcast::Sender<ImportPayload>,
) -> Result<()> {
    let state = ServerState { import_tx };

    // Set up CORS to permit browser extensions (chrome-extension://*) and local UI
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/import", post(import_handler))
        .route("/api/ost/from-lierkour", post(ost_from_lierkour_handler))
        .route("/api/status", get(status_handler))
        .route("/api/lier/info", get(status_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Failed to bind LierTags server to {}", addr))?;

    println!(">>> LierTags HTTP server listening on http://{}", addr);

    axum::serve(listener, app)
        .await
        .context("LierTags Axum server error")?;

    Ok(())
}
