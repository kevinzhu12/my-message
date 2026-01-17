use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
    #[serde(default = "default_search_limit")]
    pub limit: i64,
}

pub fn default_limit() -> i64 {
    20
}

pub fn default_search_limit() -> i64 {
    200
}

#[derive(Serialize)]
pub struct ChatsResponse {
    pub chats: Vec<Chat>,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Serialize)]
pub struct SearchChatsResponse {
    pub chats: Vec<Chat>,
    pub query: String,
}

#[derive(Deserialize)]
pub struct ChatsByIdsRequest {
    pub ids: Vec<i64>,
}

#[derive(Serialize)]
pub struct ChatsByIdsResponse {
    pub chats: Vec<Chat>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Chat {
    pub id: i64,
    pub display_name: String,
    pub last_message_text: Option<String>,
    pub last_message_time: Option<i64>,
    pub last_message_is_from_me: Option<bool>,
    pub is_group: bool,
    pub handles: Vec<String>,
    pub chat_identifier: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Reaction {
    pub emoji: String,
    pub is_from_me: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Attachment {
    pub id: i64,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub transfer_name: Option<String>,
    pub total_bytes: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: i64,
    pub guid: Option<String>,
    pub text: Option<String>,
    pub time: i64,
    pub is_from_me: bool,
    pub handle: Option<String>,
    pub contact_name: Option<String>,
    pub reactions: Vec<Reaction>,
    pub attachments: Vec<Attachment>,
}

#[derive(Serialize)]
pub struct MessagesResponse {
    pub messages: Vec<Message>,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Deserialize)]
pub struct DraftRequest {
    pub chat_id: i64,
}

#[derive(Serialize)]
pub struct DraftResponse {
    pub draft_text: String,
}

#[derive(Deserialize)]
pub struct SendRequest {
    pub handle: String,
    pub text: String,
    #[serde(default)]
    pub is_group: bool,
    pub chat_identifier: Option<String>,
}

#[derive(Serialize)]
pub struct SendResponse {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct SendAttachmentRequest {
    pub handle: String,
    pub file_path: String,
    pub text: Option<String>,
    #[serde(default)]
    pub is_group: bool,
    pub chat_identifier: Option<String>,
}

#[derive(Deserialize)]
pub struct AnalyzeContextRequest {
    pub chat_id: i64,
    pub handle: String,
    pub display_name: Option<String>,
}

#[derive(Serialize)]
pub struct AnalyzeContextResponse {
    pub ok: bool,
    pub context: Option<crate::context_db::ContactContext>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct SuggestRequest {
    pub chat_id: i64,
    pub partial_text: String,
    #[serde(default)]
    pub can_call: bool,
    #[serde(default)]
    pub can_facetime: bool,
}

#[derive(Deserialize)]
pub struct AssistRequest {
    pub chat_id: i64,
    pub prompt: String,
    pub handle: Option<String>,
    pub display_name: Option<String>,
    #[serde(default)]
    pub history: Vec<AssistHistoryEntry>,
}

#[derive(Deserialize)]
pub struct AssistHistoryEntry {
    pub prompt: String,
    pub reply: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedActionType {
    Send,
    Call,
    Facetime,
    SwitchChat,
}

#[derive(Serialize, Deserialize)]
pub struct SuggestedAction {
    pub action: SuggestedActionType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_search_term: Option<String>,
}

#[derive(Serialize)]
pub struct SuggestResponse {
    pub suggestion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<SuggestedAction>,
}

#[derive(Deserialize)]
pub struct UpdateNotesRequest {
    pub notes: String,
}

#[derive(Deserialize)]
pub struct UpdateContextRequest {
    pub display_name: Option<String>,
    pub basic_info: Option<crate::extraction::ExtractedBasicInfo>,
    pub notes: Option<String>,
}

