//! OpenRouter API client for AI-powered context extraction.
//!
//! OpenRouter provides a unified API to access various LLMs including Claude, GPT-4, Llama, etc.

use async_stream::try_stream;
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::path::Path;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};
use tokio::io::AsyncWriteExt;

/// Default model to use for extraction
pub const DEFAULT_MODEL: &str = "openai/gpt-oss-20b";

/// OpenRouter API client
#[derive(Clone)]
pub struct OpenRouterClient {
    api_key: String,
    model: String,
    http_client: reqwest::Client,
}

pub type OpenRouterStream =
    Pin<Box<dyn Stream<Item = Result<String, OpenRouterError>> + Send>>;

/// Chat message for the API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Request body for chat completions
#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<ProviderOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

/// Response from chat completions
#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    #[allow(dead_code)]
    usage: Option<UsageInfo>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Option<StreamDelta>,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionStreamResponse {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct UsageInfo {
    #[allow(dead_code)]
    prompt_tokens: u32,
    #[allow(dead_code)]
    completion_tokens: u32,
    #[allow(dead_code)]
    total_tokens: u32,
}

/// Error response from OpenRouter
#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    message: String,
    #[allow(dead_code)]
    #[serde(rename = "type")]
    error_type: Option<String>,
}

/// Provider routing options for OpenRouter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_fallbacks: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}

/// OpenRouter client errors
#[derive(Debug)]
pub enum OpenRouterError {
    /// API key not configured
    NoApiKey,
    /// HTTP request failed
    RequestFailed(String),
    /// API returned an error
    ApiError(String),
    /// Failed to parse response
    ParseError(String),
    /// Rate limited
    RateLimited(Option<u64>),
}

impl std::fmt::Display for OpenRouterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenRouterError::NoApiKey => write!(f, "OpenRouter API key not configured"),
            OpenRouterError::RequestFailed(msg) => write!(f, "Request failed: {}", msg),
            OpenRouterError::ApiError(msg) => write!(f, "API error: {}", msg),
            OpenRouterError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            OpenRouterError::RateLimited(retry_after) => {
                if let Some(secs) = retry_after {
                    write!(f, "Rate limited, retry after {} seconds", secs)
                } else {
                    write!(f, "Rate limited")
                }
            }
        }
    }
}

impl std::error::Error for OpenRouterError {}

const OPENROUTER_CSV_ENV: &str = "OPENROUTER_CSV_LOG_PATH";
const OPENROUTER_CSV_HEADER: &str =
    "timestamp,model,max_tokens,temperature,provider,streaming,latency_ms,messages,response\n";

fn openrouter_csv_log_path() -> Option<String> {
    std::env::var(OPENROUTER_CSV_ENV)
        .ok()
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
}

fn csv_escape(value: &str) -> String {
    let needs_quotes = value.contains(',') || value.contains('"') || value.contains('\n');
    if !needs_quotes {
        return value.to_string();
    }
    let escaped = value.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

async fn append_openrouter_csv(
    path: &str,
    record: &[String],
) -> Result<(), std::io::Error> {
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent).await?;
        }
    }

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    let needs_header = tokio::fs::metadata(path)
        .await
        .map(|meta| meta.len() == 0)
        .unwrap_or(true);
    if needs_header {
        file.write_all(OPENROUTER_CSV_HEADER.as_bytes()).await?;
    }

    let line = record
        .iter()
        .map(|value| csv_escape(value))
        .collect::<Vec<_>>()
        .join(",");
    file.write_all(format!("{}\n", line).as_bytes()).await?;
    Ok(())
}

impl OpenRouterClient {
    /// Create a new OpenRouter client with a specific model (new HTTP client)
    pub fn with_model(api_key: String, model: String) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            api_key,
            model,
            http_client,
        }
    }

    /// Create a new OpenRouter client with a shared HTTP client
    pub fn with_shared_client(api_key: String, model: String, http_client: reqwest::Client) -> Self {
        Self {
            api_key,
            model,
            http_client,
        }
    }

    /// Clone the client with a different API key (shared HTTP client)
    pub fn with_api_key(&self, api_key: String) -> Self {
        Self {
            api_key,
            model: self.model.clone(),
            http_client: self.http_client.clone(),
        }
    }

    /// Make a chat completion request
    pub async fn chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
    ) -> Result<String, OpenRouterError> {
        if self.api_key.is_empty() {
            return Err(OpenRouterError::NoApiKey);
        }

        let request = ChatCompletionRequest {
            model: self.model.clone(),
            messages,
            max_tokens,
            temperature,
            provider: Some(ProviderOptions {
                only: None,
                allow_fallbacks: None,
                sort: Some("latency".to_string()),
            }),
            stream: None,
        };

        // Log the request
        let provider_json = serde_json::to_string(&request.provider).unwrap_or_default();
        let messages_json = serde_json::to_string(&request.messages).unwrap_or_default();
        info!(
            target: "openrouter",
            model = %self.model,
            max_tokens = ?max_tokens,
            temperature = ?temperature,
            provider = %provider_json,
            "OpenRouter request"
        );
        // Format messages for readable debug output
        let formatted_messages: String = request
            .messages
            .iter()
            .map(|m| format!("{}---\n{}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        debug!(target: "openrouter", messages = %formatted_messages, "Request messages");

        let start_time = Instant::now();

        let response = self
            .http_client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/imessage-companion")
            .header("X-Title", "iMessage Companion")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                let elapsed = start_time.elapsed();
                warn!(
                    target: "openrouter",
                    latency_ms = elapsed.as_millis(),
                    error = %e,
                    "OpenRouter request failed"
                );
                OpenRouterError::RequestFailed(e.to_string())
            })?;

        let status = response.status();

        // Handle rate limiting
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let elapsed = start_time.elapsed();
            let retry_after = response
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok());
            warn!(
                target: "openrouter",
                latency_ms = elapsed.as_millis(),
                retry_after = ?retry_after,
                "OpenRouter rate limited"
            );
            return Err(OpenRouterError::RateLimited(retry_after));
        }

        let response_text = response
            .text()
            .await
            .map_err(|e| OpenRouterError::RequestFailed(e.to_string()))?;

        let elapsed = start_time.elapsed();

        // Handle error responses
        if !status.is_success() {
            warn!(
                target: "openrouter",
                latency_ms = elapsed.as_millis(),
                status = %status,
                response = %response_text,
                "OpenRouter API error"
            );
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
                return Err(OpenRouterError::ApiError(error_response.error.message));
            }
            return Err(OpenRouterError::ApiError(format!(
                "HTTP {}: {}",
                status, response_text
            )));
        }

        // Log successful response
        info!(
            target: "openrouter",
            latency_ms = elapsed.as_millis(),
            status = %status,
            "OpenRouter response received"
        );
        // Pretty print the response JSON
        let pretty_response = serde_json::from_str::<serde_json::Value>(&response_text)
            .map(|v| serde_json::to_string_pretty(&v).unwrap_or_else(|_| response_text.clone()))
            .unwrap_or_else(|_| response_text.clone());
        debug!(target: "openrouter", response = %pretty_response, "Full response body");

        // Parse successful response
        let completion: ChatCompletionResponse = serde_json::from_str(&response_text)
            .map_err(|e| OpenRouterError::ParseError(format!("{}: {}", e, response_text)))?;

        let content = completion
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .ok_or_else(|| OpenRouterError::ParseError("No choices in response".to_string()))?;

        if let Some(path) = openrouter_csv_log_path() {
            let record = vec![
                chrono::Utc::now().to_rfc3339(),
                self.model.clone(),
                max_tokens.map(|v| v.to_string()).unwrap_or_default(),
                temperature.map(|v| v.to_string()).unwrap_or_default(),
                provider_json.clone(),
                "false".to_string(),
                elapsed.as_millis().to_string(),
                messages_json.clone(),
                content.clone(),
            ];
            if let Err(e) = append_openrouter_csv(&path, &record).await {
                warn!(
                    target: "openrouter",
                    error = %e,
                    path = %path,
                    "Failed to append OpenRouter CSV log"
                );
            }
        }

        Ok(content)
    }

    /// Make a streaming chat completion request
    pub async fn chat_completion_stream(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
    ) -> Result<OpenRouterStream, OpenRouterError> {
        if self.api_key.is_empty() {
            return Err(OpenRouterError::NoApiKey);
        }

        let request = ChatCompletionRequest {
            model: self.model.clone(),
            messages,
            max_tokens,
            temperature,
            provider: Some(ProviderOptions {
                only: None,
                allow_fallbacks: None,
                sort: Some("latency".to_string()),
            }),
            stream: Some(true),
        };

        // Log the request
        let provider_json = serde_json::to_string(&request.provider).unwrap_or_default();
        let messages_json = serde_json::to_string(&request.messages).unwrap_or_default();
        info!(
            target: "openrouter",
            model = %self.model,
            max_tokens = ?max_tokens,
            temperature = ?temperature,
            provider = %provider_json,
            streaming = true,
            "OpenRouter streaming request"
        );
        // Format messages for readable debug output
        let formatted_messages: String = request
            .messages
            .iter()
            .map(|m| format!("{}---\n{}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        debug!(target: "openrouter", messages = %formatted_messages, "Streaming request messages");

        let start_time = Instant::now();

        let response = self
            .http_client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/imessage-companion")
            .header("X-Title", "iMessage Companion")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                let elapsed = start_time.elapsed();
                warn!(
                    target: "openrouter",
                    latency_ms = elapsed.as_millis(),
                    error = %e,
                    "OpenRouter streaming request failed"
                );
                OpenRouterError::RequestFailed(e.to_string())
            })?;

        let status = response.status();
        let time_to_response = start_time.elapsed();

        info!(
            target: "openrouter",
            time_to_response_ms = time_to_response.as_millis(),
            status = %status,
            "OpenRouter stream connection established"
        );

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok());
            warn!(
                target: "openrouter",
                latency_ms = time_to_response.as_millis(),
                retry_after = ?retry_after,
                "OpenRouter streaming rate limited"
            );
            return Err(OpenRouterError::RateLimited(retry_after));
        }

        if !status.is_success() {
            let response_text = response
                .text()
                .await
                .map_err(|e| OpenRouterError::RequestFailed(e.to_string()))?;
            warn!(
                target: "openrouter",
                latency_ms = time_to_response.as_millis(),
                status = %status,
                response = %response_text,
                "OpenRouter streaming API error"
            );
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
                return Err(OpenRouterError::ApiError(error_response.error.message));
            }
            return Err(OpenRouterError::ApiError(format!(
                "HTTP {}: {}",
                status, response_text
            )));
        }

        let mut stream = response.bytes_stream();
        let model = self.model.clone();
        let log_path = openrouter_csv_log_path();
        let csv_model = self.model.clone();
        let csv_max_tokens = max_tokens;
        let csv_temperature = temperature;
        let csv_provider = provider_json.clone();
        let csv_messages = messages_json.clone();
        let parsed_stream = try_stream! {
            let mut buffer = String::new();
            let mut first_chunk = true;
            let mut chunk_count = 0u32;
            let mut full_response = String::new();
            let mut completed = false;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| OpenRouterError::RequestFailed(e.to_string()))?;
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                while let Some(pos) = buffer.find('\n') {
                    let line: String = buffer.drain(..=pos).collect();
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            let total_time = start_time.elapsed();
                            info!(
                                target: "openrouter",
                                total_latency_ms = total_time.as_millis(),
                                time_to_first_byte_ms = time_to_response.as_millis(),
                                chunk_count = chunk_count,
                                model = %model,
                                "OpenRouter stream completed"
                            );
                            completed = true;
                            break;
                        }
                        let parsed: ChatCompletionStreamResponse = serde_json::from_str(data)
                            .map_err(|e| OpenRouterError::ParseError(format!("{}: {}", e, data)))?;
                        if let Some(choice) = parsed.choices.first() {
                            if let Some(delta) = &choice.delta {
                                if let Some(content) = &delta.content {
                                    if !content.is_empty() {
                                        if first_chunk {
                                            let time_to_first_token = start_time.elapsed();
                                            info!(
                                                target: "openrouter",
                                                time_to_first_token_ms = time_to_first_token.as_millis(),
                                                "OpenRouter first token received"
                                            );
                                            first_chunk = false;
                                        }
                                        chunk_count += 1;
                                        full_response.push_str(content);
                                        yield content.clone();
                                    }
                                }
                            }
                        }
                    }
                    if completed {
                        break;
                    }
                }
                if completed {
                    break;
                }
            }

            if let Some(path) = log_path.as_ref() {
                let total_time = start_time.elapsed();
                let record = vec![
                    chrono::Utc::now().to_rfc3339(),
                    csv_model.clone(),
                    csv_max_tokens.map(|v| v.to_string()).unwrap_or_default(),
                    csv_temperature.map(|v| v.to_string()).unwrap_or_default(),
                    csv_provider.clone(),
                    "true".to_string(),
                    total_time.as_millis().to_string(),
                    csv_messages.clone(),
                    full_response,
                ];
                if let Err(e) = append_openrouter_csv(path, &record).await {
                    warn!(
                        target: "openrouter",
                        error = %e,
                        path = %path,
                        "Failed to append OpenRouter CSV log"
                    );
                }
            }
        };

        let boxed: OpenRouterStream = Box::pin(parsed_stream);
        Ok(boxed)
    }

    /// Make a chat completion request with retry logic for rate limiting
    pub async fn chat_completion_with_retry(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
        max_retries: u32,
    ) -> Result<String, OpenRouterError> {
        let mut last_error = OpenRouterError::RequestFailed("No attempts made".to_string());

        for attempt in 0..=max_retries {
            match self.chat_completion(messages.clone(), max_tokens, temperature).await {
                Ok(result) => return Ok(result),
                Err(OpenRouterError::RateLimited(retry_after)) => {
                    if attempt == max_retries {
                        return Err(OpenRouterError::RateLimited(retry_after));
                    }
                    let wait_secs = retry_after.unwrap_or(2u64.pow(attempt));
                    tokio::time::sleep(Duration::from_secs(wait_secs)).await;
                    last_error = OpenRouterError::RateLimited(retry_after);
                }
                Err(OpenRouterError::RequestFailed(msg)) => {
                    if attempt == max_retries {
                        return Err(OpenRouterError::RequestFailed(msg));
                    }
                    // Exponential backoff for network errors
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                    last_error = OpenRouterError::RequestFailed(msg);
                }
                Err(e) => return Err(e),
            }
        }

        Err(last_error)
    }

}
