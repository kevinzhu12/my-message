use crate::services::contacts::fetch_contact_photo;
use crate::services::messages::fetch_attachment_file;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use std::sync::Arc;

pub async fn get_contact_photo(Path(handle): Path<String>) -> impl IntoResponse {
    // URL decode the handle (it may contain + signs encoded as %2B)
    let handle = urlencoding::decode(&handle)
        .unwrap_or(std::borrow::Cow::Borrowed(&handle))
        .to_string();

    let handle_clone = handle.clone();
    let result = tokio::task::spawn_blocking(move || fetch_contact_photo(&handle_clone)).await;

    match result {
        Ok(Ok(Some(photo_data))) => (
            StatusCode::OK,
            [("Content-Type", "image/jpeg"), ("Cache-Control", "max-age=3600")],
            photo_data,
        )
            .into_response(),
        Ok(Ok(None)) => (StatusCode::NOT_FOUND, "No photo found").into_response(),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch photo").into_response(),
    }
}

pub async fn get_attachment(
    State(state): State<Arc<AppState>>,
    Path(attachment_id): Path<i64>,
) -> impl IntoResponse {
    let conn = match state.chat_pool.get() {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open chat db: {}", e),
            )
                .into_response();
        }
    };

    match fetch_attachment_file(&conn, attachment_id) {
        Ok(Some((data, mime_type))) => {
            let content_type = mime_type.unwrap_or_else(|| "application/octet-stream".to_string());
            (
                StatusCode::OK,
                [
                    ("Content-Type", content_type.as_str()),
                    ("Cache-Control", "max-age=86400"),
                ],
                data,
            )
                .into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Attachment not found").into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch attachment: {}", e),
        )
            .into_response(),
    }
}
