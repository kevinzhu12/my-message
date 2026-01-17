//! AI-powered context extraction from messages.
//!
//! Uses OpenRouter to analyze message conversations and extract
//! structured information about contacts.

use crate::context_db::{BasicInfo, ContactContext};
use crate::openrouter::{ChatMessage, OpenRouterClient, OpenRouterError};
use serde::{Deserialize, Serialize};

/// Extraction prompt template
const EXTRACTION_PROMPT: &str = r#"You are analyzing text messages between me and {contact_name} to help me remember important details about this person.

Your task: Extract durable, person-level facts that would help me maintain this relationship—things I might forget or want to reference later. The messages span multiple time periods; do not over-index on the most recent thread.

Return a JSON object with these fields (omit any field with no evidence):

{
  "basic_info": {
    "birthday": "March 15" or "1990-03-15",
    "hometown": "City, State/Country",
    "work": "Job title at Company",
    "school": "University/School name"
  },
  "notes": "Concise paragraph about this person and our relationship (2-4 sentences)."
}

For the "notes" field, write helpful context I'd want to remember, such as:
- How we know each other and our relationship dynamic
- Their personality, communication style, and what they care about
- Family members, pets, or important people in their life (with names if mentioned)
- Hobbies, interests, and things they're passionate about
- Food/drink preferences, dietary restrictions
- Memorable experiences we've shared (summarize travel as one sentence; avoid prices, exact times, booking details)
- Ongoing situations in their life (job search, health, relationships, projects)

Write in a natural, readable style—not bullet points. Be specific but concise. Only include information actually present or clearly implied in the messages.

Do NOT:
- Include prices, exact times, booking details, or step-by-step logistics
- Over-focus on a single recent thread; favor durable, stable context
- Speculate or infer beyond the messages
- Include private identifiers (addresses, account numbers, tickets)
- Repeat the same event in multiple ways

Return valid JSON only, no markdown or explanation.

Messages:
{messages}"#;

/// Prompt to merge and deduplicate notes across chunks.
const NOTES_MERGE_PROMPT: &str = r#"You are merging notes about {contact_name}. Make the result concise and non-redundant.

Return a JSON object with:
{
  "notes": "A concise paragraph (2-5 sentences) about who they are and our relationship."
}

Rules:
- Remove duplication and overlapping phrasing
- Keep durable, person-level facts
- Avoid logistics, prices, and exact times
- Do not add new information; only rephrase what is given
- Return valid JSON only

Notes to merge:
{notes}"#;

const NOTES_MERGE_BATCH_SIZE: usize = 6;

/// Extracted data from AI response
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtractedContext {
    #[serde(default)]
    pub basic_info: ExtractedBasicInfo,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NotesOnlyResponse {
    notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtractedBasicInfo {
    pub birthday: Option<String>,
    pub hometown: Option<String>,
    pub work: Option<String>,
    pub school: Option<String>,
}

/// A message for extraction
#[derive(Debug, Clone)]
pub struct MessageForExtraction {
    pub text: String,
    pub is_from_me: bool,
    pub timestamp: i64,
}

/// Extraction error types
#[derive(Debug)]
pub enum ExtractionError {
    /// OpenRouter API error
    ApiError(OpenRouterError),
    /// Failed to parse AI response as JSON
    ParseError(String),
    /// No messages to analyze
    NoMessages,
}

impl std::fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExtractionError::ApiError(e) => write!(f, "API error: {}", e),
            ExtractionError::ParseError(msg) => write!(f, "Failed to parse AI response: {}", msg),
            ExtractionError::NoMessages => write!(f, "No messages to analyze"),
        }
    }
}

impl std::error::Error for ExtractionError {}

impl From<OpenRouterError> for ExtractionError {
    fn from(e: OpenRouterError) -> Self {
        ExtractionError::ApiError(e)
    }
}

/// Format messages for the extraction prompt
fn format_messages(messages: &[MessageForExtraction]) -> String {
    messages
        .iter()
        .map(|msg| {
            let sender = if msg.is_from_me { "Me" } else { "Them" };
            let date = chrono::DateTime::from_timestamp(msg.timestamp, 0)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            format!("[{}] {}: {}", date, sender, msg.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Extract context from messages using AI
pub async fn extract_context(
    client: &OpenRouterClient,
    contact_name: &str,
    messages: &[MessageForExtraction],
) -> Result<ExtractedContext, ExtractionError> {
    if messages.is_empty() {
        return Err(ExtractionError::NoMessages);
    }

    // Format the prompt
    let formatted_messages = format_messages(messages);
    let prompt = EXTRACTION_PROMPT
        .replace("{contact_name}", contact_name)
        .replace("{messages}", &formatted_messages);

    // Call the AI
    let response = client
        .chat_completion_with_retry(
            vec![ChatMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            Some(2000),
            Some(0.1), // Low temperature for consistent output
            3,
        )
        .await?;

    // Parse the response - try to find JSON in the response
    parse_extraction_response(&response)
}

/// Merge notes using an LLM pass to remove duplication.
pub async fn merge_notes_with_llm(
    client: &OpenRouterClient,
    contact_name: &str,
    notes: &str,
) -> Result<String, ExtractionError> {
    let prompt = NOTES_MERGE_PROMPT
        .replace("{contact_name}", contact_name)
        .replace("{notes}", notes);

    let response = client
        .chat_completion_with_retry(
            vec![ChatMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            Some(400),
            Some(0.1),
            2,
        )
        .await?;

    parse_notes_response(&response)
}

/// Hierarchically merge notes using multiple LLM passes.
pub async fn merge_notes_hierarchical_with_llm(
    client: &OpenRouterClient,
    contact_name: &str,
    notes: Vec<String>,
) -> Result<String, ExtractionError> {
    let mut current: Vec<String> = notes
        .into_iter()
        .map(|note| note.trim().to_string())
        .filter(|note| !note.is_empty())
        .collect();

    if current.is_empty() {
        return Err(ExtractionError::ParseError(
            "No notes available for merge".to_string(),
        ));
    }

    let mut seen = std::collections::HashSet::new();
    current.retain(|note| {
        let normalized = normalize_note_text(note);
        if normalized.is_empty() || seen.contains(&normalized) {
            false
        } else {
            seen.insert(normalized);
            true
        }
    });

    while current.len() > 1 {
        let mut next = Vec::new();
        for batch in current.chunks(NOTES_MERGE_BATCH_SIZE) {
            if batch.len() == 1 {
                next.push(batch[0].to_string());
                continue;
            }
            let joined = batch.join("\n\n");
            let merged = merge_notes_with_llm(client, contact_name, &joined).await?;
            if !merged.trim().is_empty() {
                next.push(merged);
            }
        }
        if next.is_empty() {
            break;
        }
        current = next;
    }

    Ok(current
        .first()
        .map(|note| note.to_string())
        .unwrap_or_default())
}

/// Parse the AI response into structured data
fn parse_extraction_response(response: &str) -> Result<ExtractedContext, ExtractionError> {
    // Try to find JSON in the response (AI might include markdown or explanation)
    let json_str = extract_json_from_response(response);

    serde_json::from_str(&json_str).map_err(|e| {
        ExtractionError::ParseError(format!(
            "Invalid JSON: {}. Response was: {}",
            e,
            &response[..response.len().min(500)]
        ))
    })
}

fn parse_notes_response(response: &str) -> Result<String, ExtractionError> {
    let json_str = extract_json_from_response(response);
    let parsed: NotesOnlyResponse = serde_json::from_str(&json_str).map_err(|e| {
        ExtractionError::ParseError(format!(
            "Invalid JSON: {}. Response was: {}",
            e,
            &response[..response.len().min(500)]
        ))
    })?;
    let trimmed = parsed.notes.trim();
    if trimmed.is_empty() {
        return Err(ExtractionError::ParseError("Empty notes response".to_string()));
    }
    Ok(trimmed.to_string())
}

/// Extract JSON from AI response (handles markdown code blocks)
fn extract_json_from_response(response: &str) -> String {
    // Try to find JSON code block
    if let Some(start) = response.find("```json") {
        if let Some(end) = response[start + 7..].find("```") {
            return response[start + 7..start + 7 + end].trim().to_string();
        }
    }

    // Try to find plain code block
    if let Some(start) = response.find("```") {
        if let Some(end) = response[start + 3..].find("```") {
            let content = response[start + 3..start + 3 + end].trim();
            // Check if it looks like JSON
            if content.starts_with('{') {
                return content.to_string();
            }
        }
    }

    // Try to find raw JSON object
    if let Some(start) = response.find('{') {
        // Find matching closing brace
        let mut depth = 0;
        let mut end = start;
        for (i, c) in response[start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if depth == 0 && end > start {
            return response[start..end].to_string();
        }
    }

    // Return as-is and let the parser handle it
    response.to_string()
}

/// Merge extracted context into existing context
/// Note: basic_info fields are ONLY updated if they don't already exist,
/// preserving any manually entered values.
pub fn merge_context(existing: &mut ContactContext, extracted: ExtractedContext) {
    // Update basic info (only if new value exists AND old doesn't)
    // This preserves manually entered values
    if extracted.basic_info.birthday.is_some() && existing.basic_info.birthday.is_none() {
        existing.basic_info.birthday = extracted.basic_info.birthday;
    }
    if extracted.basic_info.hometown.is_some() && existing.basic_info.hometown.is_none() {
        existing.basic_info.hometown = extracted.basic_info.hometown;
    }
    if extracted.basic_info.work.is_some() && existing.basic_info.work.is_none() {
        existing.basic_info.work = extracted.basic_info.work;
    }
    if extracted.basic_info.school.is_some() && existing.basic_info.school.is_none() {
        existing.basic_info.school = extracted.basic_info.school;
    }

    // Merge notes across chunks, keep concise
    if let Some(new_notes) = extracted.notes {
        let trimmed = new_notes.trim();
        if !trimmed.is_empty() {
            let merged = merge_notes(existing.notes.as_deref(), trimmed, usize::MAX);
            existing.notes = Some(merged);
        }
    }

    // Update timestamp
    existing.last_analyzed_at = Some(chrono::Utc::now().timestamp());
    existing.updated_at = chrono::Utc::now().timestamp();
}

/// Create a new ContactContext from extracted data
pub fn create_context_from_extracted(
    handle: &str,
    display_name: Option<&str>,
    extracted: ExtractedContext,
    last_message_id: Option<i64>,
) -> ContactContext {
    let now = chrono::Utc::now().timestamp();

    ContactContext {
        handle: handle.to_string(),
        display_name: display_name.map(|s| s.to_string()),
        basic_info: BasicInfo {
            birthday: extracted.basic_info.birthday,
            hometown: extracted.basic_info.hometown,
            work: extracted.basic_info.work,
            school: extracted.basic_info.school,
        },
        notes: extracted
            .notes
            .as_ref()
            .map(|notes| merge_notes(None, notes, usize::MAX)),
        last_analyzed_at: Some(now),
        last_analyzed_message_id: last_message_id,
        created_at: now,
        updated_at: now,
    }
}

fn merge_notes(existing: Option<&str>, new_notes: &str, max_sentences: usize) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::new();

    for text in [new_notes, existing.unwrap_or("")] {
        for sentence in split_sentences(text) {
            let normalized = normalize_sentence(&sentence);
            if normalized.is_empty() || seen.contains(&normalized) {
                continue;
            }
            seen.insert(normalized);
            merged.push(sentence);
            if merged.len() >= max_sentences {
                break;
            }
        }
        if merged.len() >= max_sentences {
            break;
        }
    }

    merged.join(". ") + if merged.is_empty() || merged.last().unwrap().ends_with('.') { "" } else { "." }
}

fn split_sentences(text: &str) -> Vec<String> {
    text.split(|c| c == '.' || c == '!' || c == '?' || c == '\n')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn normalize_sentence(sentence: &str) -> String {
    sentence.trim().to_lowercase()
}

fn normalize_note_text(note: &str) -> String {
    note.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_lowercase()
}

/// Chunk messages for processing (to stay within token limits)
pub fn chunk_messages(messages: &[MessageForExtraction], max_chars: usize) -> Vec<Vec<MessageForExtraction>> {
    let mut chunks = Vec::new();
    let mut current_chunk = Vec::new();
    let mut current_size = 0;

    for msg in messages {
        let msg_size = msg.text.len() + 50; // Include overhead for formatting

        if current_size + msg_size > max_chars && !current_chunk.is_empty() {
            chunks.push(current_chunk);
            current_chunk = Vec::new();
            current_size = 0;
        }

        current_chunk.push(msg.clone());
        current_size += msg_size;
    }

    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

/// Filter out messages that are too short or not useful for extraction
pub fn filter_useful_messages(messages: Vec<MessageForExtraction>) -> Vec<MessageForExtraction> {
    messages
        .into_iter()
        .filter(|msg| {
            let text = msg.text.trim();
            // Skip very short messages
            if text.len() < 10 {
                return false;
            }
            // Skip messages that are just reactions/emojis
            if text.chars().all(|c| !c.is_alphanumeric()) {
                return false;
            }
            // Skip common short responses
            let lower = text.to_lowercase();
            if matches!(
                lower.as_str(),
                "ok" | "okay" | "sure" | "yes" | "no" | "yeah" | "yep" | "nope"
                    | "thanks" | "thank you" | "lol" | "haha" | "hahaha" | "lmao"
                    | "omg" | "wow" | "nice" | "cool" | "good" | "great"
            ) {
                return false;
            }
            true
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_messages() {
        let messages = vec![
            MessageForExtraction {
                text: "Hey, want to grab lunch?".to_string(),
                is_from_me: true,
                timestamp: 1704067200, // 2024-01-01
            },
            MessageForExtraction {
                text: "Sure! I love Italian food".to_string(),
                is_from_me: false,
                timestamp: 1704067260,
            },
        ];

        let formatted = format_messages(&messages);
        assert!(formatted.contains("[2024-01-01] Me: Hey, want to grab lunch?"));
        assert!(formatted.contains("[2024-01-01] Them: Sure! I love Italian food"));
    }

    #[test]
    fn test_extract_json_from_response() {
        // Plain JSON
        let response = r#"{"notes": "They like hiking"}"#;
        assert_eq!(extract_json_from_response(response), response);

        // JSON in code block
        let response = "Here's the data:\n```json\n{\"notes\": \"They like hiking\"}\n```";
        assert_eq!(
            extract_json_from_response(response),
            r#"{"notes": "They like hiking"}"#
        );

        // JSON with surrounding text
        let response = "Based on the messages, I found:\n{\"notes\": \"They like hiking\"}\nHope this helps!";
        assert_eq!(
            extract_json_from_response(response),
            r#"{"notes": "They like hiking"}"#
        );
    }

    #[test]
    fn test_filter_useful_messages() {
        let messages = vec![
            MessageForExtraction {
                text: "ok".to_string(),
                is_from_me: true,
                timestamp: 0,
            },
            MessageForExtraction {
                text: "I'm really into hiking and photography lately!".to_string(),
                is_from_me: false,
                timestamp: 0,
            },
            MessageForExtraction {
                text: "lol".to_string(),
                is_from_me: true,
                timestamp: 0,
            },
        ];

        let filtered = filter_useful_messages(messages);
        assert_eq!(filtered.len(), 1);
        assert!(filtered[0].text.contains("hiking"));
    }

    #[test]
    fn test_chunk_messages() {
        let messages: Vec<MessageForExtraction> = (0..100)
            .map(|i| MessageForExtraction {
                text: format!("Message number {} with some content", i),
                is_from_me: i % 2 == 0,
                timestamp: i as i64,
            })
            .collect();

        let chunks = chunk_messages(&messages, 500);
        assert!(chunks.len() > 1);

        // All messages should be included
        let total: usize = chunks.iter().map(|c| c.len()).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn test_parse_extraction_response() {
        let response = r#"{"basic_info": {"birthday": "March 15", "hometown": "NYC"}, "notes": "Friend from college who loves hiking."}"#;
        let extracted = parse_extraction_response(response).unwrap();
        assert_eq!(extracted.basic_info.birthday, Some("March 15".to_string()));
        assert_eq!(extracted.basic_info.hometown, Some("NYC".to_string()));
        assert!(extracted.notes.unwrap().contains("hiking"));
    }
}
