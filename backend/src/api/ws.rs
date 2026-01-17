use crate::context_db::ContextDb;
use crate::services::messages::fetch_messages;
use crate::state::AppState;
use axum::{
    extract::{ws::WebSocket, ws::WebSocketUpgrade, State},
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use std::sync::{Arc, Mutex};
use tracing::{info, warn};

/// HTTP handler that upgrades the connection to WebSocket
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // This upgrades the HTTP connection to WebSocket
    // The `handle_socket` function will handle the actual WebSocket communication
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Handles an individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    // Split the WebSocket into sender and receiver halves
    // This allows us to send and receive concurrently
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to database change events
    // Each WebSocket connection gets its own receiver from the broadcast channel
    let mut db_rx = state.db_change_tx.subscribe();

    // Track which chat the client is subscribed to (if any)
    let subscribed_chat: Arc<Mutex<Option<i64>>> = Arc::new(Mutex::new(None));
    let subscribed_chat_clone = subscribed_chat.clone();

    // Clone state for the message sender task
    let state_clone = state.clone();

    // Spawn a task to handle incoming messages from the client
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let axum::extract::ws::Message::Text(text) = msg {
                // Parse the incoming message
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(msg_type) = parsed.get("type").and_then(|v| v.as_str()) {
                        match msg_type {
                            "subscribe" => {
                                // Client wants to subscribe to a specific chat
                                if let Some(chat_id) = parsed.get("chat_id").and_then(|v| v.as_i64()) {
                                    let mut guard = subscribed_chat_clone.lock().unwrap();
                                    *guard = Some(chat_id);
                                    info!(target: "ws", "Client subscribed to chat {}", chat_id);
                                }
                            }
                            "unsubscribe" => {
                                let mut guard = subscribed_chat_clone.lock().unwrap();
                                *guard = None;
                                info!(target: "ws", "Client unsubscribed from chat");
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    });

    info!(target: "ws", "WebSocket handler entering main loop");

    // Main loop: wait for database changes and send updates to client
    loop {
        tokio::select! {
            // When the database changes, fetch and send updated data
            result = db_rx.recv() => {
                info!(target: "ws", "Received event from broadcast channel");
                match result {
                    Ok(event) => {
                        // Get the subscribed chat ID (if any)
                        let chat_id = {
                            subscribed_chat.lock().unwrap().clone()
                        };

                        info!(target: "ws", "Processing db change, subscribed_chat = {:?}", chat_id);

                        // Build the update message
                        let update = if let Some(chat_id) = chat_id {
                            let chat_pool = state_clone.chat_pool.clone();

                            let fetch_result = tokio::task::spawn_blocking(move || {
                                let conn = chat_pool.get().map_err(|e| e.to_string())?;
                                let context_db = ContextDb::open().map_err(|e| e.to_string())?;
                                fetch_messages(
                                    &conn,
                                    chat_id,
                                    &context_db,
                                    50,
                                    0,
                                )
                                .map_err(|e| e.to_string())
                            })
                            .await;

                            match fetch_result {
                                Ok(Ok(messages_response)) => {
                                    info!(
                                        target: "ws",
                                        "Fetched {} messages for chat {}",
                                        messages_response.messages.len(),
                                        chat_id
                                    );
                                    serde_json::json!({
                                        "type": "messages_update",
                                        "chat_id": chat_id,
                                        "messages": messages_response.messages,
                                        "total": messages_response.total,
                                        "timestamp": event.timestamp,
                                    })
                                }
                                Ok(Err(e)) => {
                                    warn!(target: "ws", "Error fetching messages: {}", e);
                                    serde_json::json!({
                                        "type": "error",
                                        "message": format!("Failed to fetch messages: {}", e),
                                    })
                                }
                                Err(_) => {
                                    warn!(target: "ws", "Error fetching messages: join error");
                                    serde_json::json!({
                                        "type": "error",
                                        "message": "Failed to fetch messages".to_string(),
                                    })
                                }
                            }
                        } else {
                            info!(target: "ws", "No chat subscribed, sending db_changed");
                            // No specific chat subscribed, just send a generic update notification
                            serde_json::json!({
                                "type": "db_changed",
                                "timestamp": event.timestamp,
                            })
                        };

                        // Send the update to the client
                        info!(
                            target: "ws",
                            "Sending WebSocket message: type={}",
                            update.get("type").unwrap()
                        );
                        if sender.send(axum::extract::ws::Message::Text(update.to_string().into())).await.is_err() {
                            warn!(target: "ws", "Failed to send WebSocket message (client disconnected)");
                            // Client disconnected
                            break;
                        }
                        info!(target: "ws", "WebSocket message sent successfully");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // We missed some events (slow consumer)
                        warn!(target: "ws", "WebSocket client lagged, missed {} events", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        // Broadcast channel closed (shouldn't happen)
                        break;
                    }
                }
            }
            // If the receive task completes (client disconnected), exit
            _ = &mut recv_task => {
                break;
            }
        }
    }

    info!(target: "ws", "WebSocket client disconnected");
}
