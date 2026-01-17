use crate::models::{DraftRequest, DraftResponse, SendAttachmentRequest, SendRequest, SendResponse};
use crate::services::applescript::{
    send_attachment_to_group_via_applescript, send_attachment_via_applescript,
    send_to_group_via_applescript, send_via_applescript,
};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json},
};

pub async fn draft_message(
    axum::extract::State(_state): axum::extract::State<std::sync::Arc<crate::state::AppState>>,
    Json(req): Json<DraftRequest>,
) -> impl IntoResponse {
    // Stub implementation - simple heuristic reply
    let draft_text = format!(
        "Thanks for your message! (Auto-generated reply for chat {})",
        req.chat_id
    );
    (StatusCode::OK, Json(DraftResponse { draft_text })).into_response()
}

pub async fn send_message(
    axum::extract::State(_state): axum::extract::State<std::sync::Arc<crate::state::AppState>>,
    Json(req): Json<SendRequest>,
) -> impl IntoResponse {
    let result = if req.is_group {
        if let Some(chat_id) = &req.chat_identifier {
            send_to_group_via_applescript(chat_id, &req.text)
        } else {
            Err("chat_identifier required for group messages".into())
        }
    } else {
        send_via_applescript(&req.handle, &req.text)
    };

    match result {
        Ok(_) => (StatusCode::OK, Json(SendResponse { ok: true, error: None })).into_response(),
        Err(e) => {
            let error_msg = format!(
                "Failed to send message: {}. Make sure Automation permission is granted for Messages.app",
                e
            );
            (
                StatusCode::OK,
                Json(SendResponse {
                    ok: false,
                    error: Some(error_msg),
                }),
            )
                .into_response()
        }
    }
}

pub async fn send_attachment(
    axum::extract::State(_state): axum::extract::State<std::sync::Arc<crate::state::AppState>>,
    Json(req): Json<SendAttachmentRequest>,
) -> impl IntoResponse {
    // First send the attachment
    let attachment_result = if req.is_group {
        if let Some(chat_id) = &req.chat_identifier {
            send_attachment_to_group_via_applescript(chat_id, &req.file_path)
        } else {
            Err("chat_identifier required for group messages".into())
        }
    } else {
        send_attachment_via_applescript(&req.handle, &req.file_path)
    };

    match attachment_result {
        Ok(_) => {
            // If there's also text, send it as a follow-up message
            if let Some(text) = &req.text {
                if !text.trim().is_empty() {
                    let text_result = if req.is_group {
                        if let Some(chat_id) = &req.chat_identifier {
                            send_to_group_via_applescript(chat_id, text)
                        } else {
                            Err("chat_identifier required for group messages".into())
                        }
                    } else {
                        send_via_applescript(&req.handle, text)
                    };
                    if let Err(e) = text_result {
                        let error_msg = format!("Attachment sent but failed to send text: {}", e);
                        return (
                            StatusCode::OK,
                            Json(SendResponse {
                                ok: true,
                                error: Some(error_msg),
                            }),
                        )
                            .into_response();
                    }
                }
            }
            (StatusCode::OK, Json(SendResponse { ok: true, error: None })).into_response()
        }
        Err(e) => {
            let error_msg = format!(
                "Failed to send attachment: {}. Make sure Automation permission is granted for Messages.app",
                e
            );
            (
                StatusCode::OK,
                Json(SendResponse {
                    ok: false,
                    error: Some(error_msg),
                }),
            )
                .into_response()
        }
    }
}

