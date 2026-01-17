import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchChats,
  fetchChatsByIds,
  fetchMessages,
  streamAssistResponse,
  sendAttachment,
  sendMessage,
} from "./api";
import AiAssistPanel, {
  type AiAssistPanelRef,
  type AssistDrafts,
  type AssistEntry,
} from "./components/AiAssistPanel";
import CommandPalette, {
  type CommandPaletteItem,
} from "./components/CommandPalette";
import ComposeBox, { type ComposeBoxRef } from "./components/ComposeBox";
import ContactCard from "./components/ContactCard";
import ChatList, { type ChatListRef } from "./components/chat-list";
import MessageView, {
  type MessageViewRef,
} from "./components/message-view/MessageView";
import ResizableBorder from "./components/ResizableBorder";
import { useChatMessages } from "./hooks/useChatMessages";
import { useSuggestion } from "./hooks/useSuggestion";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { useChatStore } from "./store/chatStore";
import type { Chat, Message } from "./types";

const CHAT_PAGE_SIZE = 20;
const MIN_CHAT_LIST_WIDTH = 250;
const MAX_CHAT_LIST_WIDTH = 500;
const MIN_AI_PANEL_WIDTH = 300;
const MAX_AI_PANEL_WIDTH = 600;
const DEFAULT_CHAT_LIST_WIDTH = 320; // 80 * 4 (w-80 is 320px)
const DEFAULT_AI_PANEL_WIDTH = 384; // 96 * 4 (w-96 is 384px)

type AssistChatState = {
  isOpen: boolean;
  input: string;
  history: AssistEntry[];
  pending: boolean;
  error: string | null;
  drafts: AssistDrafts | null;
  generatingDrafts: boolean;
};

const createAssistState = (): AssistChatState => ({
  isOpen: false,
  input: "",
  history: [],
  pending: false,
  error: null,
  drafts: null,
  generatingDrafts: false,
});

function App() {
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showContactCard, setShowContactCard] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(() => {
    const stored = localStorage.getItem("chatListWidth");
    return stored ? Number(stored) : DEFAULT_CHAT_LIST_WIDTH;
  });
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    const stored = localStorage.getItem("aiPanelWidth");
    return stored ? Number(stored) : DEFAULT_AI_PANEL_WIDTH;
  });
  const chatListRef = useRef<ChatListRef>(null);
  const composeBoxRef = useRef<ComposeBoxRef>(null);
  const messageViewRef = useRef<MessageViewRef>(null);
  const assistPanelRef = useRef<AiAssistPanelRef>(null);
  const hasAutoSelectedRef = useRef(false);
  const { state: chatState, actions: chatActions } = useChatStore();
  useTheme(); // Automatically switch between light and dark mode based on time of day
  const {
    selectedChatId,
    error,
    pinnedChatIds,
    pinnedChatOrder,
    unreadChatIds,
    seenUnreadChatIds,
  } = chatState;
  const {
    ingestChats,
    selectChat: selectChatInStore,
    togglePin: togglePinInStore,
    reorderPinned: reorderPinnedInStore,
    toggleUnread: toggleUnreadInStore,
    setError: setChatError,
  } = chatActions;
  const queryClient = useQueryClient();
  const chatsQuery = useInfiniteQuery({
    queryKey: ["chats", "list"],
    queryFn: ({ pageParam = 0 }) => fetchChats(CHAT_PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (!lastPage.has_more) return undefined;
      const loaded = pages.reduce(
        (count, page) => count + page.chats.length,
        0,
      );
      return loaded;
    },
  });
  const baseChats = useMemo(() => {
    if (!chatsQuery.data?.pages) return [];
    return chatsQuery.data.pages.flatMap((page) => page.chats);
  }, [chatsQuery.data?.pages]);
  const loadedChatIds = useMemo(() => {
    return new Set(baseChats.map((chat) => chat.id));
  }, [baseChats]);
  const missingPinnedIds = useMemo(() => {
    return pinnedChatOrder.filter((id) => !loadedChatIds.has(id));
  }, [loadedChatIds, pinnedChatOrder]);
  const pinnedChatsQuery = useQuery({
    queryKey: ["chats", "byIds", missingPinnedIds],
    queryFn: () => fetchChatsByIds(missingPinnedIds),
    enabled: missingPinnedIds.length > 0,
  });
  const chats = useMemo(() => {
    const merged: Chat[] = [];
    const seen = new Set<number>();

    baseChats.forEach((chat) => {
      if (!seen.has(chat.id)) {
        seen.add(chat.id);
        merged.push(chat);
      }
    });

    const pinnedChats = pinnedChatsQuery.data?.chats ?? [];
    pinnedChats.forEach((chat) => {
      if (!seen.has(chat.id)) {
        seen.add(chat.id);
        merged.push(chat);
      }
    });

    return merged;
  }, [baseChats, pinnedChatsQuery.data?.chats]);
  const loading = chatsQuery.isLoading;
  const loadingMore = chatsQuery.isFetchingNextPage;
  const hasMore = chatsQuery.hasNextPage ?? false;
  const chatListError =
    chatsQuery.error instanceof Error ? chatsQuery.error.message : error;
  const [assistByChat, setAssistByChat] = useState<
    Record<number, AssistChatState>
  >({});
  const {
    messages,
    total: totalMessages,
    hasMore: hasMoreMessages,
    loadingOlder: loadingOlderMessages,
    error: messagesError,
    loadOlder,
    applyWsUpdate,
    addOptimistic,
    rollbackOptimistic,
    replaceFromServer,
  } = useChatMessages(selectedChatId);

  const callLinkRef = useRef<HTMLAnchorElement>(null);
  const facetimeLinkRef = useRef<HTMLAnchorElement>(null);
  const selectedChat = useMemo(() => {
    if (selectedChatId === null) return null;
    return chats.find((chat) => chat.id === selectedChatId) ?? null;
  }, [chats, selectedChatId]);
  const primaryHandle = selectedChat?.handles[0] || "";
  const canCall =
    !!selectedChat &&
    !selectedChat.is_group &&
    (primaryHandle.startsWith("+") || /^\d+$/.test(primaryHandle));
  const assistState = selectedChat
    ? (assistByChat[selectedChat.id] ?? createAssistState())
    : createAssistState();
  const pinnedChatsForShortcuts = useMemo(() => {
    const chatById = new Map(chats.map((chat) => [chat.id, chat]));
    const orderedPinned: Chat[] = [];
    const seen = new Set<number>();

    pinnedChatOrder.forEach((chatId) => {
      const chat = chatById.get(chatId);
      if (chat && !seen.has(chat.id)) {
        orderedPinned.push(chat);
        seen.add(chat.id);
      }
    });

    if (pinnedChatIds.size > orderedPinned.length) {
      chats.forEach((chat) => {
        if (pinnedChatIds.has(chat.id) && !seen.has(chat.id)) {
          orderedPinned.push(chat);
          seen.add(chat.id);
        }
      });
    }

    return orderedPinned.slice(0, 9);
  }, [chats, pinnedChatIds, pinnedChatOrder]);

  const unpinnedChatsForShortcuts = useMemo(() => {
    const unread: Chat[] = [];
    const rest: Chat[] = [];
    chats.forEach((chat) => {
      if (unreadChatIds.has(chat.id)) {
        unread.push(chat);
        return;
      }
      if (pinnedChatIds.has(chat.id)) {
        return;
      }
      rest.push(chat);
    });
    return [...unread, ...rest].slice(0, 9);
  }, [chats, pinnedChatIds, unreadChatIds]);

  useEffect(() => {
    ingestChats(chats);
  }, [chats, ingestChats]);

  // Callback when messages are pushed via WebSocket
  const handleMessagesUpdate = useCallback(
    (chatId: number, newMessages: Message[], total: number) => {
      applyWsUpdate(chatId, newMessages, total);
    },
    [applyWsUpdate],
  );

  // Set up WebSocket connection
  const { subscribe, connectionState } = useWebSocket({
    onMessagesUpdate: handleMessagesUpdate,
    onDbChanged: () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 5000);
    },
    [],
  );

  const handleChatSelect = useCallback(
    (chat: Chat) => {
      selectChatInStore(chat);
      setMessageText("");
      setChatError(null);
      setShowContactCard(false);

      // Focus the text input after selecting a chat
      setTimeout(() => {
        composeBoxRef.current?.focus();
      }, 0);
    },
    [selectChatInStore, setChatError],
  );

  // Subscribe to WebSocket updates when chat is selected
  useEffect(() => {
    if (selectedChat) {
      subscribe(selectedChat.id);
    }
  }, [selectedChat, subscribe]);

  const focusSearch = useCallback(() => {
    chatListRef.current?.focusSearch();
  }, []);

  useEffect(() => {
    if (messagesError) {
      setChatError(messagesError);
    }
  }, [messagesError, setChatError]);

  const focusSelectedChat = useCallback(() => {
    chatListRef.current?.focusSelectedChat();
  }, []);

  const handleComposeEscape = useCallback(() => {
    if (searchQuery.trim()) {
      focusSearch();
      return;
    }
    focusSelectedChat();
  }, [focusSearch, focusSelectedChat, searchQuery]);

  const jumpToChat = useCallback(
    (chat: Chat) => {
      handleChatSelect(chat);
      requestAnimationFrame(() => {
        chatListRef.current?.scrollToChat(chat.id);
      });
    },
    [handleChatSelect],
  );

  useEffect(() => {
    if (hasAutoSelectedRef.current) {
      return;
    }
    if (loading || selectedChatId !== null || chats.length === 0) {
      return;
    }
    const defaultChat =
      chats.find((chat) => !pinnedChatIds.has(chat.id)) ?? chats[0] ?? null;
    if (defaultChat) {
      hasAutoSelectedRef.current = true;
      handleChatSelect(defaultChat);
    }
  }, [chats, handleChatSelect, loading, pinnedChatIds, selectedChatId]);

  const upsertAssistState = useCallback(
    (chatId: number, updater: (prev: AssistChatState) => AssistChatState) => {
      setAssistByChat((prev) => {
        const current = prev[chatId] ?? createAssistState();
        return {
          ...prev,
          [chatId]: updater(current),
        };
      });
    },
    [],
  );

  const loadOlderMessages = useCallback(() => {
    loadOlder().catch((err) => {
      showToast(
        err instanceof Error ? err.message : "Failed to load older messages",
        "error",
      );
    });
  }, [loadOlder, showToast]);

  const handleSend = useCallback(async (text: string) => {
    if (!selectedChat || !text.trim()) return;

    const primaryHandle = selectedChat.handles[0] || "";

    // For group chats, we need the chat_identifier
    if (selectedChat.is_group && !selectedChat.chat_identifier) {
      showToast("Cannot send to this group chat - missing identifier", "error");
      return;
    }

    const textToSend = text.trim();
    const tempMessageId = Date.now(); // Temporary ID for optimistic update

    // Optimistically add the message immediately
    const optimisticMessage: Message = {
      id: tempMessageId,
      text: textToSend,
      time: Date.now(),
      is_from_me: true,
      handle: primaryHandle,
      contact_name: null,
      reactions: [],
      attachments: [],
    };

    addOptimistic(optimisticMessage);

    try {
      setSending(true);
      const response = await sendMessage(
        primaryHandle,
        textToSend,
        selectedChat.is_group,
        selectedChat.chat_identifier,
      );

      if (response.ok) {
        // Don't refetch - the WebSocket will push the updated messages
        // and handleMessagesUpdate will merge them properly
      } else {
        // Remove the optimistic message on error
        rollbackOptimistic(tempMessageId);
        showToast(response.error || "Failed to send message", "error");
      }
    } catch (err) {
      // Remove the optimistic message on error
      rollbackOptimistic(tempMessageId);
      showToast(
        err instanceof Error ? err.message : "Failed to send message",
        "error",
      );
    } finally {
      setSending(false);
      // Focus the textarea after sending is complete so user can continue typing
      // Use setTimeout to ensure React has updated the DOM
      setTimeout(() => {
        composeBoxRef.current?.focus();
      }, 0);
    }
  }, [selectedChat, addOptimistic, rollbackOptimistic, showToast]);

  const handleSendAttachment = async (filePath: string) => {
    if (!selectedChat) return;

    const primaryHandle = selectedChat.handles[0] || "";

    // For group chats, we need the chat_identifier
    if (selectedChat.is_group && !selectedChat.chat_identifier) {
      showToast("Cannot send to this group chat - missing identifier", "error");
      return;
    }

    try {
      setSending(true);
      const response = await sendAttachment(
        primaryHandle,
        filePath,
        messageText.trim() || undefined,
        selectedChat.is_group,
        selectedChat.chat_identifier,
      );

      if (response.ok) {
        setMessageText("");

        // Reload messages to show the sent attachment
        const data = await fetchMessages(selectedChat.id, 50, 0);
        replaceFromServer(data.messages, data.total, data.has_more);
      } else {
        showToast(response.error || "Failed to send attachment", "error");
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to send attachment",
        "error",
      );
    } finally {
      setSending(false);
      // Focus the textarea after sending is complete so user can continue typing
      // Use setTimeout to ensure React has updated the DOM
      setTimeout(() => {
        composeBoxRef.current?.focus();
      }, 0);
    }
  };

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const {
    suggestionCache,
    handleAcceptSuggestion,
    handleTabAction,
    clearSuggestion,
  } = useSuggestion({
    messageText,
    setMessageText,
    selectedChat,
    canCall,
    sending,
    chats,
    lastMessageId,
    onSend: handleSend,
    onCall: () => callLinkRef.current?.click(),
    onFaceTime: () => facetimeLinkRef.current?.click(),
    onSwitchChat: handleChatSelect,
  });

  const handleInsertDraft = useCallback(
    (text: string) => {
      setMessageText(text);
      clearSuggestion();
      composeBoxRef.current?.focus();
    },
    [clearSuggestion],
  );

  const handleToggleAssistPanel = useCallback(() => {
    if (!selectedChat) return;
    const currentState = assistByChat[selectedChat.id] ?? createAssistState();
    const wasOpen = currentState.isOpen;

    upsertAssistState(selectedChat.id, (prev) => ({
      ...prev,
      isOpen: !prev.isOpen,
    }));

    // Focus management after state update
    setTimeout(() => {
      if (wasOpen) {
        // Panel was open, now closing - focus compose box
        composeBoxRef.current?.focus();
      } else {
        // Panel was closed, now opening - focus AI assist input
        assistPanelRef.current?.focus();
      }
    }, 0);
  }, [selectedChat, upsertAssistState, assistByChat, composeBoxRef, assistPanelRef]);

  const handleAssistInputChange = useCallback(
    (value: string) => {
      if (!selectedChat) return;
      upsertAssistState(selectedChat.id, (prev) => ({
        ...prev,
        input: value,
        error: null,
      }));
    },
    [selectedChat, upsertAssistState],
  );

  const handleAssistSubmit = useCallback(async () => {
    if (!selectedChat) return;
    const chatId = selectedChat.id;
    const promptText = assistState.input.trim();
    if (!promptText || assistState.pending) return;

    const historyPayload = assistState.history
      .filter((entry) => entry.prompt.trim() && entry.reply?.trim())
      .slice(-6)
      .map((entry) => ({
        prompt: entry.prompt.trim(),
        reply: entry.reply?.trim() ?? "",
      }));

    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newEntry: AssistEntry = {
      id: entryId,
      prompt: promptText,
      createdAt: Date.now(),
    };

    upsertAssistState(chatId, (prev) => ({
      ...prev,
      input: "",
      pending: true,
      error: null,
      drafts: null,
      generatingDrafts: false,
      history: [...prev.history, newEntry],
    }));

    try {
      let replyBuffer = "";
      let hasError = false;

      await streamAssistResponse(
        chatId,
        promptText,
        {
          handle: selectedChat.is_group
            ? null
            : (selectedChat.handles[0] ?? null),
          displayName: selectedChat.display_name ?? null,
          history: historyPayload,
        },
        {
          onReplyDelta: (delta) => {
            replyBuffer += delta;
            upsertAssistState(chatId, (prev) => ({
              ...prev,
              history: prev.history.map((entry) =>
                entry.id === entryId
                  ? {
                      ...entry,
                      reply: replyBuffer,
                      error: null,
                    }
                  : entry,
              ),
            }));
          },
          onOptions: (options) => {
            upsertAssistState(chatId, (prev) => ({
              ...prev,
              drafts:
                options.length > 0
                  ? {
                      options,
                    }
                  : null,
              generatingDrafts: false,
            }));
          },
          onGeneratingDrafts: () => {
            upsertAssistState(chatId, (prev) => ({
              ...prev,
              generatingDrafts: true,
            }));
          },
          onError: (message) => {
            hasError = true;
            upsertAssistState(chatId, (prev) => ({
              ...prev,
              pending: false,
              error: message,
              drafts: null,
              generatingDrafts: false,
              history: prev.history.map((entry) =>
                entry.id === entryId ? { ...entry, error: message } : entry,
              ),
            }));
          },
          onDone: () => {
            if (hasError) {
              return;
            }
            upsertAssistState(chatId, (prev) => ({
              ...prev,
              pending: false,
              generatingDrafts: false,
            }));
          },
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get assistant response";
      upsertAssistState(chatId, (prev) => ({
        ...prev,
        pending: false,
        error: message,
        drafts: null,
        generatingDrafts: false,
        history: prev.history.map((entry) =>
          entry.id === entryId ? { ...entry, error: message } : entry,
        ),
      }));
    }
  }, [
    assistState.history,
    assistState.input,
    assistState.pending,
    selectedChat,
    upsertAssistState,
  ]);

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "toggle-ai-panel",
        label: assistState.isOpen
          ? "Hide AI companion panel"
          : "Show AI companion panel",
        shortcut: "Cmd+L",
        run: () => handleToggleAssistPanel(),
      },
      {
        id: "focus-search",
        label: "Focus search",
        shortcut: "Cmd+P",
        run: () => focusSearch(),
      },
    ];

    pinnedChatsForShortcuts.forEach((chat, index) => {
      const slot = index + 1;
      items.push({
        id: `pinned-chat-${chat.id}`,
        label: `Open pinned chat ${slot}: ${chat.display_name}`,
        shortcut: `Cmd+Opt+${slot}`,
        run: () => jumpToChat(chat),
      });
    });

    unpinnedChatsForShortcuts.forEach((chat, index) => {
      const slot = index + 1;
      items.push({
        id: `recent-chat-${chat.id}`,
        label: `Open chat ${slot}: ${chat.display_name}`,
        shortcut: `Cmd+${slot}`,
        run: () => jumpToChat(chat),
      });
    });

    return items;
  }, [
    assistState.isOpen,
    focusSearch,
    handleToggleAssistPanel,
    jumpToChat,
    pinnedChatsForShortcuts,
    unpinnedChatsForShortcuts,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !event.metaKey) return;
      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (isCommandPaletteOpen) {
        return;
      }

      if (key === "l") {
        event.preventDefault();
        handleToggleAssistPanel();
        return;
      }

      if (key === "p") {
        event.preventDefault();
        focusSearch();
        return;
      }

      const digitMatch = event.code.match(/^(?:Digit|Numpad)([1-9])$/);
      if (digitMatch) {
        const index = Number(digitMatch[1]) - 1;
        const chat = event.altKey
          ? pinnedChatsForShortcuts[index]
          : unpinnedChatsForShortcuts[index];
        if (chat) {
          event.preventDefault();
          jumpToChat(chat);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    focusSearch,
    handleToggleAssistPanel,
    isCommandPaletteOpen,
    jumpToChat,
    pinnedChatsForShortcuts,
    unpinnedChatsForShortcuts,
  ]);

  const MAX_PINNED_CHATS = 9;

  const handleTogglePin = useCallback(
    (chatId: number) => {
      const result = togglePinInStore(chatId, MAX_PINNED_CHATS);
      if (!result.ok && result.error) {
        showToast(result.error, "error");
      }
    },
    [showToast, togglePinInStore],
  );

  const reorderPinnedChats = useCallback(
    (newOrder: number[]) => {
      reorderPinnedInStore(newOrder);
    },
    [reorderPinnedInStore],
  );

  const toggleUnread = useCallback(
    (chatId: number) => {
      toggleUnreadInStore(chatId);
    },
    [toggleUnreadInStore],
  );

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((prev) => {
      const newWidth = Math.max(
        MIN_CHAT_LIST_WIDTH,
        Math.min(MAX_CHAT_LIST_WIDTH, prev + delta)
      );
      localStorage.setItem("chatListWidth", String(newWidth));
      return newWidth;
    });
  }, []);

  const handleAiPanelResize = useCallback((delta: number) => {
    setAiPanelWidth((prev) => {
      const newWidth = Math.max(
        MIN_AI_PANEL_WIDTH,
        Math.min(MAX_AI_PANEL_WIDTH, prev - delta) // Note: negative delta because we're resizing from left edge
      );
      localStorage.setItem("aiPanelWidth", String(newWidth));
      return newWidth;
    });
  }, []);

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Chat List */}
      <div
        className="bg-white dark:bg-gray-800 flex flex-col"
        style={{ width: `${chatListWidth}px`, flexShrink: 0 }}
      >
        {loading && (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400">Loading chats...</div>
        )}

        {chatListError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            {chatListError}
          </div>
        )}

        {!loading && !chatListError && (
          <ChatList
            ref={chatListRef}
            chats={chats}
            selectedChat={selectedChat}
            onSelectChat={handleChatSelect}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onLoadMore={() => chatsQuery.fetchNextPage()}
            hasMore={hasMore}
            loadingMore={loadingMore}
            pinnedChatIds={pinnedChatIds}
            pinnedChatOrder={pinnedChatOrder}
            onTogglePin={handleTogglePin}
            onReorderPinned={reorderPinnedChats}
            unreadChatIds={unreadChatIds}
            seenUnreadChatIds={seenUnreadChatIds}
            onToggleUnread={toggleUnread}
          />
        )}
      </div>

      {/* Resizable border between chat list and message view */}
      <ResizableBorder onResize={handleChatListResize} />

      {/* Message View */}
      <div className="flex-1 flex">
        {selectedChat ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 z-10 p-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-2xl border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                    {selectedChat.display_name}
                  </h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Call and FaceTime buttons - only for phone numbers */}
                {!selectedChat.is_group &&
                  (() => {
                    const primaryHandle = selectedChat.handles[0] || "";
                    const isPhone =
                      primaryHandle.startsWith("+") ||
                      /^\d+$/.test(primaryHandle);
                    if (!isPhone) return null;
                    return (
                      <>
                        <a
                          href={`tel:${primaryHandle}`}
                          ref={callLinkRef}
                          className={`w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors`}
                          title="Call"
                        >
                          <svg
                            className="w-5 h-5 text-blue-600 dark:text-blue-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                            />
                          </svg>
                        </a>
                        <a
                          href={`facetime:${primaryHandle}`}
                          ref={facetimeLinkRef}
                          className={`w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors`}
                          title="FaceTime"
                        >
                          <svg
                            className="w-5 h-5 text-blue-600 dark:text-blue-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        </a>
                      </>
                    );
                  })()}
                {!selectedChat.is_group && (
                  <button
                    onClick={() => setShowContactCard(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors"
                    title="Contact info"
                  >
                    <svg
                      className="w-5 h-5 text-blue-600 dark:text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </button>
                )}
                <button
                  onClick={handleToggleAssistPanel}
                  className={`w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors ${
                    assistState.isOpen
                      ? "ring-2 ring-blue-400 ring-offset-1 dark:ring-blue-500"
                      : ""
                  }`}
                  title={assistState.isOpen ? "Hide AI panel" : "Show AI panel"}
                >
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 8h10M7 12h4m-6 8l4-4H19a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v11a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <MessageView
              ref={messageViewRef}
              messages={messages}
              onLoadOlder={loadOlderMessages}
              hasMoreMessages={hasMoreMessages}
              loadingOlder={loadingOlderMessages}
              totalMessages={totalMessages}
              isGroup={selectedChat.is_group}
            />

            {/* Compose box */}
            <div className="flex-shrink-0">
              <ComposeBox
                ref={composeBoxRef}
                messageText={messageText}
                setMessageText={setMessageText}
                onSend={handleSend}
                onSendAttachment={handleSendAttachment}
                sending={sending}
                suggestionCache={suggestionCache}
                onAcceptSuggestion={handleAcceptSuggestion}
                onEscape={handleComposeEscape}
                onTabAction={handleTabAction}
                chats={chats}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
            Select a chat to view messages
          </div>
        )}
        {selectedChat && assistState.isOpen && (
          <>
            {/* Resizable border between message view and AI panel */}
            <ResizableBorder onResize={handleAiPanelResize} />
            <AiAssistPanel
              ref={assistPanelRef}
              isOpen={assistState.isOpen}
              chatName={selectedChat.display_name}
              input={assistState.input}
              history={assistState.history}
              pending={assistState.pending}
              error={assistState.error}
              drafts={assistState.drafts}
              generatingDrafts={assistState.generatingDrafts}
              width={aiPanelWidth}
              onInputChange={handleAssistInputChange}
              onSubmit={handleAssistSubmit}
              onInsertDraft={handleInsertDraft}
              onToggle={handleToggleAssistPanel}
            />
          </>
        )}
      </div>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${
            toast.type === "success" ? "bg-green-600 dark:bg-green-700" : "bg-red-600 dark:bg-red-700"
          } text-white max-w-md`}
        >
          {toast.message}
        </div>
      )}

      {/* Contact Card Modal */}
      {showContactCard && selectedChat && !selectedChat.is_group && (
        <ContactCard
          chat={selectedChat}
          onClose={() => setShowContactCard(false)}
        />
      )}

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        commands={commandPaletteItems}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
}

export default App;
