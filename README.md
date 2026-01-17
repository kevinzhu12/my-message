# iMessage Companion

A minimal macOS desktop app that reads iMessage history, displays conversations, and sends replies via AppleScript. Built with Rust (backend) + Electron + React (frontend).

## Features

- 📱 View iMessage chat history from macOS Messages database
- 💬 Browse chat threads and messages
- ✍️ Draft replies using a simple stub generator
- 📤 Send messages to 1:1 chats (no copy/paste required)
- 🚫 Group chat viewing supported, sending disabled

## Architecture

```
/backend  → Rust HTTP server (Axum) that reads chat.db and sends via AppleScript
/app      → Electron + Vite + React + TypeScript UI
```

## Prerequisites

- macOS (Intel or Apple Silicon)
- Rust and Cargo (install via [rustup](https://rustup.rs/))
- Node.js 18+ and npm/pnpm
- Terminal or backend binary must have **Full Disk Access**
- Terminal must have **Automation** permission for Messages.app

## Installation

### 1. Clone and Install Dependencies

```bash
# Install backend dependencies
cd backend
cargo build --release
cd ..

# Install frontend dependencies
cd app
npm install
# or: pnpm install
cd ..
```

### 2. Grant Required Permissions

#### Full Disk Access (Required to read chat.db)

1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click the **+** button
3. Add your **Terminal** app (or the terminal emulator you're using)
   - For Terminal.app: `/Applications/Utilities/Terminal.app`
   - For iTerm2: `/Applications/iTerm.app`
4. Toggle it **ON**
5. **Restart your terminal** for changes to take effect

> **Note:** If you build a standalone binary, you'll need to grant Full Disk Access to that binary instead.

#### Automation Permission (Required to send messages)

1. The first time you try to send a message, macOS will prompt you to allow automation
2. Or manually go to **System Settings** → **Privacy & Security** → **Automation**
3. Find your **Terminal** (or app) in the list
4. Enable **Messages.app** under it

## Running the App

### Start the Backend

```bash
cd backend
cargo run --release
```

The backend will start on `http://127.0.0.1:3883`

You should see:
```
Server running on http://127.0.0.1:3883
Using database: /Users/YOUR_USERNAME/Library/Messages/chat.db
```

## Logging

Logging uses `tracing` with explicit targets so you can filter by subsystem.

Targets:
- `server` (startup and lifecycle)
- `ws` (WebSocket connections and updates)
- `watcher` (chat.db file watcher and poller)
- `ai` (assist/draft flows)
- `context` (contact context ops)
- `messages` (attachment conversion)
- `openrouter` (LLM requests)

Examples:
```bash
# Only show server and watcher info
RUST_LOG=server=info,watcher=info cargo run --release

# Show OpenRouter request/response bodies
RUST_LOG=openrouter=debug cargo run --release
```

### Start the Frontend

In a **new terminal**:

```bash
cd app
npm run dev
# or: pnpm dev
```

The Electron app will launch automatically.

## Usage

1. **View Chats**: The left pane shows your recent iMessage conversations
2. **Open a Chat**: Click any chat to view messages
3. **Draft a Reply**: Click "Draft" to generate a stub reply (currently a simple template)
4. **Send a Message**:
   - Type your message in the text area (or use the draft)
   - Click "Send" or press `Cmd+Enter`
   - **Only works for 1:1 chats** (group chats will show an error)

## API Endpoints (Backend)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/chats` | List all chats with metadata |
| GET | `/chats/:id/messages` | Get messages for a specific chat |
| POST | `/draft` | Generate a draft reply (stub) |
| POST | `/send` | Send a message via AppleScript |

## Troubleshooting

### "Failed to fetch chats" or Permission Denied

**Cause:** Full Disk Access not granted or terminal not restarted

**Fix:**
1. Ensure Full Disk Access is granted to your terminal app
2. **Restart your terminal completely** (close all windows and reopen)
3. Try running the backend again

### "Failed to send message" or AppleScript Error

**Cause:** Automation permission not granted for Messages.app

**Fix:**
1. Check **System Settings** → **Privacy & Security** → **Automation**
2. Ensure your terminal has permission to control Messages.app
3. Make sure Messages.app is running and signed into iMessage

### Group Chat Send Error

**Expected behavior:** Sending to group chats is intentionally disabled in this MVP. You can view group chats but cannot send messages to them.

### Messages Not Showing Up After Sending

**Fix:** The app will automatically reload messages after a successful send. If messages don't appear:
1. Click "Refresh Chats" in the left pane
2. Make sure the message was actually sent (check Messages.app)

### Chat.db Path Issues

The app looks for the database at: `~/Library/Messages/chat.db`

If you have a custom Messages data location, you'll need to modify the `db_path` in `backend/src/main.rs`.

## Testing

To test the app with a known contact:

1. Make sure you have at least one iMessage conversation with a valid phone number or email
2. Launch both backend and frontend
3. Find the contact in the chat list
4. Open the chat and try sending: "Test message from iMessage Companion"
5. Check Messages.app to verify the message was sent

## Development Notes

- **No monorepo setup**: Backend and frontend are separate, simple projects
- **No authentication**: This is for personal, local use only
- **Read-only database access**: The app only reads from chat.db, never writes to it
- **Simple state management**: React hooks, no Redux or complex state library
- **Minimal dependencies**: Core libraries only (Axum, Rusqlite, React, Tailwind)

## Known Limitations

- Only supports sending to 1:1 chats (not group chats)
- Draft generation is a stub (no LLM integration in MVP)
- No message attachments support (text only)
- No real-time updates (manual refresh required)
- macOS only

## File Structure

```
imessage-companion/
├── README.md
├── backend/
│   ├── Cargo.toml
│   └── src/
│       └── main.rs          # Rust HTTP server with all endpoints
└── app/
    ├── package.json
    ├── vite.config.ts
    ├── electron/
    │   └── main.ts           # Electron main process
    ├── src/
    │   ├── main.tsx          # React entry point
    │   ├── App.tsx           # Main app component
    │   ├── types.ts          # TypeScript interfaces
    │   ├── api.ts            # Backend API client
    │   └── components/
    │       ├── ChatList.tsx  # Chat list sidebar
    │       ├── MessageView.tsx # Message display
    │       └── ComposeBox.tsx  # Message compose area
    └── index.html
```

## Future Enhancements (Not in MVP)

- Real LLM integration for drafting (OpenAI, Claude, local models)
- Vector DB for semantic search over message history
- Real-time message updates via polling or file watching
- Support for attachments (images, files)
- Better group chat support
- Message search and filtering

## License

This is a personal project for educational purposes. Use at your own risk.

---

**Built with:** Rust, Axum, Tokio, Rusqlite, Electron, Vite, React, TypeScript, Tailwind CSS
