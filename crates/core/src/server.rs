use std::net::SocketAddr;
use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};

use crate::models::ImportPayload;

pub const DEFAULT_SERVER_PORT: u16 = 8766;

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

/// Handler for GET /api/status
async fn status_handler() -> impl IntoResponse {
    Json(json!({
        "status": "running",
        "app": "LierTags",
        "version": "0.1.0",
        "port": DEFAULT_SERVER_PORT,
        "capabilities": ["track_metadata", "artwork", "lofty"]
    }))
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
        .route("/api/status", get(status_handler))
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
