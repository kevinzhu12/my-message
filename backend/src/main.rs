mod api;
mod context_db;
mod extraction;
mod models;
mod openrouter;
mod services;
mod state;

use api::{ai, chats, context, media, messages, suggestions, ws};
use openrouter::OpenRouterClient;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::OpenFlags;
use services::{contacts::contact_resolve_worker, watcher::start_file_watcher};
use state::{AppState, DbChangeEvent};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tower_http::cors::CorsLayer;
use tracing::{error, info};

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    // Initialize tracing subscriber for logging
    // Use RUST_LOG env var to control log levels, e.g.:
    //   RUST_LOG=openrouter=debug  (full request/response bodies)
    //   RUST_LOG=server=info,ws=info,watcher=info
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("openrouter=info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
    let db_path = format!(
        "{}/Library/Messages/chat.db",
        std::env::var("HOME").expect("HOME not set")
    );

    // Create a broadcast channel for database change notifications
    // Capacity of 16 means we can buffer 16 events before slow receivers are dropped
    let (db_change_tx, _rx) = broadcast::channel::<DbChangeEvent>(16);

    let (contact_resolve_tx, contact_resolve_rx) = mpsc::channel::<String>(256);
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .expect("Failed to create HTTP client");
    let chat_manager =
        SqliteConnectionManager::file(&db_path).with_flags(OpenFlags::SQLITE_OPEN_READ_ONLY);
    let chat_pool = Pool::builder()
        .max_size(4)
        .build(chat_manager)
        .expect("Failed to create chat.db pool");

    let assist_client_primary = OpenRouterClient::with_shared_client(
        String::new(),
        "anthropic/claude-opus-4.5".to_string(),
        http_client.clone(),
    );
    let assist_client_fallback = OpenRouterClient::with_shared_client(
        String::new(),
        "anthropic/claude-3.5-sonnet".to_string(),
        http_client,
    );

    let state = AppState {
        chat_pool,
        contact_resolve_tx: contact_resolve_tx.clone(),
        suggestion_cache: Arc::new(Mutex::new(std::collections::HashMap::new())),
        assist_client_primary,
        assist_client_fallback,
        db_change_tx: db_change_tx.clone(),
    };

    // Background worker to resolve contact names without blocking requests
    let resolve_tx = db_change_tx.clone();
    tokio::spawn(async move {
        contact_resolve_worker(contact_resolve_rx, resolve_tx).await;
    });

    // Start the file watcher in a background task
    let watch_path = db_path.clone();
    let watch_tx = db_change_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = start_file_watcher(&watch_path, watch_tx).await {
            error!(target: "watcher", "File watcher error: {}", e);
        }
    });

    let suggestion_cache = state.suggestion_cache.clone();
    let mut suggestion_cache_rx = db_change_tx.subscribe();
    tokio::spawn(async move {
        while let Ok(_event) = suggestion_cache_rx.recv().await {
            if let Ok(mut cache) = suggestion_cache.lock() {
                cache.clear();
            }
        }
    });

    let app = axum::Router::new()
        .route("/health", axum::routing::get(chats::health))
        .route("/chats", axum::routing::get(chats::get_chats))
        .route("/chats/by-ids", axum::routing::post(chats::get_chats_by_ids))
        .route("/chats/search", axum::routing::get(chats::search_chats))
        .route("/chats/:id/messages", axum::routing::get(chats::get_messages))
        .route("/contacts/:handle/photo", axum::routing::get(media::get_contact_photo))
        .route("/draft", axum::routing::post(messages::draft_message))
        .route("/send", axum::routing::post(messages::send_message))
        .route("/send-attachment", axum::routing::post(messages::send_attachment))
        .route("/attachments/:id", axum::routing::get(media::get_attachment))
        .route(
            "/context/:handle",
            axum::routing::get(context::get_contact_context)
                .put(context::update_contact_context),
        )
        .route(
            "/context/:handle/notes",
            axum::routing::put(context::update_contact_notes),
        )
        .route("/context/analyze", axum::routing::post(context::analyze_contact_context))
        .route(
            "/api/suggest",
            axum::routing::post(suggestions::suggest_message),
        )
        .route(
            "/api/assist/stream",
            axum::routing::post(ai::assist_message_stream),
        )
        .route("/ws", axum::routing::get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(Arc::new(state));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3883")
        .await
        .expect("Failed to bind to port 3883");

    info!(target: "server", "Server running on http://127.0.0.1:3883");
    info!(target: "server", "WebSocket available at ws://127.0.0.1:3883/ws");
    info!(target: "server", "Using database: {}", db_path);

    axum::serve(listener, app)
        .await
        .expect("Failed to start server");
}
