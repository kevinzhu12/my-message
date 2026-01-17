use crate::context_db::ContextDb;
use crate::state::DbChangeEvent;
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;
use tokio::sync::{broadcast, mpsc};
use tracing::info;

pub fn should_search_contacts_by_name(query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return false;
    }
    trimmed.chars().any(|c| c.is_alphabetic())
}

pub fn find_contact_handles_by_name(
    conn: &Connection,
    context_db: &ContextDb,
    query: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut handles = Vec::new();
    let mut seen = HashSet::new();

    let cached = context_db.search_cached_contacts_by_name(query)?;
    for (handle, _name) in cached {
        if seen.insert(handle.clone()) {
            handles.push(handle);
        }
    }

    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        "SELECT id FROM handle WHERE LOWER(id) LIKE ?1 ORDER BY id LIMIT 200",
    )?;
    let rows = stmt.query_map([pattern], |row| row.get::<_, String>(0))?;
    for row in rows {
        let handle = row?;
        if seen.insert(handle.clone()) {
            handles.push(handle);
        }
    }

    Ok(handles)
}

pub fn normalize_contact_handle(handle: &str) -> Vec<String> {
    let trimmed = handle.trim().to_lowercase();
    if trimmed.is_empty() {
        return vec![];
    }

    let mut variants = HashSet::new();
    variants.insert(trimmed.clone());

    // Normalize email casing or phone digits
    let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        variants.insert(digits.clone());
        if digits.len() > 10 {
            variants.insert(digits[digits.len() - 10..].to_string());
        }
    }

    variants.into_iter().collect()
}

pub fn get_contact_name(handle: &str, context_db: &ContextDb) -> Option<String> {
    if let Ok(Some(cached)) = context_db.get_cached_contact_name(handle) {
        return Some(cached);
    }

    info!(target: "context", handle, "No display name in contact_context");
    None
}

pub fn get_contact_name_from_applescript(
    handle: &str,
    context_db: &ContextDb,
) -> Option<String> {
    if let Some(cached) = get_contact_name(handle, context_db) {
        return Some(cached);
    }

    let script = contacts_name_lookup_script(handle);
    let lookup_start = Instant::now();
    let output = run_osascript_output(&script).ok()?;

    let result = if output.status.success() {
        let name = osascript_stdout(output);
        if !name.is_empty() {
            Some(name)
        } else {
            None
        }
    } else {
        None
    };
    let resolved_name = result.as_deref().unwrap_or("None");
    info!(
        target: "context",
        handle,
        duration_ms = lookup_start.elapsed().as_millis(),
        contact_name = resolved_name,
        "[applescript] Finished name lookup in Contacts"
    );

    if let Some(ref name) = result {
        let _ = context_db.set_cached_contact_name(handle, name);
        for variant in normalize_contact_handle(handle) {
            let _ = context_db.set_cached_contact_name(&variant, name);
        }
    }

    result
}

pub async fn contact_resolve_worker(
    mut rx: mpsc::Receiver<String>,
    db_change_tx: broadcast::Sender<DbChangeEvent>,
) {
    // Background resolver for contact display names.
    // Flow: receive missing handles, run AppleScript lookup in a blocking task,
    // cache any resolved name, and throttle db change notifications to at most
    // once every 5s to avoid UI churn.
    let mut last_emit = Instant::now();
    let emit_interval = std::time::Duration::from_secs(5);

    while let Some(handle) = rx.recv().await {
        info!(target: "context", handle = handle.as_str(), "[contact_resolve_worker] Contact resolve worker received handle");
        let handle_clone = handle.clone();

        let resolved = tokio::task::spawn_blocking(move || {
            let context_db = ContextDb::open().ok()?;
            get_contact_name_from_applescript(&handle_clone, &context_db)
        })
        .await
        .ok()
        .flatten();

        if resolved.is_some() {
            info!(target: "context", handle = handle.as_str(), "[contact_resolve_worker] Contact resolve worker resolved name");
            let now = Instant::now();
            if now.duration_since(last_emit) >= emit_interval {
                let _ = db_change_tx.send(DbChangeEvent {
                    timestamp: chrono::Utc::now().timestamp_millis(),
                });
                last_emit = now;
                info!(target: "context", handle = handle.as_str(), "[contact_resolve_worker] Contact resolve worker emitted db change");
            }
        } else {
            info!(target: "context", handle = handle.as_str(), "[contact_resolve_worker] Contact resolve worker found no name");
        }
    }
}

pub fn fetch_contact_photo(
    handle: &str,
) -> Result<Option<Vec<u8>>, Box<dyn std::error::Error + Send + Sync>> {
    // Create a cache directory for photos at ~/.imessage-companion/photos
    let cache_dir = std::path::PathBuf::from(std::env::var("HOME").expect("HOME not set"))
        .join(".imessage-companion/photos");
    std::fs::create_dir_all(&cache_dir)?;

    // Create a safe filename from the handle
    let safe_handle = handle.replace(|c: char| !c.is_alphanumeric(), "_");
    let cache_path = cache_dir.join(format!("{}.jpg", safe_handle));

    // Check if cached
    if cache_path.exists() {
        // Check if cache is less than 1 week old
        if let Ok(metadata) = std::fs::metadata(&cache_path) {
            if let Ok(modified) = metadata.modified() {
                if modified.elapsed().unwrap_or_default().as_secs() < 604800 {
                    return Ok(Some(std::fs::read(&cache_path)?));
                }
            }
        }
    }

    info!(target: "context", handle, "[photo] Fetching contact photo via AppleScript");
    let script = contacts_photo_probe_script(handle);
    let probe_start = Instant::now();
    let output = run_osascript_output(&script)?;
    info!(
        target: "context",
        handle,
        duration_ms = probe_start.elapsed().as_millis(),
        "[photo] Contact photo probe AppleScript finished"
    );
    let result = osascript_stdout(output);

    if result != "HAS_IMAGE" {
        info!(
            target: "context",
            handle,
            status = result.as_str(),
            "No contact photo available"
        );
        return Ok(None);
    }

    // Save the image to a temp file using AppleScript
    let temp_tiff = std::env::temp_dir().join(format!("{}_temp.tiff", safe_handle));
    let save_script = contacts_photo_export_script(handle, &temp_tiff);
    let export_start = Instant::now();
    let output = run_osascript_output(&save_script)?;
    info!(
        target: "context",
        handle,
        duration_ms = export_start.elapsed().as_millis(),
        "[photo] Contact photo export AppleScript finished"
    );
    let result = osascript_stdout(output);

    if result != "OK" {
        info!(
            target: "context",
            handle,
            status = result.as_str(),
            "Failed to export contact photo"
        );
        return Ok(None);
    }

    // Convert TIFF to JPEG using sips (macOS built-in tool)
    let sips_start = Instant::now();
    let convert_output = std::process::Command::new("sips")
        .args(["-s", "format", "jpeg", "-s", "formatOptions", "80"])
        .arg(&temp_tiff)
        .args(["--out", cache_path.to_str().unwrap()])
        .output()?;
    info!(
        target: "context",
        handle,
        duration_ms = sips_start.elapsed().as_millis(),
        "[photo] Contact photo sips conversion finished"
    );

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_tiff);

    if !convert_output.status.success() {
        info!(target: "context", handle, "[photo] Failed to convert contact photo to JPEG");
        return Ok(None);
    }

    // Read and return the JPEG
    info!(target: "context", handle, "[photo] Resolved contact photo");
    Ok(Some(std::fs::read(&cache_path)?))
}

// ============================================================================
// AppleScript Helpers
// ============================================================================

fn run_osascript_output(
    script: &str,
) -> std::io::Result<std::process::Output> {
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
}

fn osascript_stdout(output: std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn escape_applescript_string(value: &str) -> String {
    value.replace("\\", "\\\\").replace('"', "\\\"")
}

fn contacts_name_lookup_script(handle: &str) -> String {
    let escaped_handle = escape_applescript_string(handle);
    // AppleScript: input is a handle (phone/email); output is contact name or empty string.
    // Matching: exact digits or last-10-digit match for phones, substring match for emails.
    // Side effects: may activate Contacts and scan all people/phones/emails.
    format!(
        r#"tell application "System Events"
    set contactsRunning to (name of processes) contains "Contacts"
end tell
if not contactsRunning then
    tell application "Contacts" to activate
    delay 0.3
end if

on normalizeDigits(theText)
    set digitText to ""
    repeat with i from 1 to length of theText
        set c to character i of theText
        if c is in "0123456789" then
            set digitText to digitText & c
        end if
    end repeat
    return digitText
end normalizeDigits

on last10Digits(digitText)
    if length of digitText > 10 then
        return text (length of digitText - 9) thru (length of digitText) of digitText
    end if
    return digitText
end last10Digits

tell application "Contacts"
    set target to "{0}"
    set targetDigits to my normalizeDigits(target)
    set targetLast10 to my last10Digits(targetDigits)
    if target is not "" then
        try
            set phoneMatches to (people whose value of phones contains target)
            if (count of phoneMatches) > 0 then return name of item 1 of phoneMatches
        end try
    end if

    if targetLast10 is not "" then
        try
            set phoneMatchesLast10 to (people whose value of phones contains targetLast10)
            if (count of phoneMatchesLast10) > 0 then return name of item 1 of phoneMatchesLast10
        end try
    end if

    if target is not "" then
        try
            set emailMatches to (people whose value of emails contains target)
            if (count of emailMatches) > 0 then return name of item 1 of emailMatches
        end try
    end if

    return ""
end tell"#,
        escaped_handle
    )
}

fn contacts_photo_probe_script(handle: &str) -> String {
    let escaped_handle = escape_applescript_string(handle);
    // AppleScript: input is a handle (phone/email); output is HAS_IMAGE, NO_IMAGE, or NOT_FOUND.
    // Matching: same phone/email rules as name lookup; then checks if contact has image data.
    // Side effects: may activate Contacts and scan all people/phones/emails.
    format!(
        r#"
        tell application "System Events"
            set contactsRunning to (name of processes) contains "Contacts"
        end tell
        if not contactsRunning then
            tell application "Contacts" to activate
            delay 0.3
        end if

        on normalizeDigits(theText)
            set digitText to ""
            repeat with i from 1 to length of theText
                set c to character i of theText
                if c is in "0123456789" then
                    set digitText to digitText & c
                end if
            end repeat
            return digitText
        end normalizeDigits

        on last10Digits(digitText)
            if length of digitText > 10 then
                return text (length of digitText - 9) thru (length of digitText) of digitText
            end if
            return digitText
        end last10Digits

        tell application "Contacts"
            set target to "{0}"
            set targetDigits to my normalizeDigits(target)
            set targetLast10 to my last10Digits(targetDigits)
            set foundPerson to missing value
            if target is not "" then
                try
                    set phoneMatches to (people whose value of phones contains target)
                    if (count of phoneMatches) > 0 then set foundPerson to item 1 of phoneMatches
                end try
            end if

            if foundPerson is missing value and targetLast10 is not "" then
                try
                    set phoneMatchesLast10 to (people whose value of phones contains targetLast10)
                    if (count of phoneMatchesLast10) > 0 then set foundPerson to item 1 of phoneMatchesLast10
                end try
            end if

            if foundPerson is missing value and target is not "" then
                try
                    set emailMatches to (people whose value of emails contains target)
                    if (count of emailMatches) > 0 then set foundPerson to item 1 of emailMatches
                end try
            end if

            if foundPerson is not missing value then
                set imageData to image of foundPerson
                if imageData is not missing value then
                    return "HAS_IMAGE"
                else
                    return "NO_IMAGE"
                end if
            else
                return "NOT_FOUND"
            end if
        end tell
    "#,
        escaped_handle
    )
}

fn contacts_photo_export_script(handle: &str, temp_path: &Path) -> String {
    let escaped_handle = escape_applescript_string(handle);
    let escaped_path = escape_applescript_string(&temp_path.to_string_lossy());
    // AppleScript: inputs are a handle and temp file path; output is OK or FAILED.
    // Matching: same phone/email rules as name lookup; if image data exists, writes it to temp path.
    // Side effects: may activate Contacts, scan all people/phones/emails, and write a temp file.
    format!(
        r#"
        on normalizeDigits(theText)
            set digitText to ""
            repeat with i from 1 to length of theText
                set c to character i of theText
                if c is in "0123456789" then
                    set digitText to digitText & c
                end if
            end repeat
            return digitText
        end normalizeDigits

        on last10Digits(digitText)
            if length of digitText > 10 then
                return text (length of digitText - 9) thru (length of digitText) of digitText
            end if
            return digitText
        end last10Digits

        tell application "Contacts"
            set target to "{0}"
            set targetDigits to my normalizeDigits(target)
            set targetLast10 to my last10Digits(targetDigits)
            set foundPerson to missing value
            if target is not "" then
                try
                    set phoneMatches to (people whose value of phones contains target)
                    if (count of phoneMatches) > 0 then set foundPerson to item 1 of phoneMatches
                end try
            end if

            if foundPerson is missing value and targetLast10 is not "" then
                try
                    set phoneMatchesLast10 to (people whose value of phones contains targetLast10)
                    if (count of phoneMatchesLast10) > 0 then set foundPerson to item 1 of phoneMatchesLast10
                end try
            end if

            if foundPerson is missing value and target is not "" then
                try
                    set emailMatches to (people whose value of emails contains target)
                    if (count of emailMatches) > 0 then set foundPerson to item 1 of emailMatches
                end try
            end if

            if foundPerson is not missing value then
                set imageData to image of foundPerson
                if imageData is not missing value then
                    set tempPath to "{1}"
                    set fileRef to open for access POSIX file tempPath with write permission
                    write imageData to fileRef
                    close access fileRef
                    return "OK"
                end if
            end if
        end tell
        return "FAILED"
    "#,
        escaped_handle, escaped_path
    )
}
