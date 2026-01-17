#!/bin/bash

echo "🔍 Testing iMessage database access..."
echo ""

DB_PATH="$HOME/Library/Messages/chat.db"

if [ ! -f "$DB_PATH" ]; then
    echo "❌ Database file not found at: $DB_PATH"
    exit 1
fi

echo "✅ Database file exists"

if sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM chat;" > /dev/null 2>&1; then
    CHAT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM chat;")
    echo "✅ Can read database - Found $CHAT_COUNT chats"
    echo ""
    echo "✨ Permissions are working! You can now run the backend:"
    echo "   cd backend && cargo run --release"
else
    echo "❌ Cannot read database"
    echo ""
    echo "📋 To fix this:"
    echo "1. Open System Settings → Privacy & Security → Full Disk Access"
    echo "2. Add your terminal app (e.g., Terminal.app or iTerm)"
    echo "3. Toggle it ON"
    echo "4. Fully quit (Cmd+Q) and restart your terminal"
    echo "5. Run this test script again"
fi
