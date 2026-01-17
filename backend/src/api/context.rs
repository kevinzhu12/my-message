use crate::context_db::{BasicInfo, ContactContext, ContextDb};
use crate::extraction::{
    chunk_messages, create_context_from_extracted, extract_context, filter_useful_messages,
    merge_context, merge_notes_hierarchical_with_llm,
};
use crate::models::{
    AnalyzeContextRequest, AnalyzeContextResponse,
    UpdateContextRequest, UpdateNotesRequest,
};
use crate::openrouter::{OpenRouterClient};
use crate::services::messages::fetch_messages_for_extraction;
use crate::services::openrouter_config::{get_openrouter_api_key, get_openrouter_model};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use std::sync::Arc;
use tracing::error;

// Load a contact context by handle from the local context DB.
// Inputs: `handle` path param used as the lookup key.
// Output: 200 + context JSON when found; 404 when missing; 500 on DB errors.
pub async fn get_contact_context(Path(handle): Path<String>) -> impl IntoResponse {
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

    match context_db.get_context(&handle) {
        Ok(Some(context)) => (StatusCode::OK, Json(context)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Context not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to fetch context: {}", e)
            })),
        )
            .into_response(),
    }
}

// Replace the notes field for a contact context.
// Inputs: `handle` path param and JSON body with `notes` string.
// Output: 200 + ok flag on success; 500 on DB errors.
pub async fn update_contact_notes(
    Path(handle): Path<String>,
    Json(req): Json<UpdateNotesRequest>,
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

    if let Err(e) = context_db.update_notes(&handle, &req.notes) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to update notes: {}", e)
            })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}

// Upsert a full contact context with partial field updates.
// Inputs: `handle` path param plus optional display_name/basic_info/notes in JSON.
// Behavior: creates a new context when missing; updates only provided fields.
// Output: 200 + updated context JSON; 400 for empty handle; 500 on DB errors.
pub async fn update_contact_context(
    Path(handle): Path<String>,
    Json(req): Json<UpdateContextRequest>,
) -> impl IntoResponse {
    if handle.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "handle is required" })),
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

    let mut context = match context_db.get_context(&handle) {
        Ok(Some(existing)) => existing,
        Ok(None) => {
            let now = chrono::Utc::now().timestamp();
            ContactContext {
                handle: handle.clone(),
                display_name: req.display_name.clone(),
                basic_info: Default::default(),
                notes: None,
                last_analyzed_at: None,
                last_analyzed_message_id: None,
                created_at: now,
                updated_at: now,
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to load context: {}", e)
                })),
            )
                .into_response();
        }
    };

    if let Some(display_name) = req.display_name {
        context.display_name = Some(display_name);
    }

    if let Some(basic_info) = req.basic_info {
        context.basic_info = BasicInfo {
            birthday: basic_info.birthday,
            hometown: basic_info.hometown,
            work: basic_info.work,
            school: basic_info.school,
        };
    }

    if let Some(notes) = req.notes {
        context.notes = Some(notes);
    }

    if let Err(e) = context_db.save_context(&context) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to save context: {}", e)
            })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(context)).into_response()
}

// Run LLM-based context extraction from chat history and persist the result.
// Inputs: JSON with handle, chat_id, and optional display_name.
// Behavior: loads messages, filters/chunks them, calls OpenRouter for extraction,
// merges into existing context, optionally merges notes, then saves to DB.
// Output: 200 + AnalyzeContextResponse; 400 for invalid input or too few messages;
// 500 on DB, OpenRouter, or extraction failures.
pub async fn analyze_contact_context(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AnalyzeContextRequest>,
) -> impl IntoResponse {
    if req.handle.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "handle is required" })),
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

    let api_key = match get_openrouter_api_key(&context_db) {
        Ok(Some(key)) => key,
        Ok(None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "OpenRouter API key not configured" })),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to read API key: {}", e)
                })),
            )
                .into_response();
        }
    };

    let model = match get_openrouter_model(&context_db) {
        Ok(model) => model,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to read model: {}", e)
                })),
            )
                .into_response();
        }
    };

    let client = OpenRouterClient::with_model(api_key, model);

    let conn = match state.chat_pool.get() {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to open chat db: {}", e) })),
            )
                .into_response();
        }
    };

    let messages = match fetch_messages_for_extraction(&conn, req.chat_id) {
        Ok(msgs) => msgs,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to load messages: {}", e)
                })),
            )
                .into_response();
        }
    };

    let filtered = filter_useful_messages(messages);
    if filtered.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Not enough meaningful messages to analyze"
            })),
        )
            .into_response();
    }

    let chunks = chunk_messages(&filtered, 12000);
    let mut context = match context_db.get_context(&req.handle) {
        Ok(existing) => existing,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to load existing context: {}", e)
                })),
            )
                .into_response();
        }
    };

    let contact_name = req
        .display_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| req.handle.clone());

    let mut notes_for_merge = Vec::new();
    for chunk in chunks {
        match extract_context(&client, &contact_name, &chunk).await {
            Ok(extracted) => {
                if let Some(notes) = extracted.notes.as_ref() {
                    let trimmed = notes.trim();
                    if !trimmed.is_empty() {
                        notes_for_merge.push(trimmed.to_string());
                    }
                }
                if let Some(existing) = context.as_mut() {
                    merge_context(existing, extracted);
                } else {
                    context = Some(create_context_from_extracted(
                        &req.handle,
                        req.display_name.as_deref(),
                        extracted,
                        None,
                    ));
                }
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Extraction failed: {}", e) })),
                )
                    .into_response();
            }
        }
    }

    let mut context = match context {
        Some(ctx) => ctx,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "No context generated" })),
            )
                .into_response();
        }
    };

    if !notes_for_merge.is_empty() {
        match merge_notes_hierarchical_with_llm(&client, &contact_name, notes_for_merge).await {
            Ok(merged) => {
                if !merged.trim().is_empty() {
                    context.notes = Some(merged);
                }
            }
            Err(e) => {
                error!(
                    target: "context",
                    "Failed to hierarchically merge notes with LLM: {}",
                    e
                );
            }
        }
    }

    if context.display_name.is_none() {
        if let Some(display_name) = req.display_name.clone() {
            if !display_name.trim().is_empty() {
                context.display_name = Some(display_name);
            }
        }
    }

    if let Err(e) = context_db.save_context(&context) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to save context: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(AnalyzeContextResponse {
            ok: true,
            context: Some(context),
            error: None,
        }),
    )
        .into_response()
}

