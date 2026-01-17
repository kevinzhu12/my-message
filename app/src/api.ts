import type {
  AssistHistoryEntry,
  ChatsByIdsResponse,
  ChatsResponse,
  ContactContext,
  DraftResponse,
  MessagesResponse,
  SearchChatsResponse,
  SendResponse,
  SuggestionAction,
} from "./types";

const API_BASE = "http://127.0.0.1:3883";

export async function fetchChats(
  limit: number = 20,
  offset: number = 0,
): Promise<ChatsResponse> {
  const response = await fetch(
    `${API_BASE}/chats?limit=${limit}&offset=${offset}`,
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch chats");
  }
  return response.json();
}

export async function searchChats(
  query: string,
  limit: number = 200,
): Promise<SearchChatsResponse> {
  const response = await fetch(
    `${API_BASE}/chats/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to search chats");
  }
  return response.json();
}

export async function fetchChatsByIds(
  ids: number[],
): Promise<ChatsByIdsResponse> {
  if (ids.length === 0) {
    return { chats: [] };
  }
  const response = await fetch(`${API_BASE}/chats/by-ids`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch chats by ids");
  }
  return response.json();
}

export async function fetchMessages(
  chatId: number,
  limit: number = 50,
  offset: number = 0,
): Promise<MessagesResponse> {
  const response = await fetch(
    `${API_BASE}/chats/${chatId}/messages?limit=${limit}&offset=${offset}`,
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch messages");
  }
  return response.json();
}

export async function draftMessage(chatId: number): Promise<DraftResponse> {
  const response = await fetch(`${API_BASE}/draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId }),
  });
  if (!response.ok) {
    throw new Error("Failed to draft message");
  }
  return response.json();
}

export async function sendMessage(
  handle: string,
  text: string,
  isGroup: boolean = false,
  chatIdentifier?: string | null,
): Promise<SendResponse> {
  const response = await fetch(`${API_BASE}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      handle,
      text,
      is_group: isGroup,
      chat_identifier: chatIdentifier,
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to send message");
  }
  return response.json();
}

export async function sendAttachment(
  handle: string,
  filePath: string,
  text?: string,
  isGroup: boolean = false,
  chatIdentifier?: string | null,
): Promise<SendResponse> {
  const response = await fetch(`${API_BASE}/send-attachment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      handle,
      file_path: filePath,
      text,
      is_group: isGroup,
      chat_identifier: chatIdentifier,
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to send attachment");
  }
  return response.json();
}

export function getAttachmentUrl(attachmentId: number): string {
  return `${API_BASE}/attachments/${attachmentId}`;
}

export async function fetchContactContext(
  handle: string,
): Promise<ContactContext | null> {
  const response = await fetch(
    `${API_BASE}/context/${encodeURIComponent(handle)}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch contact context");
  }
  return response.json();
}

export async function updateManualNotes(
  handle: string,
  notes: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/context/${encodeURIComponent(handle)}/notes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notes }),
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update notes");
  }
}

export async function updateContactContext(
  handle: string,
  context: {
    display_name?: string | null;
    basic_info?: {
      birthday?: string | null;
      hometown?: string | null;
      work?: string | null;
      school?: string | null;
    };
    notes?: string | null;
  },
): Promise<ContactContext> {
  const response = await fetch(
    `${API_BASE}/context/${encodeURIComponent(handle)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(context),
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update context");
  }
  return response.json();
}

export async function analyzeContactContext(
  chatId: number,
  handle: string,
  displayName?: string | null,
): Promise<ContactContext> {
  const response = await fetch(`${API_BASE}/context/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      handle,
      display_name: displayName ?? null,
    }),
  });
  const raw = await response.text();
  let payload: any = null;
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Analyze request failed (${response.status}): ${raw}`);
    }
  }
  if (!response.ok) {
    throw new Error(
      payload?.error || `Failed to analyze contact (${response.status})`,
    );
  }
  if (!payload || !payload.ok || !payload.context) {
    throw new Error(payload?.error || "Failed to analyze contact");
  }
  return payload.context as ContactContext;
}

export interface SuggestionResponse {
  suggestion: string;
  action?: SuggestionAction;
}

export async function getSuggestion(
  chatId: number,
  partialText: string,
  options?: {
    canCall?: boolean;
    canFaceTime?: boolean;
  },
  signal?: AbortSignal,
): Promise<SuggestionResponse> {
  const response = await fetch(`${API_BASE}/api/suggest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      partial_text: partialText,
      can_call: options?.canCall ?? false,
      can_facetime: options?.canFaceTime ?? false,
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error("Failed to get suggestion");
  }
  return response.json();
}

export async function streamAssistResponse(
  chatId: number,
  prompt: string,
  options: {
    handle?: string | null;
    displayName?: string | null;
    history?: AssistHistoryEntry[];
  },
  handlers: {
    onReplyDelta: (delta: string) => void;
    onOptions: (options: string[]) => void;
    onGeneratingDrafts: () => void;
    onError: (message: string) => void;
    onDone: () => void;
  },
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/assist/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      chat_id: chatId,
      prompt,
      handle: options.handle ?? null,
      display_name: options.displayName ?? null,
      history: options.history ?? [],
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    let payload: any = null;
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`Assist request failed (${response.status}): ${raw}`);
      }
    }
    throw new Error(
      payload?.error || `Failed to request assist response (${response.status})`,
    );
  }

  if (!response.body) {
    throw new Error("Assist response stream unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  const handleEvent = (eventType: string, data: string) => {
    if (eventType === "reply_delta") {
      try {
        const delta = JSON.parse(data);
        if (typeof delta === "string" && delta.length > 0) {
          handlers.onReplyDelta(delta);
        }
      } catch {
        // Ignore malformed chunks.
      }
      return;
    }
    if (eventType === "options") {
      try {
        const payload = JSON.parse(data);
        if (Array.isArray(payload?.options)) {
          handlers.onOptions(payload.options);
        }
      } catch {
        // Ignore malformed options.
      }
      return;
    }
    if (eventType === "generating_drafts") {
      handlers.onGeneratingDrafts();
      return;
    }
    if (eventType === "error") {
      try {
        const payload = JSON.parse(data);
        handlers.onError(payload?.error || "Failed to stream assist response");
      } catch {
        handlers.onError("Failed to stream assist response");
      }
      done = true;
      return;
    }
    if (eventType === "done") {
      done = true;
    }
  };

  while (true) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);
      if (rawEvent) {
        let eventType = "message";
        const dataLines: string[] = [];
        rawEvent.split("\n").forEach((line) => {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        });
        const data = dataLines.join("\n");
        handleEvent(eventType, data);
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
    if (done) {
      break;
    }
  }

  handlers.onDone();
}
