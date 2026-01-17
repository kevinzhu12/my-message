pub fn send_via_applescript(handle: &str, text: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Escape quotes and backslashes in the text
    let escaped_text = text.replace("\\", "\\\\").replace('"', "\\\"");
    let escaped_handle = handle.replace("\\", "\\\\").replace('"', "\\\"");

    let script = format!(
        r#"tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "{}" of targetService
    send "{}" to targetBuddy
end tell"#,
        escaped_handle, escaped_text
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", stderr).into());
    }

    Ok(())
}

pub fn send_attachment_via_applescript(
    handle: &str,
    file_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let escaped_handle = handle.replace("\\", "\\\\").replace('"', "\\\"");
    let escaped_path = file_path.replace("\\", "\\\\").replace('"', "\\\"");

    let script = format!(
        r#"tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy "{}" of targetService
    send POSIX file "{}" to targetBuddy
end tell"#,
        escaped_handle, escaped_path
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", stderr).into());
    }

    Ok(())
}

pub fn send_to_group_via_applescript(
    chat_identifier: &str,
    text: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let escaped_text = text.replace("\\", "\\\\").replace('"', "\\\"");
    let escaped_chat_id = chat_identifier.replace("\\", "\\\\").replace('"', "\\\"");

    // Messages.app chat IDs have format like "iMessage;+;chat123456789"
    // The database chat_identifier might be just "chat123456789" or the full format
    // We need to find the chat by matching the identifier pattern
    let script = format!(
        r#"tell application "Messages"
    set targetChat to null
    set chatIdentifier to "{0}"

    -- Try direct match first (full format like "iMessage;+;chat123")
    try
        set targetChat to chat id chatIdentifier
    end try

    -- If not found, search through chats for a match
    if targetChat is null then
        repeat with aChat in chats
            set chatId to id of aChat
            -- Check if the chat id contains our identifier
            if chatId contains chatIdentifier then
                set targetChat to aChat
                exit repeat
            end if
        end repeat
    end if

    if targetChat is null then
        error "Could not find chat with identifier: " & chatIdentifier
    end if

    send "{1}" to targetChat
end tell"#,
        escaped_chat_id, escaped_text
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", stderr).into());
    }

    Ok(())
}

pub fn send_attachment_to_group_via_applescript(
    chat_identifier: &str,
    file_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let escaped_chat_id = chat_identifier.replace("\\", "\\\\").replace('"', "\\\"");
    let escaped_path = file_path.replace("\\", "\\\\").replace('"', "\\\"");

    // Same chat-finding logic as send_to_group_via_applescript
    let script = format!(
        r#"tell application "Messages"
    set targetChat to null
    set chatIdentifier to "{0}"

    -- Try direct match first
    try
        set targetChat to chat id chatIdentifier
    end try

    -- If not found, search through chats for a match
    if targetChat is null then
        repeat with aChat in chats
            set chatId to id of aChat
            if chatId contains chatIdentifier then
                set targetChat to aChat
                exit repeat
            end if
        end repeat
    end if

    if targetChat is null then
        error "Could not find chat with identifier: " & chatIdentifier
    end if

    send POSIX file "{1}" to targetChat
end tell"#,
        escaped_chat_id, escaped_path
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", stderr).into());
    }

    Ok(())
}
