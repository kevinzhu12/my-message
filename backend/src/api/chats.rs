use crate::context_db::ContextDb;
use crate::models::{
    ChatsByIdsRequest, ChatsByIdsResponse, PaginationParams, SearchChatsResponse, SearchParams,
};
use crate::services::messages::{fetch_chats, fetch_chats_by_ids, fetch_messages, fetch_search_chats};
use crate::state::AppState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use std::sync::Arc;

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok"}))
}

pub async fn get_chats(
    State(state): State<Arc<AppState>>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    let context_db = match ContextDb::open() {
        Ok(db) => db,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open context db: {}", e)
                })),
            )
                .into_response();
        }
    };

    let conn = match state.chat_pool.get() {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open chat db: {}", e)
                })),
            )
                .into_response();
        }
    };

    match fetch_chats(
        &conn,
        &state.contact_resolve_tx,
        &context_db,
        params.limit,
        params.offset,
    ) {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(e) => {
            let error_msg = format!(
                "Failed to fetch chats: {}. Make sure Full Disk Access is granted.",
                e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": error_msg})),
            )
                .into_response()
        }
    }
}

pub async fn get_chats_by_ids(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ChatsByIdsRequest>,
) -> impl IntoResponse {
    if request.ids.is_empty() {
        return (StatusCode::OK, Json(ChatsByIdsResponse { chats: vec![] })).into_response();
    }

    let context_db = match ContextDb::open() {
        Ok(db) => db,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open context db: {}", e)
                })),
            )
                .into_response();
        }
    };

    let conn = match state.chat_pool.get() {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open chat db: {}", e)
                })),
            )
                .into_response();
        }
    };

    match fetch_chats_by_ids(
        &conn,
        &state.contact_resolve_tx,
        &context_db,
        &request.ids,
    ) {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(e) => {
            let error_msg = format!("Failed to fetch chats by ids: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": error_msg})),
            )
                .into_response()
        }
    }
}

pub async fn search_chats(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    // Don't search if query is too short
    if params.q.trim().len() < 1 {
        return (
            StatusCode::OK,
            Json(SearchChatsResponse {
                chats: vec![],
                query: params.q,
            }),
        )
            .into_response();
    }

    let context_db = match ContextDb::open() {
        Ok(db) => db,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open context db: {}", e)
                })),
            )
                .into_response();
        }
    };

    let conn = match state.chat_pool.get() {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open chat db: {}", e)
                })),
            )
                .into_response();
        }
    };

    match fetch_search_chats(
        &conn,
        &context_db,
        &params.q,
        params.limit,
    ) {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(e) => {
            let error_msg = format!("Failed to search chats: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": error_msg})),
            )
                .into_response()
        }
    }
}

pub async fn get_messages(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(chat_id): axum::extract::Path<i64>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    let chat_pool = state.chat_pool.clone();
    let limit = params.limit;
    let offset = params.offset;

    let result = tokio::task::spawn_blocking(move || {
        let conn = chat_pool.get().map_err(|e| e.to_string())?;
        let context_db = ContextDb::open().map_err(|e| e.to_string())?;
        fetch_messages(
            &conn,
            chat_id,
            &context_db,
            limit,
            offset,
        )
        .map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(response)) => (StatusCode::OK, Json(response)).into_response(),
        Ok(Err(error_msg)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to fetch messages: {}", error_msg)
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to fetch messages"})),
        )
            .into_response(),
    }
}
