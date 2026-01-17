use crate::context_db::ContextDb;
use crate::extraction::MessageForExtraction;
use crate::models::{SuggestRequest, SuggestResponse, SuggestedAction, SuggestedActionType};
use crate::openrouter::{ChatMessage, OpenRouterClient};
use crate::services::messages::{fetch_chats_by_ids, fetch_recent_messages_for_suggestion};
use crate::services::openrouter_config::get_openrouter_api_key;
use crate::state::{AppState, SUGGESTION_CACHE_TTL, SuggestionCacheEntry};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Instant;

const SUGGESTION_MODEL: &str = "deepseek/deepseek-v3.2";

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ModelSuggestion {
    Text { append: String },
    Action {
        action: SuggestedActionType,
        #[serde(default)]
        chat_search_term: Option<String>,
    },
    None,
}

enum SuggestionError {
    ContextDbOpen(String),
    ApiKeyMissing,
    ApiKeyRead(String),
    ChatDbOpen(String),
    LoadMessages(String),
    AiCompletion(String),
}

struct SuggestionContext {
    is_idle: bool,
    chat_display_name: String,
    conversation_context: String,
}

fn build_prompts(ctx: &SuggestionContext, partial_text: &str) -> (String, String) {
    let system_prompt_idle = r#"You suggest actions and text messages.
Output ONLY valid JSON. No markdown, no extra text.

Return exactly one of:
{"type":"text","append":"..."}
{"type":"action","action":"call"}
{"type":"action","action":"facetime"}
{"type":"action","action":"switch_chat","chat_search_term":"..."}
{"type":"none"}

Rules for text:
- append is your recommended text for the user to send.
- Text message style: casual, lowercase ok, no periods at the end
- Match the user's vibe from their "Me:" messages
- Do NOT repeat prior messages

Rules for actions:
- If no good suggestion, return {"type":"none"}
- If a user references another chat or person, suggest the switch chat option and include a keyword to search for.
  - The keyword will be used to search on contact names, and the first result will be suggested to the user.

Examples:
- User's current message: "" -> {"type":"text","append":" hey, what's up?"}
- User's last message: "call you in 5?" -> {"type":"action","action":"call"}
- User's last message: "let me check with mom rq" -> {"type":"action","action":"switch_chat","chat_search_term":"mom"}"#;

    let system_prompt_non_idle = r#"You autocomplete text messages.
Output ONLY valid JSON. No markdown, no extra text.

Return exactly one of:
{"type":"text","append":"..."}
{"type":"action","action":"send"}

Rules for text:
- append is the exact characters to add to the user's current text
- Maximum 2-5 words. Finish the phrase, not the whole message
- Text message style: casual, lowercase ok, no periods at the end
- Match the user's vibe from their "Me:" messages
- Do NOT repeat what they typed
- If starting a new word, begin with a single leading space
- If completing a word, do NOT add a space
- If the completion starts with punctuation or an apostrophe, do NOT add a space
- If the user typed nothing, suggest a short opener (2-5 words) without a leading space

Examples:
- User's current message: "want to grab" -> {"type":"text","append":" dinner later?"}
- User's current message: "running a bit lat" -> {"type":"text","append":"e"}
- User's current message: "ok sounds good" -> {"type":"action","action":"send"}"#;

    let system_prompt = if ctx.is_idle {
        system_prompt_idle
    } else {
        system_prompt_non_idle
    };

    let user_prompt = format!(
        "We are currently in a chat with {}\n\nRecent conversation:\n{}\n\nThe user is currently typing: \"{}\"\n\nReturn JSON only.",
        ctx.chat_display_name,
        ctx.conversation_context,
        partial_text
    );

    (system_prompt.to_string(), user_prompt)
}

fn build_conversation_context(recent_messages: &[MessageForExtraction]) -> String {
    let mut conversation_context = String::new();
    for msg in recent_messages {
        let sender = if msg.is_from_me { "Me" } else { "Them" };
        let trimmed = msg.text.trim();
        let truncated = if trimmed.chars().count() > 220 {
            let snippet: String = trimmed.chars().take(220).collect();
            format!("{}…", snippet)
        } else {
            trimmed.to_string()
        };
        conversation_context.push_str(&format!("{}: {}\n", sender, truncated));
    }
    conversation_context
}

async fn suggest_message_service(
    state: &Arc<AppState>,
    req: SuggestRequest,
) -> Result<SuggestResponse, SuggestionError> {
    let partial_text = req.partial_text.trim_end().to_string();

    // Open context DB for API key and contact context
    let context_db =
        ContextDb::open().map_err(|e| SuggestionError::ContextDbOpen(e.to_string()))?;

    // Get API key
    let api_key = match get_openrouter_api_key(&context_db) {
        Ok(Some(key)) => key,
        Ok(None) => {
            return Err(SuggestionError::ApiKeyMissing);
        }
        Err(e) => {
            return Err(SuggestionError::ApiKeyRead(e.to_string()));
        }
    };

    let suggestion_client =
        OpenRouterClient::with_model(api_key, SUGGESTION_MODEL.to_string());

    let cached_messages = {
        let cache = state.suggestion_cache.lock().ok();
        cache.and_then(|cache| {
            cache.get(&req.chat_id).and_then(|entry| {
                if entry.updated_at.elapsed() <= SUGGESTION_CACHE_TTL {
                    Some(entry.messages.clone())
                } else {
                    None
                }
            })
        })
    };

    let chat_display_name = match state.chat_pool.get() {
        Ok(conn) => fetch_chats_by_ids(
            &conn,
            &state.contact_resolve_tx,
            &context_db,
            &[req.chat_id],
        )
        .ok()
        .and_then(|resp| resp.chats.into_iter().next().map(|chat| chat.display_name))
        .and_then(|name| {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        Err(_) => None,
    }
    .unwrap_or_else(|| "Unknown chat".to_string());

    // Fetch recent messages for context (last 12)
    let recent_messages: Vec<MessageForExtraction> = match cached_messages {
        Some(messages) => messages,
        None => {
            let conn = state
                .chat_pool
                .get()
                .map_err(|e| SuggestionError::ChatDbOpen(e.to_string()))?;
            match fetch_recent_messages_for_suggestion(&conn, req.chat_id, 12) {
                Ok(msgs) => {
                    if let Ok(mut cache) = state.suggestion_cache.lock() {
                        cache.insert(
                            req.chat_id,
                            SuggestionCacheEntry {
                                messages: msgs.clone(),
                                updated_at: Instant::now(),
                            },
                        );
                    }
                    msgs
                }
                Err(e) => {
                    return Err(SuggestionError::LoadMessages(e.to_string()));
                }
            }
        }
    };

    let is_idle = partial_text.trim().is_empty();

    let conversation_context = build_conversation_context(&recent_messages);
    let suggestion_context = SuggestionContext {
        is_idle,
        chat_display_name,
        conversation_context,
    };
    let (system_prompt, user_prompt) = build_prompts(&suggestion_context, &partial_text);

    let chat_messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];

    let suggestion_result = suggestion_client
        .chat_completion(chat_messages, Some(50), Some(0.0))
        .await;

    match suggestion_result {
        Ok(suggestion) => {
            let clean_suggestion_text = |input: &str| {
                let mut cleaned = input.trim_end().to_string();
                if cleaned.starts_with('"') && cleaned.ends_with('"') && cleaned.len() >= 2 {
                    cleaned = cleaned[1..cleaned.len() - 1].to_string();
                }
                if cleaned.ends_with('.') {
                    cleaned.pop();
                }
                if cleaned.contains("<DONE>") {
                    if cleaned.trim() == "<DONE>" {
                        cleaned.clear();
                    } else {
                        cleaned = cleaned.replace("<DONE>", "");
                        cleaned = cleaned.trim_end().to_string();
                    }
                }
                cleaned
            };

            let parse_model_suggestion = |raw: &str| -> Option<ModelSuggestion> {
                let trimmed = raw.trim();
                let candidate = if trimmed.starts_with('{') && trimmed.ends_with('}') {
                    trimmed
                } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}'))
                {
                    if end > start {
                        &trimmed[start..=end]
                    } else {
                        return None;
                    }
                } else {
                    return None;
                };
                serde_json::from_str::<ModelSuggestion>(candidate).ok()
            };

            let mut cleaned_suggestion = String::new();
            let mut action: Option<SuggestedAction> = None;

            match parse_model_suggestion(&suggestion) {
                Some(ModelSuggestion::Text { append }) => {
                    cleaned_suggestion = clean_suggestion_text(&append);
                }
                Some(ModelSuggestion::Action {
                    action: action_type,
                    chat_search_term,
                }) => {
                    let is_valid = match action_type {
                        SuggestedActionType::Send => !is_idle,
                        SuggestedActionType::Call => req.can_call && is_idle,
                        SuggestedActionType::Facetime => req.can_facetime && is_idle,
                        SuggestedActionType::SwitchChat => {
                            is_idle
                                && chat_search_term
                                    .as_ref()
                                    .map(|term| !term.trim().is_empty())
                                    .unwrap_or(false)
                        }
                    };

                    if is_valid {
                        let action_search_term =
                            if matches!(action_type, SuggestedActionType::SwitchChat) {
                                chat_search_term
                            } else {
                                None
                            };
                        action = Some(SuggestedAction {
                            action: action_type,
                            chat_search_term: action_search_term,
                        });
                    }
                }
                Some(ModelSuggestion::None) => {}
                None => {
                    cleaned_suggestion = clean_suggestion_text(&suggestion);
                }
            }

            if cleaned_suggestion.trim().is_empty() {
                cleaned_suggestion.clear();
            }

            Ok(SuggestResponse {
                suggestion: cleaned_suggestion,
                action,
            })
        }
        Err(e) => Err(SuggestionError::AiCompletion(e.to_string())),
    }
}

fn map_suggestion_error(err: SuggestionError) -> (StatusCode, Json<serde_json::Value>) {
    match err {
        SuggestionError::ContextDbOpen(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to open context db: {}", message)
            })),
        ),
        SuggestionError::ApiKeyMissing => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "OpenRouter API key not configured" })),
        ),
        SuggestionError::ApiKeyRead(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to read API key: {}", message)
            })),
        ),
        SuggestionError::ChatDbOpen(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to open chat db: {}", message)
            })),
        ),
        SuggestionError::LoadMessages(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to load messages: {}", message)
            })),
        ),
        SuggestionError::AiCompletion(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("AI completion failed: {}", message)
            })),
        ),
    }
}

/// Suggest message completion using AI
pub async fn suggest_message(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SuggestRequest>,
) -> impl IntoResponse {
    match suggest_message_service(&state, req).await {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(err) => {
            let (status, payload) = map_suggestion_error(err);
            (status, payload).into_response()
        }
    }
}
