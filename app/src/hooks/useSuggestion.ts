import { useCallback, useEffect, useRef, useState } from "react";
import { getSuggestion } from "../api";
import type { Chat, SuggestionAction } from "../types";
import { findChatBySearchTerm } from "../utils/chatSearch";

// ============================================================================
// Types
// ============================================================================

export type Suggestion = {
  forText: string;
} & (
  | { type: "text"; text: string }
  | { type: "action"; action: SuggestionAction }
);

export interface UseSuggestionOptions {
  messageText: string;
  setMessageText: (text: string) => void;
  selectedChat: Chat | null;
  canCall: boolean;
  sending: boolean;
  chats: Chat[];
  lastMessageId: number | null;
  onSend: (text: string) => void;
  onCall: () => void;
  onFaceTime: () => void;
  onSwitchChat: (chat: Chat) => void;
}

export interface UseSuggestionResult {
  suggestionCache: Map<string, Suggestion | null>;
  handleAcceptSuggestion: (forText: string) => void;
  handleTabAction: (action: SuggestionAction) => void;
  clearSuggestion: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

interface ApiResult {
  suggestion?: string;
  action?: SuggestionAction;
}

function processApiResult(
  result: ApiResult,
  messageText: string
): Suggestion | null {
  if (result.action) {
    const hasText = messageText.trim().length > 0;
    const isActionAllowed = hasText
      ? result.action.action === "send"
      : result.action.action !== "send";
    if (isActionAllowed) {
      return { type: "action", action: result.action, forText: messageText };
    }
    return null;
  }

  if (result.suggestion?.trim()) {
    return { type: "text", text: result.suggestion, forText: messageText };
  }

  return null;
}

// ============================================================================
// Hook
// ============================================================================

export function useSuggestion({
  messageText,
  setMessageText,
  selectedChat,
  canCall,
  sending,
  chats,
  lastMessageId,
  onSend,
  onCall,
  onFaceTime,
  onSwitchChat,
}: UseSuggestionOptions): UseSuggestionResult {
  const [suggestionCache, setSuggestionCache] = useState<Map<string, Suggestion | null>>(
    () => new Map()
  );

  const lastMessageIdRef = useRef(lastMessageId);

  // Invalidate cache when lastMessageId changes
  useEffect(() => {
    if (lastMessageIdRef.current !== lastMessageId) {
      lastMessageIdRef.current = lastMessageId;
      setSuggestionCache(new Map());
    }
  }, [lastMessageId]);

  // Derived values
  const trimmedText = messageText.trim();
  const canSuggest =
    !!selectedChat &&
    (trimmedText.length === 0 || trimmedText.length >= 3);

  const chatId = selectedChat?.id ?? null;

  // Fetch effect - messageText is already debounced by ComposeBox
  useEffect(() => {
    // Early exit: already have a cached result for this text (including null)
    if (suggestionCache.has(messageText)) {
      return;
    }

    // Early exit: can't suggest for this chat/text
    if (!canSuggest || chatId === null) {
      return;
    }

    const controller = new AbortController();

    getSuggestion(
      chatId,
      messageText,
      {
        canCall,
        canFaceTime: canCall,
      },
      controller.signal
    )
      .then((result) => {
        const suggestion = processApiResult(result, messageText);
        setSuggestionCache((prev) => {
          const next = new Map(prev);
          next.set(messageText, suggestion);
          return next;
        });
      })
      .catch(() => {
        // Fetch was aborted or failed - don't cache anything
      });

    return () => controller.abort();
  }, [messageText, chatId, canSuggest, suggestionCache, canCall]);

  // Handlers
  const handleAcceptSuggestion = useCallback(
    (forText: string) => {
      const cachedSuggestion = suggestionCache.get(forText);
      if (cachedSuggestion?.type === "text") {
        setMessageText(forText + cachedSuggestion.text);
      }
    },
    [suggestionCache, setMessageText]
  );

  const clearSuggestion = useCallback(() => {
    setSuggestionCache(new Map());
  }, []);

  const handleTabAction = useCallback(
    (action: SuggestionAction) => {
      if (!selectedChat) return;

      switch (action.action) {
        case "send":
          if (messageText.trim() && !sending) {
            onSend(messageText);
          }
          break;
        case "call":
          if (canCall) {
            onCall();
          }
          break;
        case "facetime":
          if (canCall) {
            onFaceTime();
          }
          break;
        case "switch_chat": {
          const targetChat = findChatBySearchTerm(chats, action.chat_search_term);
          if (targetChat) {
            onSwitchChat(targetChat);
          }
          break;
        }
      }
    },
    [
      selectedChat,
      messageText,
      sending,
      canCall,
      chats,
      onSend,
      onCall,
      onFaceTime,
      onSwitchChat,
    ]
  );

  return {
    suggestionCache,
    handleAcceptSuggestion,
    handleTabAction,
    clearSuggestion,
  };
}
