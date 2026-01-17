import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../types";

// ============================================================================
// WEBSOCKET HOOK
// ============================================================================
//
// This hook manages a WebSocket connection to the backend server.
// It handles:
// - Automatic connection on mount
// - Automatic reconnection with exponential backoff
// - Message parsing and type-safe callbacks
// - Subscription management (which chat to receive updates for)
//
// Usage:
//   const { subscribe, connectionState } = useWebSocket({
//     onMessagesUpdate: (chatId, messages) => setMessages(messages),
//     onDbChanged: () => refetchChats(),
//   });
//
//   // When user selects a chat:
//   subscribe(chatId);
// ============================================================================

/** Possible connection states */
export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

/** Message types we can receive from the server */
interface MessagesUpdateMessage {
  type: "messages_update";
  chat_id: number;
  messages: Message[];
  total: number;
  timestamp: number;
}

interface DbChangedMessage {
  type: "db_changed";
  timestamp: number;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

type ServerMessage = MessagesUpdateMessage | DbChangedMessage | ErrorMessage;

/** Configuration for the WebSocket hook */
interface UseWebSocketOptions {
  /** Called when new messages are received for the subscribed chat */
  onMessagesUpdate?: (
    chatId: number,
    messages: Message[],
    total: number,
  ) => void;
  /** Called when the database changes (for refreshing chat list) */
  onDbChanged?: () => void;
  /** Called on connection errors */
  onError?: (error: string) => void;
}

/** Return value of the useWebSocket hook */
interface UseWebSocketReturn {
  /** Subscribe to updates for a specific chat */
  subscribe: (chatId: number) => void;
  /** Unsubscribe from chat updates */
  unsubscribe: () => void;
  /** Current connection state */
  connectionState: ConnectionState;
  /** Whether the socket is connected */
  isConnected: boolean;
}

const WS_URL = "ws://127.0.0.1:3883/ws";

// Reconnection settings
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds
const RETRY_MULTIPLIER = 2; // Double the delay each time

export function useWebSocket(
  options: UseWebSocketOptions = {},
): UseWebSocketReturn {
  const { onMessagesUpdate, onDbChanged, onError } = options;

  // WebSocket instance ref (persists across re-renders)
  const wsRef = useRef<WebSocket | null>(null);

  // Connection state
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");

  // Retry delay for reconnection (exponential backoff)
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY);

  // Track if we should reconnect (false when intentionally closing)
  const shouldReconnectRef = useRef(true);

  // Current subscribed chat ID
  const subscribedChatRef = useRef<number | null>(null);

  // Store callbacks in refs to avoid re-creating the connection on callback changes
  const onMessagesUpdateRef = useRef(onMessagesUpdate);
  const onDbChangedRef = useRef(onDbChanged);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onMessagesUpdateRef.current = onMessagesUpdate;
    onDbChangedRef.current = onDbChanged;
    onErrorRef.current = onError;
  }, [onMessagesUpdate, onDbChanged, onError]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    setConnectionState("connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      retryDelayRef.current = INITIAL_RETRY_DELAY; // Reset retry delay on success

      // Re-subscribe if we had a subscription before reconnecting
      if (subscribedChatRef.current !== null) {
        const message = JSON.stringify({
          type: "subscribe",
          chat_id: subscribedChatRef.current,
        });
        ws.send(message);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: ServerMessage = JSON.parse(event.data);

        switch (data.type) {
          case "messages_update":
            onMessagesUpdateRef.current?.(
              data.chat_id,
              data.messages,
              data.total,
            );
            break;
          case "db_changed":
            onDbChangedRef.current?.();
            break;
          case "error":
            console.error("[WebSocket] Server error:", data.message);
            onErrorRef.current?.(data.message);
            break;
        }
      } catch (e) {
        console.error("[WebSocket] Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;

      if (shouldReconnectRef.current) {
        setConnectionState("reconnecting");

        // Exponential backoff for reconnection
        const delay = retryDelayRef.current;

        setTimeout(() => {
          retryDelayRef.current = Math.min(
            delay * RETRY_MULTIPLIER,
            MAX_RETRY_DELAY,
          );
          connect();
        }, delay);
      } else {
        setConnectionState("disconnected");
      }
    };

    ws.onerror = () => {
      // The onclose handler will be called after this
    };
  }, []);

  // Subscribe to a chat
  const subscribe = useCallback((chatId: number) => {
    subscribedChatRef.current = chatId;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "subscribe",
        chat_id: chatId,
      });
      wsRef.current.send(message);
    }
  }, []);

  // Unsubscribe from chat updates
  const unsubscribe = useCallback(() => {
    subscribedChatRef.current = null;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type: "unsubscribe" });
      wsRef.current.send(message);
    }
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    subscribe,
    unsubscribe,
    connectionState,
    isConnected: connectionState === "connected",
  };
}
