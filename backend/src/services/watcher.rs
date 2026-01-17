use crate::state::DbChangeEvent;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{error, info};

// ============================================================================
// FILE WATCHER
// ============================================================================
//
// This watches the iMessage database file for changes.
// When Messages.app receives or sends a message, it writes to chat.db.
// We detect this and notify all connected WebSocket clients.
//
// Key concepts:
// - FSEvents (macOS) / inotify (Linux) are kernel-level file monitoring APIs
// - The `notify` crate abstracts over platform-specific APIs
// - Debouncing batches rapid events (chat.db can change 20x for one message)
// ============================================================================

pub async fn start_file_watcher(
    db_path: &str,
    tx: broadcast::Sender<DbChangeEvent>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let messages_dir = std::path::Path::new(db_path).parent().unwrap().to_path_buf();
    let db_path_buf = std::path::PathBuf::from(db_path);

    info!(target: "watcher", "Watching for changes: {}", messages_dir.display());

    // Use a tokio mpsc channel to bridge blocking notify -> async world
    let (async_tx, mut async_rx) = tokio::sync::mpsc::channel::<()>(16);

    // Clone for the file watcher thread
    let async_tx_clone = async_tx.clone();

    // Spawn the blocking file watcher in a separate thread
    let watch_dir = messages_dir.clone();
    std::thread::spawn(move || {
        // Create a channel to receive debounced file events
        let (file_tx, file_rx) = std::sync::mpsc::channel();

        // Create a debouncer that waits 200ms after the last event before firing
        let mut debouncer = match new_debouncer(Duration::from_millis(200), file_tx) {
            Ok(d) => d,
            Err(e) => {
                error!(target: "watcher", "Failed to create debouncer: {}", e);
                return;
            }
        };

        // Watch the Messages directory
        if let Err(e) = debouncer.watcher().watch(&watch_dir, RecursiveMode::NonRecursive) {
            error!(target: "watcher", "Failed to watch directory: {}", e);
            return;
        }

        info!(target: "watcher", "File watcher thread started");

        // Process file events in a blocking loop
        loop {
            match file_rx.recv() {
                Ok(Ok(events)) => {
                    let db_changed = events
                        .iter()
                        .any(|event| event.path.to_string_lossy().contains("chat.db"));

                    if db_changed {
                        info!(target: "watcher", "FSEvents: Detected chat.db change");
                        let _ = async_tx_clone.blocking_send(());
                    }
                }
                Ok(Err(errors)) => {
                    error!(target: "watcher", "File watch errors: {:?}", errors);
                }
                Err(e) => {
                    error!(target: "watcher", "File watch channel error: {}", e);
                    break;
                }
            }
        }
    });

    // Also spawn a polling task as fallback (iMessage doesn't always trigger FSEvents)
    let poll_tx = async_tx.clone();
    let poll_db_path = db_path_buf.clone();
    tokio::spawn(async move {
        let mut last_modified = std::fs::metadata(&poll_db_path)
            .and_then(|m| m.modified())
            .ok();

        info!(
            target: "watcher",
            "Database poll fallback started (checks every 2 seconds)"
        );

        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;

            // Check if the WAL file was modified (more reliable than main db file)
            let wal_path = poll_db_path.with_extension("db-wal");
            let current_modified = std::fs::metadata(&wal_path)
                .and_then(|m| m.modified())
                .ok();

            if current_modified != last_modified {
                if last_modified.is_some() {
                    info!(
                        target: "watcher",
                        "Poll: Detected database change via modification time"
                    );
                    let _ = poll_tx.send(()).await;
                }
                last_modified = current_modified;
            }
        }
    });

    // Async loop: receive signals and broadcast to WebSocket clients
    while let Some(()) = async_rx.recv().await {
        let event = DbChangeEvent {
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        info!(
            target: "watcher",
            "Broadcasting db change to {} subscribers",
            tx.receiver_count()
        );

        let _ = tx.send(event);
    }

    Ok(())
}
