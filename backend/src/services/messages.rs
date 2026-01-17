use crate::context_db::ContextDb;
use crate::extraction::MessageForExtraction;
use crate::models::{
    Attachment, Chat, ChatsByIdsResponse, ChatsResponse, Message, MessagesResponse, Reaction, SearchChatsResponse,
};
use crate::services::contacts::{
    find_contact_handles_by_name, get_contact_name, should_search_contacts_by_name,
};
use rusqlite::{params, Connection};
use tokio::sync::mpsc;
use tracing::error;
use tracing::info;

const APPLE_EPOCH: i64 = 978307200; // Seconds between 1970-01-01 and 2001-01-01

struct LastMsgData {
    text: Option<String>,
    date: i64,
    has_attachments: i32,
    associated_message_type: i32,
    attributed_body: Option<Vec<u8>>,
    is_from_me: bool,
    associated_message_guid: Option<String>,
}

fn normalize_reaction_guid(guid: &str) -> String {
    if let Some(pos) = guid.rfind('/') {
        guid[pos + 1..].to_string()
    } else if guid.starts_with("bp:") {
        guid[3..].to_string()
    } else {
        guid.to_string()
    }
}

fn fetch_chat_rows(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Vec<(i64, Option<String>, Option<String>)>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "
        SELECT DISTINCT
            c.ROWID as chat_id,
            c.display_name,
            c.chat_identifier
        FROM chat c
        LEFT JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
        LEFT JOIN message m ON cmj.message_id = m.ROWID
        GROUP BY c.ROWID, c.display_name, c.chat_identifier
        ORDER BY MAX(m.date) DESC
        LIMIT ?1 OFFSET ?2
        ",
    )?;

    let chat_rows = stmt
        .query_map(params![limit, offset], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(chat_rows)
}

fn fetch_handles_map(
    conn: &Connection,
    chat_ids: &[i64],
) -> Result<std::collections::HashMap<i64, Vec<String>>, Box<dyn std::error::Error>> {
    let placeholders: String = chat_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let handles_query = format!(
        "SELECT chj.chat_id, h.id
         FROM handle h
         JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
         WHERE chj.chat_id IN ({})
         ORDER BY chj.chat_id",
        placeholders
    );
    let mut handles_stmt = conn.prepare(&handles_query)?;
    let params: Vec<&dyn rusqlite::ToSql> = chat_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let mut handles_map: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    let handles_rows = handles_stmt.query_map(params.as_slice(), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in handles_rows {
        let (chat_id, handle) = row?;
        handles_map
            .entry(chat_id)
            .or_insert_with(Vec::new)
            .push(handle);
    }

    Ok(handles_map)
}

fn fetch_original_texts(
    conn: &Connection,
    reaction_guids: &[String],
) -> Result<std::collections::HashMap<String, String>, Box<dyn std::error::Error>> {
    let mut original_texts: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if reaction_guids.is_empty() {
        return Ok(original_texts);
    }

    let extracted_guids: Vec<String> = reaction_guids
        .iter()
        .map(|g| normalize_reaction_guid(g))
        .collect();

    let guid_placeholders: String =
        extracted_guids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let orig_msg_query = format!(
        "SELECT guid, text, attributedBody FROM message WHERE guid IN ({})",
        guid_placeholders
    );
    let mut orig_stmt = conn.prepare(&orig_msg_query)?;
    let orig_params: Vec<&dyn rusqlite::ToSql> = extracted_guids
        .iter()
        .map(|g| g as &dyn rusqlite::ToSql)
        .collect();
    let orig_rows = orig_stmt.query_map(orig_params.as_slice(), |row| {
        let guid: String = row.get(0)?;
        let text: Option<String> = row.get(1)?;
        let attributed_body: Option<Vec<u8>> = row.get(2).ok();
        Ok((guid, text, attributed_body))
    })?;

    for row in orig_rows {
        let (guid, text, attributed_body) = row?;
        let final_text = if let Some(t) = text {
            if !t.trim().is_empty() {
                Some(t)
            } else if let Some(ref body) = attributed_body {
                extract_text_from_attributed_body(body)
            } else {
                None
            }
        } else if let Some(ref body) = attributed_body {
            extract_text_from_attributed_body(body)
        } else {
            None
        };
        if let Some(t) = final_text {
            original_texts.insert(guid, t);
        }
    }

    Ok(original_texts)
}

fn format_last_message_text(
    data: &LastMsgData,
    original_texts: &std::collections::HashMap<String, String>,
) -> Option<String> {
    let mut text = data.text.clone();

    if text.is_none() || text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
        if data.has_attachments == 1 {
            text = Some("📎 Attachment".to_string());
        } else if data.associated_message_type >= 2000 && data.associated_message_type <= 2005 {
            let reaction_verb = match data.associated_message_type {
                2000 => "loved",
                2001 => "liked",
                2002 => "disliked",
                2003 => "laughed at",
                2004 => "emphasized",
                2005 => "questioned",
                _ => "reacted to",
            };

            let original_text = data.associated_message_guid.as_ref().and_then(|guid| {
                let extracted = normalize_reaction_guid(guid);
                original_texts.get(&extracted).cloned()
            });

            text = Some(match original_text {
                Some(orig) => {
                    let truncated: String = if orig.chars().count() > 30 {
                        format!("{}...", orig.chars().take(27).collect::<String>())
                    } else {
                        orig
                    };
                    format!("{} \"{}\"", reaction_verb, truncated)
                }
                None => format!("{} a message", reaction_verb),
            });
        } else if data.associated_message_type >= 3000 && data.associated_message_type <= 3005 {
            text = Some(match data.associated_message_type {
                3000 => "removed ❤️".to_string(),
                3001 => "removed 👍".to_string(),
                3002 => "removed 👎".to_string(),
                3003 => "removed 😂".to_string(),
                3004 => "removed ‼️".to_string(),
                3005 => "removed ❓".to_string(),
                _ => "removed reaction".to_string(),
            });
        } else if let Some(ref body) = data.attributed_body {
            if let Some(extracted) = extract_text_from_attributed_body(body) {
                text = Some(extracted);
            }
        }
    }

    text
}

fn resolve_display_name(
    display_name: &Option<String>,
    handles: &[String],
    context_db: &ContextDb,
) -> String {
    if let Some(ref name) = display_name {
        if !name.is_empty() {
            return name.clone();
        }
    }

    if handles.is_empty() {
        return "Unknown".to_string();
    }

    handles
        .iter()
        .map(|handle| get_contact_name(handle, context_db).unwrap_or_else(|| handle.clone()))
        .collect::<Vec<String>>()
        .join(", ")
}

fn fetch_last_messages_map(
    conn: &Connection,
    chat_ids: &[i64],
) -> Result<std::collections::HashMap<i64, (Option<String>, Option<i64>, Option<bool>)>, Box<dyn std::error::Error>>
{
    let placeholders: String = chat_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let last_msg_query = format!(
        "SELECT chat_id, text, date, cache_has_attachments, associated_message_type, attributedBody, is_from_me, associated_message_guid
         FROM (
             SELECT cmj.chat_id, m.text, m.date, m.cache_has_attachments, m.associated_message_type, m.attributedBody, m.is_from_me, m.associated_message_guid,
                    ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) as rn
             FROM message m
             JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
             WHERE cmj.chat_id IN ({})
         )
         WHERE rn = 1",
        placeholders
    );
    let mut last_msg_stmt = conn.prepare(&last_msg_query)?;

    let mut raw_last_messages: std::collections::HashMap<i64, LastMsgData> =
        std::collections::HashMap::new();
    let mut reaction_guids: Vec<String> = Vec::new();
    let params: Vec<&dyn rusqlite::ToSql> = chat_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let last_msg_rows = last_msg_stmt.query_map(params.as_slice(), |row| {
        let chat_id: i64 = row.get(0)?;
        let text: Option<String> = row.get(1)?;
        let date: i64 = row.get(2)?;
        let has_attachments: i32 = row.get(3).unwrap_or(0);
        let associated_message_type: i32 = row.get(4).unwrap_or(0);
        let attributed_body: Option<Vec<u8>> = row.get(5).ok();
        let is_from_me: i32 = row.get(6).unwrap_or(0);
        let associated_message_guid: Option<String> = row.get(7).ok();

        Ok((
            chat_id,
            LastMsgData {
                text,
                date,
                has_attachments,
                associated_message_type,
                attributed_body,
                is_from_me: is_from_me == 1,
                associated_message_guid,
            },
        ))
    })?;

    for row in last_msg_rows {
        let (chat_id, data) = row?;
        if data.associated_message_type >= 2000 && data.associated_message_type <= 2005 {
            if let Some(ref guid) = data.associated_message_guid {
                reaction_guids.push(guid.clone());
            }
        }
        raw_last_messages.insert(chat_id, data);
    }

    let original_texts = fetch_original_texts(conn, &reaction_guids)?;

    let mut last_messages_map: std::collections::HashMap<i64, (Option<String>, Option<i64>, Option<bool>)> =
        std::collections::HashMap::new();
    for (chat_id, data) in raw_last_messages {
        let text = format_last_message_text(&data, &original_texts);
        let time_ms = data.date / 1_000_000 + 978307200000;
        last_messages_map.insert(chat_id, (text, Some(time_ms), Some(data.is_from_me)));
    }

    Ok(last_messages_map)
}

pub fn fetch_attachment_file(
    conn: &Connection,
    attachment_id: i64,
) -> Result<Option<(Vec<u8>, Option<String>)>, Box<dyn std::error::Error>> {
    let result: Result<(Option<String>, Option<String>), _> = conn.query_row(
        "SELECT filename, mime_type FROM attachment WHERE ROWID = ?1",
        params![attachment_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    match result {
        Ok((Some(filename), mime_type)) => {
            // Expand ~ to home directory
            let home = std::env::var("HOME").unwrap_or_default();
            let expanded_path = filename.replace("~", &home);

            if std::path::Path::new(&expanded_path).exists() {
                // Check if this is a HEIC file that needs conversion
                let is_heic = expanded_path.to_lowercase().ends_with(".heic")
                    || expanded_path.to_lowercase().ends_with(".heif")
                    || mime_type
                        .as_ref()
                        .map(|m| m.contains("heic") || m.contains("heif"))
                        .unwrap_or(false);

                if is_heic {
                    // Convert HEIC to JPEG using macOS sips command
                    match convert_heic_to_jpeg(&expanded_path) {
                        Ok(jpeg_data) => {
                            Ok(Some((jpeg_data, Some("image/jpeg".to_string()))))
                        }
                        Err(e) => {
                            error!(
                                target: "messages",
                                "Failed to convert HEIC: {}, serving original",
                                e
                            );
                            let data = std::fs::read(&expanded_path)?;
                            Ok(Some((data, mime_type)))
                        }
                    }
                } else {
                    let data = std::fs::read(&expanded_path)?;
                    Ok(Some((data, mime_type)))
                }
            } else {
                Ok(None)
            }
        }
        Ok((None, _)) => Ok(None),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

fn convert_heic_to_jpeg(heic_path: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    use std::process::Command;

    // Create a temporary file for the JPEG output
    let temp_dir = std::env::temp_dir();
    let temp_filename = format!("heic_convert_{}.jpg", std::process::id());
    let temp_path = temp_dir.join(&temp_filename);
    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Use sips (macOS built-in) to convert HEIC to JPEG
    let output = Command::new("sips")
        .args([
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            "80",
            heic_path,
            "--out",
            &temp_path_str,
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sips conversion failed: {}", stderr).into());
    }

    // Read the converted JPEG
    let jpeg_data = std::fs::read(&temp_path)?;

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);

    Ok(jpeg_data)
}

pub fn fetch_chats(
    conn: &Connection,
    contact_resolve_tx: &mpsc::Sender<String>,
    context_db: &ContextDb,
    limit: i64,
    offset: i64,
) -> Result<ChatsResponse, Box<dyn std::error::Error>> {
    // Get total count
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM chat", [], |row| row.get(0))?;

    // Step 1: Get chat IDs with basic info
    let chat_rows = fetch_chat_rows(conn, limit, offset)?;

    if chat_rows.is_empty() {
        return Ok(ChatsResponse {
            chats: vec![],
            total,
            has_more: false,
        });
    }

    let chat_ids: Vec<i64> = chat_rows.iter().map(|(id, _, _)| *id).collect();

    // Step 2: Batch fetch all handles for these chats (1 query instead of N)
    let handles_map = fetch_handles_map(conn, &chat_ids)?;

    // Step 3: Batch fetch last messages for these chats (1 query instead of N)
    let last_messages_map = fetch_last_messages_map(conn, &chat_ids)?;

    // Step 4: Build Chat objects
    let mut chats = Vec::new();
    let mut missing_handles: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (chat_id, display_name, chat_identifier) in chat_rows {
        let handles = handles_map.get(&chat_id).cloned().unwrap_or_default();
        let is_group = handles.len() > 1;
        let (last_message_text, last_message_time, last_message_is_from_me) = last_messages_map
            .get(&chat_id)
            .cloned()
            .unwrap_or((None, None, None));

        let display_name = resolve_display_name(&display_name, &handles, context_db);

        if let Some(handle) = handles.first() {
            if get_contact_name(handle, context_db).is_none() {
                missing_handles.insert(handle.clone());
            }
        }

        chats.push(Chat {
            id: chat_id,
            display_name,
            last_message_text,
            last_message_time,
            last_message_is_from_me,
            is_group,
            handles,
            chat_identifier,
        });
    }

    for handle in missing_handles {
        info!(
            target: "context",
            handle = handle.as_str(),
            source = "fetch_chats",
            "Queuing missing handle for contact resolution"
        );
        let _ = contact_resolve_tx.try_send(handle);
    }

    let has_more = offset + (chats.len() as i64) < total;

    Ok(ChatsResponse {
        chats,
        total,
        has_more,
    })
}

pub fn fetch_chats_by_ids(
    conn: &Connection,
    contact_resolve_tx: &mpsc::Sender<String>,
    context_db: &ContextDb,
    chat_ids: &[i64],
) -> Result<ChatsByIdsResponse, Box<dyn std::error::Error>> {
    // Fetch chat metadata for a specific list of chat IDs (used for pinned chats,
    // shortcuts, and prompt context). Loads handles and last messages in batch,
    // resolves display names from the context cache (no AppleScript here), and
    // queues missing handles for background name resolution.
    if chat_ids.is_empty() {
        return Ok(ChatsByIdsResponse { chats: vec![] });
    }

    // Step 1: Get chat info for the requested IDs
    let placeholders: String = chat_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "SELECT ROWID as chat_id, display_name, chat_identifier FROM chat WHERE ROWID IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&query)?;
    let params: Vec<&dyn rusqlite::ToSql> = chat_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    
    let chat_rows: Vec<(i64, Option<String>, Option<String>)> = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    if chat_rows.is_empty() {
        return Ok(ChatsByIdsResponse { chats: vec![] });
    }

    let found_ids: Vec<i64> = chat_rows.iter().map(|(id, _, _)| *id).collect();

    // Step 2: Batch fetch all handles for these chats
    let found_placeholders: String = found_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let handles_query = format!(
        "SELECT chj.chat_id, h.id
         FROM handle h
         JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
         WHERE chj.chat_id IN ({})
         ORDER BY chj.chat_id",
        found_placeholders
    );
    let mut handles_stmt = conn.prepare(&handles_query)?;
    let found_params: Vec<&dyn rusqlite::ToSql> = found_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();

    let mut handles_map: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    let handles_rows = handles_stmt.query_map(found_params.as_slice(), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in handles_rows {
        let (chat_id, handle) = row?;
        handles_map.entry(chat_id).or_insert_with(Vec::new).push(handle);
    }

    // Step 3: Batch fetch last messages for these chats
    let last_msg_query = format!(
        "SELECT chat_id, text, date, cache_has_attachments, associated_message_type, attributedBody, is_from_me, associated_message_guid
         FROM (
             SELECT cmj.chat_id, m.text, m.date, m.cache_has_attachments, m.associated_message_type, m.attributedBody, m.is_from_me, m.associated_message_guid,
                    ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) as rn
             FROM message m
             JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
             WHERE cmj.chat_id IN ({})
         )
         WHERE rn = 1",
        found_placeholders
    );
    let mut last_msg_stmt = conn.prepare(&last_msg_query)?;

    // First pass: collect raw data and reaction guids
    struct LastMsgData2 {
        text: Option<String>,
        date: i64,
        has_attachments: i32,
        associated_message_type: i32,
        attributed_body: Option<Vec<u8>>,
        is_from_me: bool,
        associated_message_guid: Option<String>,
    }
    let mut raw_last_messages2: std::collections::HashMap<i64, LastMsgData2> = std::collections::HashMap::new();
    let mut reaction_guids2: Vec<String> = Vec::new();

    let last_msg_rows = last_msg_stmt.query_map(found_params.as_slice(), |row| {
        let chat_id: i64 = row.get(0)?;
        let text: Option<String> = row.get(1)?;
        let date: i64 = row.get(2)?;
        let has_attachments: i32 = row.get(3).unwrap_or(0);
        let associated_message_type: i32 = row.get(4).unwrap_or(0);
        let attributed_body: Option<Vec<u8>> = row.get(5).ok();
        let is_from_me: i32 = row.get(6).unwrap_or(0);
        let associated_message_guid: Option<String> = row.get(7).ok();

        Ok((chat_id, LastMsgData2 {
            text,
            date,
            has_attachments,
            associated_message_type,
            attributed_body,
            is_from_me: is_from_me == 1,
            associated_message_guid,
        }))
    })?;

    for row in last_msg_rows {
        let (chat_id, data) = row?;
        if data.associated_message_type >= 2000 && data.associated_message_type <= 2005 {
            if let Some(ref guid) = data.associated_message_guid {
                reaction_guids2.push(guid.clone());
            }
        }
        raw_last_messages2.insert(chat_id, data);
    }

    // Fetch original message texts for reactions
    let mut original_texts2: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if !reaction_guids2.is_empty() {
        let extracted_guids2: Vec<String> = reaction_guids2.iter().map(|g| {
            if let Some(pos) = g.rfind('/') {
                g[pos + 1..].to_string()
            } else if g.starts_with("bp:") {
                g[3..].to_string()
            } else {
                g.clone()
            }
        }).collect();

        let guid_placeholders2: String = extracted_guids2.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let orig_msg_query2 = format!(
            "SELECT guid, text, attributedBody FROM message WHERE guid IN ({})",
            guid_placeholders2
        );
        let mut orig_stmt2 = conn.prepare(&orig_msg_query2)?;
        let orig_params2: Vec<&dyn rusqlite::ToSql> = extracted_guids2.iter().map(|g| g as &dyn rusqlite::ToSql).collect();
        let orig_rows2 = orig_stmt2.query_map(orig_params2.as_slice(), |row| {
            let guid: String = row.get(0)?;
            let text: Option<String> = row.get(1)?;
            let attributed_body: Option<Vec<u8>> = row.get(2).ok();
            Ok((guid, text, attributed_body))
        })?;
        for row in orig_rows2 {
            let (guid, text, attributed_body) = row?;
            let final_text = if let Some(t) = text {
                if !t.trim().is_empty() {
                    Some(t)
                } else if let Some(ref body) = attributed_body {
                    extract_text_from_attributed_body(body)
                } else {
                    None
                }
            } else if let Some(ref body) = attributed_body {
                extract_text_from_attributed_body(body)
            } else {
                None
            };
            if let Some(t) = final_text {
                original_texts2.insert(guid, t);
            }
        }
    }

    // Second pass: format messages with reaction context
    let mut last_messages_map: std::collections::HashMap<i64, (Option<String>, Option<i64>, Option<bool>)> = std::collections::HashMap::new();
    for (chat_id, data) in raw_last_messages2 {
        let mut text = data.text.clone();

        if text.is_none() || text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
            if data.has_attachments == 1 {
                text = Some("📎 Attachment".to_string());
            } else if data.associated_message_type >= 2000 && data.associated_message_type <= 2005 {
                let reaction_verb = match data.associated_message_type {
                    2000 => "loved",
                    2001 => "liked",
                    2002 => "disliked",
                    2003 => "laughed at",
                    2004 => "emphasized",
                    2005 => "questioned",
                    _ => "reacted to",
                };

                let original_text = data.associated_message_guid.as_ref().and_then(|guid| {
                    let extracted = if let Some(pos) = guid.rfind('/') {
                        &guid[pos + 1..]
                    } else if guid.starts_with("bp:") {
                        &guid[3..]
                    } else {
                        guid.as_str()
                    };
                    original_texts2.get(extracted).cloned()
                });

                text = Some(match original_text {
                    Some(orig) => {
                        let truncated: String = if orig.chars().count() > 30 {
                            format!("{}...", orig.chars().take(27).collect::<String>())
                        } else {
                            orig
                        };
                        format!("{} \"{}\"", reaction_verb, truncated)
                    }
                    None => format!("{} a message", reaction_verb),
                });
            } else if data.associated_message_type >= 3000 && data.associated_message_type <= 3005 {
                text = Some(match data.associated_message_type {
                    3000 => "removed ❤️".to_string(),
                    3001 => "removed 👍".to_string(),
                    3002 => "removed 👎".to_string(),
                    3003 => "removed 😂".to_string(),
                    3004 => "removed ‼️".to_string(),
                    3005 => "removed ❓".to_string(),
                    _ => "removed reaction".to_string(),
                });
            } else if let Some(ref body) = data.attributed_body {
                if let Some(extracted) = extract_text_from_attributed_body(body) {
                    text = Some(extracted);
                }
            }
        }

        let time_ms = data.date / 1_000_000 + 978307200000;
        last_messages_map.insert(chat_id, (text, Some(time_ms), Some(data.is_from_me)));
    }

    // Step 4: Build Chat objects
    let mut chats = Vec::new();
    let mut missing_handles: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (chat_id, display_name, chat_identifier) in chat_rows {
        let handles = handles_map.get(&chat_id).cloned().unwrap_or_default();
        let is_group = handles.len() > 1;
        let (last_message_text, last_message_time, last_message_is_from_me) = last_messages_map
            .get(&chat_id)
            .cloned()
            .unwrap_or((None, None, None));

        let display_name = resolve_display_name(&display_name, &handles, context_db);

        if let Some(handle) = handles.first() {
            if get_contact_name(handle, context_db).is_none() {
                missing_handles.insert(handle.clone());
            }
        }

        chats.push(Chat {
            id: chat_id,
            display_name,
            last_message_text,
            last_message_time,
            last_message_is_from_me,
            is_group,
            handles,
            chat_identifier,
        });
    }

    for handle in missing_handles {
        info!(
            target: "context",
            handle = handle.as_str(),
            source = "fetch_chats_by_ids",
            "Queuing missing handle for contact resolution"
        );
        let _ = contact_resolve_tx.try_send(handle);
    }

    Ok(ChatsByIdsResponse { chats })
}

pub fn fetch_search_chats(
    conn: &Connection,
    context_db: &ContextDb,
    query: &str,
    limit: i64,
) -> Result<SearchChatsResponse, Box<dyn std::error::Error>> {
    let query_lower = query.to_lowercase();
    let query_pattern = format!("%{}%", query_lower);
    let mut contact_handles = if should_search_contacts_by_name(&query_lower) {
        context_db
            .search_cached_contacts_by_name(query)?
            .into_iter()
            .map(|(handle, _)| handle)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    if contact_handles.is_empty() && should_search_contacts_by_name(&query_lower) {
        let contacts = find_contact_handles_by_name(&conn, context_db, query)?;
        contact_handles.extend(contacts);
    }

    // Search chats by:
    // 1. display_name (from chat table)
    // 2. chat_identifier (phone/email in chat table)
    // 3. handle.id (phone/email of participants)
    // Order by last message time so most recent matching chats appear first
    let mut sql = String::from(
        "
        SELECT DISTINCT
            c.ROWID as chat_id,
            c.display_name,
            c.chat_identifier
        FROM chat c
        LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        LEFT JOIN handle h ON chj.handle_id = h.ROWID
        WHERE 
            LOWER(COALESCE(c.display_name, '')) LIKE ?
            OR LOWER(COALESCE(c.chat_identifier, '')) LIKE ?
            OR LOWER(COALESCE(h.id, '')) LIKE ?
        "
    );

    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    params.push(&query_pattern);
    params.push(&query_pattern);
    params.push(&query_pattern);

    if !contact_handles.is_empty() {
        let placeholders = contact_handles.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        sql.push_str(&format!(" OR h.id IN ({})", placeholders));
        for handle in &contact_handles {
            params.push(handle as &dyn rusqlite::ToSql);
        }
    }

    sql.push_str(
        "
        GROUP BY c.ROWID
        "
    );

    let mut stmt = conn.prepare(&sql)?;

    let chat_rows = stmt.query_map(params.as_slice(), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;

    let mut chat_rows_vec = Vec::new();
    for chat_row in chat_rows {
        chat_rows_vec.push(chat_row?);
    }

    if chat_rows_vec.is_empty() {
        return Ok(SearchChatsResponse {
            chats: vec![],
            query: query.to_string(),
        });
    }

    let chat_ids: Vec<i64> = chat_rows_vec.iter().map(|(id, _, _)| *id).collect();
    let placeholders: String = chat_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

    let handles_query = format!(
        "SELECT chj.chat_id, h.id
         FROM handle h
         JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
         WHERE chj.chat_id IN ({})
         ORDER BY chj.chat_id",
        placeholders
    );
    let mut handles_stmt = conn.prepare(&handles_query)?;
    let params: Vec<&dyn rusqlite::ToSql> = chat_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();

    let mut handles_map: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    let handles_rows = handles_stmt.query_map(params.as_slice(), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in handles_rows {
        let (chat_id, handle) = row?;
        handles_map.entry(chat_id).or_insert_with(Vec::new).push(handle);
    }

    let last_msg_query = format!(
        "SELECT chat_id, text, date, cache_has_attachments, associated_message_type, attributedBody, is_from_me, associated_message_guid
         FROM (
             SELECT cmj.chat_id, m.text, m.date, m.cache_has_attachments, m.associated_message_type, m.attributedBody, m.is_from_me, m.associated_message_guid,
                    ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) as rn
             FROM message m
             JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
             WHERE cmj.chat_id IN ({})
         )
         WHERE rn = 1",
        placeholders
    );

    let mut last_msg_stmt = conn.prepare(&last_msg_query)?;

    // First pass: collect raw data and reaction guids
    struct LastMsgData3 {
        text: Option<String>,
        date: i64,
        has_attachments: i32,
        associated_message_type: i32,
        attributed_body: Option<Vec<u8>>,
        is_from_me: bool,
        associated_message_guid: Option<String>,
    }
    let mut raw_last_messages3: std::collections::HashMap<i64, LastMsgData3> = std::collections::HashMap::new();
    let mut reaction_guids3: Vec<String> = Vec::new();

    let last_msg_rows = last_msg_stmt.query_map(params.as_slice(), |row| {
        let chat_id: i64 = row.get(0)?;
        let text: Option<String> = row.get(1)?;
        let date: i64 = row.get(2)?;
        let has_attachments: i32 = row.get(3).unwrap_or(0);
        let associated_message_type: i32 = row.get(4).unwrap_or(0);
        let attributed_body: Option<Vec<u8>> = row.get(5).ok();
        let is_from_me: i32 = row.get(6).unwrap_or(0);
        let associated_message_guid: Option<String> = row.get(7).ok();

        Ok((chat_id, LastMsgData3 {
            text,
            date,
            has_attachments,
            associated_message_type,
            attributed_body,
            is_from_me: is_from_me == 1,
            associated_message_guid,
        }))
    })?;

    for row in last_msg_rows {
        let (chat_id, data) = row?;
        if data.associated_message_type >= 2000 && data.associated_message_type <= 2005 {
            if let Some(ref guid) = data.associated_message_guid {
                reaction_guids3.push(guid.clone());
            }
        }
        raw_last_messages3.insert(chat_id, data);
    }

    // Fetch original message texts for reactions
    let mut original_texts3: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if !reaction_guids3.is_empty() {
        let extracted_guids3: Vec<String> = reaction_guids3.iter().map(|g| {
            if let Some(pos) = g.rfind('/') {
                g[pos + 1..].to_string()
            } else if g.starts_with("bp:") {
                g[3..].to_string()
            } else {
                g.clone()
            }
        }).collect();

        let guid_placeholders3: String = extracted_guids3.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let orig_msg_query3 = format!(
            "SELECT guid, text, attributedBody FROM message WHERE guid IN ({})",
            guid_placeholders3
        );
        let mut orig_stmt3 = conn.prepare(&orig_msg_query3)?;
        let orig_params3: Vec<&dyn rusqlite::ToSql> = extracted_guids3.iter().map(|g| g as &dyn rusqlite::ToSql).collect();
        let orig_rows3 = orig_stmt3.query_map(orig_params3.as_slice(), |row| {
            let guid: String = row.get(0)?;
            let text: Option<String> = row.get(1)?;
            let attributed_body: Option<Vec<u8>> = row.get(2).ok();
            Ok((guid, text, attributed_body))
        })?;
        for row in orig_rows3 {
            let (guid, text, attributed_body) = row?;
            let final_text = if let Some(t) = text {
                if !t.trim().is_empty() {
                    Some(t)
                } else if let Some(ref body) = attributed_body {
                    extract_text_from_attributed_body(body)
                } else {
                    None
                }
            } else if let Some(ref body) = attributed_body {
                extract_text_from_attributed_body(body)
            } else {
                None
            };
            if let Some(t) = final_text {
                original_texts3.insert(guid, t);
            }
        }
    }

    // Second pass: format messages with reaction context
    let mut last_messages_map: std::collections::HashMap<i64, (Option<String>, Option<i64>, Option<bool>)> = std::collections::HashMap::new();
    for (chat_id, data) in raw_last_messages3 {
        let mut text = data.text.clone();

        if text.is_none() || text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
            if data.has_attachments == 1 {
                text = Some("📎 Attachment".to_string());
            } else if data.associated_message_type >= 2000 && data.associated_message_type <= 2005 {
                let reaction_verb = match data.associated_message_type {
                    2000 => "loved",
                    2001 => "liked",
                    2002 => "disliked",
                    2003 => "laughed at",
                    2004 => "emphasized",
                    2005 => "questioned",
                    _ => "reacted to",
                };

                let original_text = data.associated_message_guid.as_ref().and_then(|guid| {
                    let extracted = if let Some(pos) = guid.rfind('/') {
                        &guid[pos + 1..]
                    } else if guid.starts_with("bp:") {
                        &guid[3..]
                    } else {
                        guid.as_str()
                    };
                    original_texts3.get(extracted).cloned()
                });

                text = Some(match original_text {
                    Some(orig) => {
                        let truncated: String = if orig.chars().count() > 30 {
                            format!("{}...", orig.chars().take(27).collect::<String>())
                        } else {
                            orig
                        };
                        format!("{} \"{}\"", reaction_verb, truncated)
                    }
                    None => format!("{} a message", reaction_verb),
                });
            } else if data.associated_message_type >= 3000 && data.associated_message_type <= 3005 {
                text = Some(match data.associated_message_type {
                    3000 => "removed ❤️".to_string(),
                    3001 => "removed 👍".to_string(),
                    3002 => "removed 👎".to_string(),
                    3003 => "removed 😂".to_string(),
                    3004 => "removed ‼️".to_string(),
                    3005 => "removed ❓".to_string(),
                    _ => "removed reaction".to_string(),
                });
            } else if let Some(ref body) = data.attributed_body {
                if let Some(extracted) = extract_text_from_attributed_body(body) {
                    text = Some(extracted);
                }
            }
        }

        let time_ms = data.date / 1_000_000 + 978307200000;
        last_messages_map.insert(chat_id, (text, Some(time_ms), Some(data.is_from_me)));
    }

    let mut chats = Vec::new();
    for (chat_id, display_name, chat_identifier) in chat_rows_vec {
        let handles = handles_map.get(&chat_id).cloned().unwrap_or_default();
        let is_group = handles.len() > 1;
        let (last_message_text, last_message_time, last_message_is_from_me) = last_messages_map
            .get(&chat_id)
            .cloned()
            .unwrap_or((None, None, None));

        let display_name = resolve_display_name(&display_name, &handles, context_db);

        chats.push(Chat {
            id: chat_id,
            display_name,
            last_message_text,
            last_message_time,
            last_message_is_from_me,
            is_group,
            handles,
            chat_identifier,
        });
    }

    chats.sort_by(|a, b| b.last_message_time.cmp(&a.last_message_time));
    if chats.len() > limit as usize {
        chats.truncate(limit as usize);
    }

    Ok(SearchChatsResponse {
        chats,
        query: query.to_string(),
    })
}

fn extract_text_from_attributed_body(data: &[u8]) -> Option<String> {
    // AttributedBody is a typedstream/NSKeyedArchiver binary format.
    // Structure after "NSString": [markers] 2B [length] [UTF-8 text]
    // Where 2B is '+' and length is typically 1 byte (or 2 bytes for longer messages)

    // Strategy 1: Find "NSString" marker, then look for the text after the '+' and length byte
    let nsstring_marker = b"NSString";

    if let Some(nsstring_pos) = find_subsequence(data, nsstring_marker) {
        // Look for the '+' (0x2B) marker after NSString
        // It's typically within 10 bytes after "NSString"
        let search_start = nsstring_pos + nsstring_marker.len();
        let search_end = (search_start + 20).min(data.len());

        for i in search_start..search_end {
            if data[i] == 0x2B && i + 2 < data.len() {
                // Found '+', next byte indicates length encoding
                let length_byte = data[i + 1];

                // Handle variable-length encoding:
                // - If < 0x80: single-byte length
                // - If 0x81: 2-byte length follows (little-endian)
                let (text_start, text_len) = if length_byte < 0x80 {
                    // Simple single-byte length
                    (i + 2, length_byte as usize)
                } else if length_byte == 0x81 && i + 4 < data.len() {
                    // 2-byte length (little-endian)
                    let len = (data[i + 2] as usize) | ((data[i + 3] as usize) << 8);
                    (i + 4, len)
                } else if length_byte == 0x82 && i + 5 < data.len() {
                    // 3-byte length (little-endian) - for very long messages
                    let len = (data[i + 2] as usize) | ((data[i + 3] as usize) << 8) | ((data[i + 4] as usize) << 16);
                    (i + 5, len)
                } else {
                    // Unknown encoding, skip
                    continue;
                };

                if text_start + text_len <= data.len() {
                    if let Ok(text) = std::str::from_utf8(&data[text_start..text_start + text_len]) {
                        let trimmed = text.trim();
                        // We found NSString marker with proper length encoding - trust the content
                        // even if it's a single character (like "k" or "a")
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }

    // Strategy 2: Fallback - scan for the longest clean UTF-8 string
    // that doesn't contain plist keywords
    let plist_keywords = [
        "NSString", "NSDictionary", "NSAttributedString", "NSNumber", "NSValue",
        "NSObject", "NSArray", "streamtyped", "__kIM", "MessagePart", "AttributeName",
    ];

    let mut best_text = String::new();
    let mut i = 0;

    while i < data.len() {
        // Try to find a valid UTF-8 sequence starting here
        let mut best_end = i;

        for end in i + 1..=data.len().min(i + 2000) {
            if std::str::from_utf8(&data[i..end]).is_ok() {
                best_end = end;
            } else {
                break;
            }
        }

        if best_end > i + 5 {
            if let Ok(text) = std::str::from_utf8(&data[i..best_end]) {
                let trimmed = text.trim();

                // Check if this looks like real message content
                let has_keyword = plist_keywords.iter().any(|&kw| trimmed.contains(kw));
                let alpha_count = trimmed.chars().filter(|c| c.is_alphabetic()).count();
                let is_mostly_printable = trimmed.chars().all(|c| c >= ' ' || c == '\n' || c == '\t');

                if !has_keyword && alpha_count > 3 && is_mostly_printable {
                    // Score by length and alpha ratio
                    let score = alpha_count * 2 + trimmed.len();
                    let best_score = best_text.chars().filter(|c| c.is_alphabetic()).count() * 2 + best_text.len();

                    if score > best_score {
                        best_text = trimmed.to_string();
                    }
                }
            }
            i = best_end;
        } else {
            i += 1;
        }
    }

    if !best_text.is_empty() {
        Some(best_text)
    } else {
        None
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

pub fn fetch_messages(
    conn: &Connection,
    chat_id: i64,
    context_db: &ContextDb,
    limit: i64,
    offset: i64,
) -> Result<MessagesResponse, Box<dyn std::error::Error>> {
    // Get total count of non-reaction messages for this chat
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_message_join cmj
         JOIN message m ON cmj.message_id = m.ROWID
         WHERE cmj.chat_id = ?1 AND (m.associated_message_type = 0 OR m.associated_message_type IS NULL)",
        params![chat_id],
        |row| row.get(0)
    )?;

    // Fetch non-reaction messages with their guids
    let mut stmt = conn.prepare(
        "
        SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.date,
            m.is_from_me,
            h.id as handle_id,
            m.cache_has_attachments,
            m.associated_message_type,
            m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE cmj.chat_id = ?1
          AND (m.associated_message_type = 0 OR m.associated_message_type IS NULL)
        ORDER BY m.date DESC
        LIMIT ?2 OFFSET ?3
        "
    )?;

    // Collect message data with guids
    let mut messages_with_guids: Vec<(i64, String, Message)> = Vec::new();

    let rows = stmt.query_map(params![chat_id, limit, offset], |row| {
        let id: i64 = row.get(0)?;
        let guid: String = row.get(1)?;
        let mut text: Option<String> = row.get(2)?;
        let has_attachments: i32 = row.get(6).unwrap_or(0);
        let attributed_body: Option<Vec<u8>> = row.get(8).ok();

        // If no text but has attachments, show indicator
        if text.is_none() || text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
            if has_attachments == 1 {
                text = Some("📎 Attachment".to_string());
            } else if let Some(body_data) = attributed_body {
                if let Some(extracted) = extract_text_from_attributed_body(&body_data) {
                    text = Some(extracted);
                } else {
                    text = Some("💬 Message".to_string());
                }
            }
        }

        let handle: Option<String> = row.get(5)?;
        let contact_name = handle
            .as_ref()
            .and_then(|h| get_contact_name(h, context_db));

        Ok((id, guid.clone(), Message {
            id,
            guid: Some(guid),
            text,
            time: convert_apple_time(row.get(3)?),
            is_from_me: row.get::<_, i32>(4)? == 1,
            handle,
            contact_name,
            reactions: Vec::new(),
            attachments: Vec::new(),
        }))
    })?;

    for row in rows {
        messages_with_guids.push(row?);
    }

    // Collect all guids to query for reactions
    let guids: Vec<String> = messages_with_guids.iter().map(|(_, g, _)| g.clone()).collect();

    // Build a map from guid to reactions
    let mut reactions_map: std::collections::HashMap<String, Vec<Reaction>> = std::collections::HashMap::new();

    if !guids.is_empty() {
        // Query for reactions to these messages only
        // associated_message_guid format: "p:0/GUID" or "bp:GUID"
        // Build WHERE clause to filter by our message GUIDs
        let guid_patterns: Vec<String> = guids.iter()
            .flat_map(|g| vec![
                format!("%/{}", g),      // matches "p:0/GUID"
                format!("bp:{}", g),     // matches "bp:GUID"
            ])
            .collect();

        let placeholders: Vec<&str> = guid_patterns.iter().map(|_| "associated_message_guid LIKE ?").collect();
        let where_clause = placeholders.join(" OR ");

        let query = format!(
            "SELECT associated_message_guid, associated_message_type, is_from_me
             FROM message
             WHERE associated_message_type BETWEEN 2000 AND 2005
             AND ({})",
            where_clause
        );

        let mut reaction_stmt = conn.prepare(&query)?;
        let params: Vec<&dyn rusqlite::ToSql> = guid_patterns.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

        let reactions = reaction_stmt.query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i32>(2)? == 1,
            ))
        })?;

        for reaction in reactions {
            let (assoc_guid, reaction_type, is_from_me) = reaction?;

            // Extract the actual guid from formats like "p:0/GUID" or "bp:GUID"
            let parent_guid = if let Some(pos) = assoc_guid.rfind('/') {
                &assoc_guid[pos + 1..]
            } else if assoc_guid.starts_with("bp:") {
                &assoc_guid[3..]
            } else {
                &assoc_guid
            };

            let emoji = match reaction_type {
                2000 => "❤️",
                2001 => "👍",
                2002 => "👎",
                2003 => "😂",
                2004 => "‼️",
                2005 => "❓",
                _ => continue,
            };

            reactions_map
                .entry(parent_guid.to_string())
                .or_insert_with(Vec::new)
                .push(Reaction {
                    emoji: emoji.to_string(),
                    is_from_me,
                });
        }
    }

    // Collect message IDs for attachment query
    let message_ids: Vec<i64> = messages_with_guids.iter().map(|(id, _, _)| *id).collect();

    // Build a map from message_id to attachments
    let mut attachments_map: std::collections::HashMap<i64, Vec<Attachment>> = std::collections::HashMap::new();

    if !message_ids.is_empty() {
        // Query for attachments linked to these specific messages only
        let placeholders: String = message_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT maj.message_id, a.ROWID, a.filename, a.mime_type, a.transfer_name, a.total_bytes
             FROM attachment a
             JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
             WHERE maj.message_id IN ({})",
            placeholders
        );

        let mut attachment_stmt = conn.prepare(&query)?;
        let params: Vec<&dyn rusqlite::ToSql> = message_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();

        let attachments = attachment_stmt.query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5).unwrap_or(0),
            ))
        })?;

        for attachment in attachments {
            let (message_id, id, filename, mime_type, transfer_name, total_bytes) = attachment?;
            attachments_map
                .entry(message_id)
                .or_insert_with(Vec::new)
                .push(Attachment {
                    id,
                    filename,
                    mime_type,
                    transfer_name,
                    total_bytes,
                });
        }
    }

    // Attach reactions and attachments to messages
    let mut result: Vec<Message> = messages_with_guids
        .into_iter()
        .map(|(id, guid, mut msg)| {
            if let Some(reactions) = reactions_map.remove(&guid) {
                msg.reactions = reactions;
            }
            if let Some(attachments) = attachments_map.remove(&id) {
                msg.attachments = attachments;
            }
            msg
        })
        .collect();

    // Reverse to show chronologically (oldest first) for display
    result.reverse();

    let has_more = offset + (result.len() as i64) < total;

    Ok(MessagesResponse {
        messages: result,
        total,
        has_more,
    })
}

pub fn fetch_messages_for_extraction(
    conn: &Connection,
    chat_id: i64,
) -> Result<Vec<MessageForExtraction>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "
        SELECT m.text, m.date, m.is_from_me, m.attributedBody, m.cache_has_attachments
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ?1
          AND (m.associated_message_type = 0 OR m.associated_message_type IS NULL)
        ORDER BY m.date ASC
        "
    )?;

    let rows = stmt.query_map(params![chat_id], |row| {
        let mut text: Option<String> = row.get(0)?;
        let date: i64 = row.get(1)?;
        let is_from_me: i32 = row.get(2)?;
        let attributed_body: Option<Vec<u8>> = row.get(3).ok();

        if text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
            if let Some(body_data) = attributed_body {
                if let Some(extracted) = extract_text_from_attributed_body(&body_data) {
                    text = Some(extracted);
                }
            }
        }

        Ok(text.map(|text| MessageForExtraction {
            text,
            is_from_me: is_from_me == 1,
            timestamp: convert_apple_time_seconds(date),
        }))
    })?;

    let mut messages = Vec::new();
    for row in rows {
        if let Some(message) = row? {
            messages.push(message);
        }
    }

    Ok(messages)
}

pub fn fetch_recent_messages_for_suggestion(
    conn: &Connection,
    chat_id: i64,
    limit: usize,
) -> Result<Vec<MessageForExtraction>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "
        SELECT m.text, m.date, m.is_from_me, m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ?1
          AND (m.associated_message_type = 0 OR m.associated_message_type IS NULL)
          AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
        ORDER BY m.date DESC
        LIMIT ?2
        ",
    )?;

    let rows = stmt.query_map(params![chat_id, limit as i64], |row| {
        let mut text: Option<String> = row.get(0)?;
        let date: i64 = row.get(1)?;
        let is_from_me: i32 = row.get(2)?;
        let attributed_body: Option<Vec<u8>> = row.get(3).ok();

        if text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
            if let Some(body_data) = attributed_body {
                if let Some(extracted) = extract_text_from_attributed_body(&body_data) {
                    text = Some(extracted);
                }
            }
        }

        Ok(text.map(|text| MessageForExtraction {
            text,
            is_from_me: is_from_me == 1,
            timestamp: convert_apple_time_seconds(date),
        }))
    })?;

    let mut messages = Vec::new();
    for row in rows {
        if let Some(message) = row? {
            messages.push(message);
        }
    }

    messages.sort_by_key(|msg| msg.timestamp);
    Ok(messages)
}

fn convert_apple_time(nanoseconds: i64) -> i64 {
    // Apple time is in nanoseconds since 2001-01-01
    // Convert to Unix milliseconds
    let seconds = nanoseconds / 1_000_000_000;
    (APPLE_EPOCH + seconds) * 1000
}

fn convert_apple_time_seconds(nanoseconds: i64) -> i64 {
    APPLE_EPOCH + nanoseconds / 1_000_000_000
}
