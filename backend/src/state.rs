use crate::extraction::MessageForExtraction;
use crate::openrouter::OpenRouterClient;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

pub type SuggestionCache = Arc<Mutex<HashMap<i64, SuggestionCacheEntry>>>;

/// Event sent to all connected WebSocket clients when the database changes
#[derive(Clone, Debug, Serialize)]
pub struct DbChangeEvent {
    /// Timestamp when the change was detected (Unix ms)
    pub timestamp: i64,
}

#[derive(Clone)]
pub struct AppState {
    pub chat_pool: Pool<SqliteConnectionManager>,
    pub contact_resolve_tx: mpsc::Sender<String>,
    pub suggestion_cache: SuggestionCache,
    pub assist_client_primary: OpenRouterClient,
    pub assist_client_fallback: OpenRouterClient,
    /// Broadcast channel to notify WebSocket clients of database changes
    /// When chat.db changes, we send an event through this channel
    pub db_change_tx: broadcast::Sender<DbChangeEvent>,
}

pub struct SuggestionCacheEntry {
    pub messages: Vec<MessageForExtraction>,
    pub updated_at: Instant,
}

pub const SUGGESTION_CACHE_TTL: Duration = Duration::from_secs(30);
