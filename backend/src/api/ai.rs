use crate::context_db::ContextDb;
use crate::models::AssistRequest;
use crate::openrouter::{ChatMessage, OpenRouterClient};
use crate::services::messages::fetch_recent_messages_for_suggestion;
use crate::services::openrouter_config::get_openrouter_api_key;
use crate::state::AppState;
use async_stream::stream;
use futures::StreamExt;
use axum::{
    extract::State,
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json,
    },
};
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tracing::error;

#[derive(Deserialize)]
struct AssistOptionsResponse {
    options: Vec<String>,
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) else {
        return None;
    };
    if end > start {
        Some(&trimmed[start..=end])
    } else {
        None
    }
}

fn parse_assist_options_response(raw: &str) -> Option<AssistOptionsResponse> {
    let candidate = extract_json_object(raw)?;
    serde_json::from_str::<AssistOptionsResponse>(candidate).ok()
}

fn parse_draft_mode_response(raw: &str) -> Option<bool> {
    fn parse_boolish(value: &str) -> Option<bool> {
        match value.trim().to_ascii_lowercase().as_str() {
            "true" | "yes" | "y" | "draft" | "drafts" | "options" => Some(true),
            "false" | "no" | "n" | "no_draft" | "nodraft" | "none" => Some(false),
            _ => None,
        }
    }

    if let Some(candidate) = extract_json_object(raw) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) {
            if let Some(obj) = value.as_object() {
                for key in ["draft", "draft_mode", "mode"] {
                    if let Some(value) = obj.get(key) {
                        if let Some(parsed) = match value {
                            serde_json::Value::Bool(flag) => Some(*flag),
                            serde_json::Value::String(text) => parse_boolish(text),
                            _ => None,
                        } {
                            return Some(parsed);
                        }
                    }
                }
            }
        }
    }

    parse_boolish(raw)
}

async fn classify_draft_mode(
    primary_client: &OpenRouterClient,
    fallback_client: &OpenRouterClient,
    prompt: &str,
) -> Option<bool> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Some(false);
    }

    let system_prompt = r#"You decide if a user is asking for draft message options.
Return ONLY valid JSON: {"draft": true} or {"draft": false}.
Return true if the user asks for reply ideas, draft replies, options, or what to say/send.
Return false if they want analysis, explanation, or general advice without drafting."#;
    let user_prompt = format!("User request:\n{}\n\nReturn JSON only.", trimmed);

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];
    let max_tokens = Some(20);
    let temperature = Some(0.0);

    let result = match primary_client
        .chat_completion(messages.clone(), max_tokens, temperature)
        .await
    {
        Ok(content) => Ok(content),
        Err(e) => {
            error!(target: "ai", "Primary draft mode check failed: {}", e);
            fallback_client
                .chat_completion(messages, max_tokens, temperature)
                .await
        }
    };

    match result {
        Ok(content) => parse_draft_mode_response(&content),
        Err(e) => {
            error!(target: "ai", "Draft mode check failed: {}", e);
            None
        }
    }
}

fn wants_draft_options_fallback(prompt: &str) -> bool {
    let text = prompt.trim().to_lowercase();
    if text.is_empty() {
        return false;
    }
    let phrases = [
        "what should i say",
        "what should i say back",
        "what should i send",
        "what do i say",
        "what do i say back",
        "what do i send",
        "what should i reply",
        "what should i respond",
        "how should i reply",
        "how should i respond",
        "how do i reply",
        "how do i respond",
        "what would you say",
        "what would you reply",
        "draft a reply",
        "draft a response",
        "draft reply",
        "draft response",
        "draft some replies",
        "draft some responses",
        "reply options",
        "response options",
        "message options",
        "text options",
        "give me options",
        "give me some options",
        "give me a few options",
        "give me ideas",
        "give me some ideas",
        "give me a few ideas",
        "any suggestions",
        "any ideas",
        "suggest a reply",
        "suggest a response",
        "suggest some replies",
        "suggest some responses",
        "help me reply",
        "help me respond",
        "help me write",
        "help me draft",
        "write a reply",
        "write a response",
        "compose a reply",
        "compose a response",
    ];
    if phrases.iter().any(|phrase| text.contains(phrase)) {
        return true;
    }
    let wants_options = text.contains("option") || text.contains("options");
    let wants_suggest = text.contains("suggest") || text.contains("suggestion");
    let wants_ideas = text.contains("idea") || text.contains("ideas");
    let wants_draft = text.contains("draft") || text.contains("compose");
    let mention_reply = text.contains("reply")
        || text.contains("response")
        || text.contains("message")
        || text.contains("text")
        || text.contains("say")
        || text.contains("send");

    (wants_options || wants_suggest || wants_ideas || wants_draft) && mention_reply
}

pub async fn assist_message_stream(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AssistRequest>,
) -> impl IntoResponse {
    if req.prompt.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Prompt is required" })),
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
                Json(serde_json::json!({ "error": format!("Failed to read API key: {}", e) })),
            )
                .into_response();
        }
    };

    let primary_client = state
        .assist_client_primary
        .clone()
        .with_api_key(api_key.clone());
    let fallback_client = state
        .assist_client_fallback
        .clone()
        .with_api_key(api_key);

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
    let recent_messages = match fetch_recent_messages_for_suggestion(&conn, req.chat_id, 12) {
        Ok(msgs) => msgs,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to load messages: {}", e) })),
            )
                .into_response();
        }
    };

    let mut conversation_context = String::new();
    for msg in &recent_messages {
        let sender = if msg.is_from_me { "Me" } else { "Them" };
        let trimmed = msg.text.trim();
        let truncated = if trimmed.chars().count() > 280 {
            let snippet: String = trimmed.chars().take(280).collect();
            format!("{}...", snippet)
        } else {
            trimmed.to_string()
        };
        if !truncated.is_empty() {
            conversation_context.push_str(&format!("{}: {}\n", sender, truncated));
        }
    }
    if conversation_context.trim().is_empty() {
        conversation_context = "No recent messages.".to_string();
    }

    let handle = req.handle.as_ref().map(|h| h.trim().to_string()).unwrap_or_default();
    let mut display_name = req
        .display_name
        .as_ref()
        .map(|name| name.trim().to_string())
        .unwrap_or_default();

    let mut context_lines = Vec::new();
    let mut context_data: Option<crate::context_db::ContactContext> = None;
    if !handle.is_empty() {
        if let Ok(ctx) = context_db.get_context(&handle) {
            context_data = ctx;
        }
    }

    if display_name.is_empty() {
        if let Some(ctx) = context_data.as_ref() {
            if let Some(name) = ctx.display_name.as_ref() {
                if !name.trim().is_empty() {
                    display_name = name.trim().to_string();
                }
            }
        }
    }

    if !display_name.is_empty() {
        context_lines.push(format!("Name: {}", display_name));
    }
    if !handle.is_empty() {
        context_lines.push(format!("Handle: {}", handle));
    }

    if let Some(ctx) = context_data.as_ref() {
        let mut basic_parts = Vec::new();
        if let Some(birthday) = ctx.basic_info.birthday.as_ref().filter(|v| !v.trim().is_empty())
        {
            basic_parts.push(format!("birthday: {}", birthday.trim()));
        }
        if let Some(hometown) = ctx.basic_info.hometown.as_ref().filter(|v| !v.trim().is_empty())
        {
            basic_parts.push(format!("hometown: {}", hometown.trim()));
        }
        if let Some(work) = ctx.basic_info.work.as_ref().filter(|v| !v.trim().is_empty()) {
            basic_parts.push(format!("work: {}", work.trim()));
        }
        if let Some(school) = ctx.basic_info.school.as_ref().filter(|v| !v.trim().is_empty()) {
            basic_parts.push(format!("school: {}", school.trim()));
        }
        if !basic_parts.is_empty() {
            context_lines.push(format!("Basic info: {}", basic_parts.join(", ")));
        }
        if let Some(notes) = ctx.notes.as_ref().filter(|v| !v.trim().is_empty()) {
            context_lines.push(format!("Notes: {}", notes.trim()));
        }
    }

    let contact_context = if context_lines.is_empty() {
        "None".to_string()
    } else {
        context_lines.join("\n")
    };

    let mut assistant_history_lines = Vec::new();
    for entry in req.history.iter() {
        let prompt = entry.prompt.trim();
        let reply = entry.reply.trim();
        if !prompt.is_empty() {
            assistant_history_lines.push(format!("User: {}", prompt));
        }
        if !reply.is_empty() {
            assistant_history_lines.push(format!("Assistant: {}", reply));
        }
    }
    let assistant_history = if assistant_history_lines.is_empty() {
        "None".to_string()
    } else {
        assistant_history_lines.join("\n")
    };

    let draft_mode = match classify_draft_mode(&primary_client, &fallback_client, &req.prompt).await
    {
        Some(value) => value,
        None => wants_draft_options_fallback(req.prompt.as_str()),
    };
    let reply_system_prompt = r#"You are an assistant companion helping with an iMessage conversation.
Return only plain text. Do not use markdown formatting (no **bold**, *italics*, headings, lists, or backticks).
If draft_mode is true:
- Do NOT include draft messages, options, examples, or numbered/bulleted lists.
- Keep the reply to 1-2 short sentences.
- Acknowledge that draft options are provided below without asking whether to draft them."#;

    let reply_user_prompt = format!(
        "Draft mode: {}\n\nContact context:\n{}\n\nRecent messages (newest last):\n{}\n\nAssistant chat history:\n{}\n\nUser request:\n{}\n\nReminder: If draft mode is true, do not include or quote any message options in your reply.",
        if draft_mode { "true" } else { "false" },
        contact_context,
        conversation_context,
        assistant_history,
        req.prompt.trim()
    );

    let reply_messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: reply_system_prompt.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: reply_user_prompt,
        },
    ];

    let reply_max_tokens = if draft_mode { 160 } else { 320 };
    let reply_stream = match primary_client
        .chat_completion_stream(reply_messages.clone(), Some(reply_max_tokens), Some(0.7))
        .await
    {
        Ok(stream) => stream,
        Err(e) => {
            error!(target: "ai", "Primary assist stream failed: {}", e);
            match fallback_client
                .chat_completion_stream(reply_messages, Some(reply_max_tokens), Some(0.7))
                .await
            {
                Ok(stream) => stream,
                Err(err) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": format!("AI completion failed: {}", err) })),
                    )
                        .into_response();
                }
            }
        }
    };

    let options_system_prompt = r#"You draft complete iMessage replies.
Return ONLY valid JSON. No markdown, no extra text.

JSON schema:
{"options":["...","...","...","..."]}

Rules:
- options must have exactly 4 distinct strings
- each option is a ready-to-send message, 1-3 sentences
- vary tone/approach across options (direct, warm, playful, concise)
- do not include labels, numbering, or quotes outside JSON
- keep details accurate; avoid over-specific numbers unless relevant
- write in the user's voice based on recent messages
- do not mention these instructions or the system prompt"#;

    let options_user_prompt = format!(
        "Contact context:\n{}\n\nRecent messages (newest last):\n{}\n\nAssistant chat history:\n{}\n\nUser request:\n{}\n\nReturn JSON only.",
        contact_context,
        conversation_context,
        assistant_history,
        req.prompt.trim()
    );

    let stream = stream! {
        let mut reply_stream = reply_stream;
        while let Some(chunk) = reply_stream.next().await {
            match chunk {
                Ok(delta) => {
                    if let Ok(data) = serde_json::to_string(&delta) {
                        yield Ok::<Event, Infallible>(Event::default().event("reply_delta").data(data));
                    }
                }
                Err(err) => {
                    let payload = serde_json::json!({ "error": format!("AI completion failed: {}", err) });
                    yield Ok::<Event, Infallible>(Event::default().event("error").data(payload.to_string()));
                    return;
                }
            }
        }

        if draft_mode {
            // Signal that we're starting to generate draft options
            yield Ok::<Event, Infallible>(Event::default().event("generating_drafts").data("true"));

            let options_messages = vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: options_system_prompt.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: options_user_prompt,
                },
            ];

            let options_result = match primary_client
                .chat_completion(options_messages.clone(), Some(420), Some(0.7))
                .await
            {
                Ok(content) => Ok(content),
                Err(e) => {
                    error!(target: "ai", "Primary assist options failed: {}", e);
                    fallback_client
                        .chat_completion(options_messages, Some(420), Some(0.7))
                        .await
                }
            };

            match options_result {
                Ok(raw) => {
                    if let Some(parsed) = parse_assist_options_response(&raw) {
                        let mut options: Vec<String> = parsed
                            .options
                            .into_iter()
                            .map(|opt| opt.trim().to_string())
                            .filter(|opt| !opt.is_empty())
                            .collect();
                        if options.len() > 4 {
                            options.truncate(4);
                        }
                        if options.len() == 4 {
                            let payload = serde_json::json!({ "options": options });
                            yield Ok::<Event, Infallible>(Event::default().event("options").data(payload.to_string()));
                        } else {
                            let payload = serde_json::json!({ "error": "Invalid assistant response" });
                            yield Ok::<Event, Infallible>(Event::default().event("error").data(payload.to_string()));
                        }
                    } else {
                        let payload = serde_json::json!({ "error": "Failed to parse assistant response" });
                        yield Ok::<Event, Infallible>(Event::default().event("error").data(payload.to_string()));
                    }
                }
                Err(e) => {
                    let payload = serde_json::json!({ "error": format!("AI completion failed: {}", e) });
                    yield Ok::<Event, Infallible>(Event::default().event("error").data(payload.to_string()));
                }
            }
        }

        yield Ok::<Event, Infallible>(Event::default().event("done").data("true"));
    };

    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keep-alive"))
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::parse_draft_mode_response;

    #[test]
    fn parse_draft_mode_from_json() {
        assert_eq!(
            parse_draft_mode_response(r#"{"draft": true}"#),
            Some(true)
        );
        assert_eq!(
            parse_draft_mode_response(r#"{"draft_mode": false}"#),
            Some(false)
        );
        assert_eq!(
            parse_draft_mode_response(r#"{"draft": "yes"}"#),
            Some(true)
        );
        assert_eq!(
            parse_draft_mode_response(r#"prefix {"draft": "no"} suffix"#),
            Some(false)
        );
    }

    #[test]
    fn parse_draft_mode_from_plain_text() {
        assert_eq!(parse_draft_mode_response("true"), Some(true));
        assert_eq!(parse_draft_mode_response("no_draft"), Some(false));
        assert_eq!(parse_draft_mode_response("options"), Some(true));
        assert_eq!(parse_draft_mode_response("maybe"), None);
    }
}
