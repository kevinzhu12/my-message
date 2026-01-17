import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { Chat } from "../types";

type ChatState = {
  selectedChatId: number | null;
  error: string | null;
  pinnedChatIds: Set<number>;
  pinnedChatOrder: number[];
  unreadChatIds: Set<number>;
  seenUnreadChatIds: Set<number>;
};

type ChatActions = {
  ingestChats: (chats: Chat[]) => void;
  selectChat: (chat: Chat) => { wasUnread: boolean };
  togglePin: (
    chatId: number,
    maxPinned: number,
  ) => { ok: boolean; error?: string };
  reorderPinned: (newOrder: number[]) => void;
  toggleUnread: (chatId: number) => void;
  setError: (error: string | null) => void;
};

type ChatStore = {
  state: ChatState;
  actions: ChatActions;
};

type Action =
  | { type: "set_selected"; chatId: number | null }
  | {
      type: "set_pinned";
      pinnedChatIds: Set<number>;
      pinnedChatOrder: number[];
    }
  | {
      type: "set_unread_state";
      unreadChatIds: Set<number>;
      seenUnreadChatIds: Set<number>;
    }
  | { type: "set_error"; error: string | null };

const readPinnedFromStorage = () => {
  try {
    const saved = localStorage.getItem("pinnedChats");
    if (!saved) {
      return { pinnedChatIds: new Set<number>(), pinnedChatOrder: [] };
    }
    const ids = JSON.parse(saved) as number[];
    return { pinnedChatIds: new Set(ids), pinnedChatOrder: ids };
  } catch {
    return { pinnedChatIds: new Set<number>(), pinnedChatOrder: [] };
  }
};

const initState = (): ChatState => {
  const { pinnedChatIds, pinnedChatOrder } = readPinnedFromStorage();
  return {
    selectedChatId: null,
    error: null,
    pinnedChatIds,
    pinnedChatOrder,
    unreadChatIds: new Set(),
    seenUnreadChatIds: new Set(),
  };
};

const reducer = (state: ChatState, action: Action): ChatState => {
  switch (action.type) {
    case "set_selected":
      return {
        ...state,
        selectedChatId: action.chatId,
      };
    case "set_pinned":
      return {
        ...state,
        pinnedChatIds: action.pinnedChatIds,
        pinnedChatOrder: action.pinnedChatOrder,
      };
    case "set_unread_state":
      return {
        ...state,
        unreadChatIds: action.unreadChatIds,
        seenUnreadChatIds: action.seenUnreadChatIds,
      };
    case "set_error":
      return {
        ...state,
        error: action.error,
      };
    default:
      return state;
  }
};

const ChatStoreContext = createContext<ChatStore | null>(null);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const lastMessageTimesRef = useRef<Map<number, number>>(new Map());
  const selectedChatIdRef = useRef<number | null>(null);

  useEffect(() => {
    selectedChatIdRef.current = state.selectedChatId;
  }, [state.selectedChatId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "pinnedChats",
        JSON.stringify(state.pinnedChatOrder),
      );
    } catch {
      // Ignore persistence failures.
    }
  }, [state.pinnedChatOrder]);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: "set_error", error });
  }, []);

  const ingestChats = useCallback(
    (chats: Chat[]) => {
      if (chats.length === 0) return;

      const newUnread = new Set<number>();
      chats.forEach((chat) => {
        if (!chat.last_message_time) return;
        const lastKnown = lastMessageTimesRef.current.get(chat.id);
        if (lastKnown && chat.last_message_time > lastKnown) {
          if (
            selectedChatIdRef.current !== chat.id &&
            !chat.last_message_is_from_me
          ) {
            newUnread.add(chat.id);
          }
          lastMessageTimesRef.current.set(chat.id, chat.last_message_time);
          return;
        }
        if (!lastKnown) {
          lastMessageTimesRef.current.set(chat.id, chat.last_message_time);
        }
      });

      if (newUnread.size === 0) return;

      const mergedUnread = new Set(state.unreadChatIds);
      newUnread.forEach((id) => {
        mergedUnread.add(id);
      });
      dispatch({
        type: "set_unread_state",
        unreadChatIds: mergedUnread,
        seenUnreadChatIds: state.seenUnreadChatIds,
      });
    },
    [state.seenUnreadChatIds, state.unreadChatIds],
  );

  const selectChat = useCallback(
    (chat: Chat) => {
      const wasUnread = state.unreadChatIds.has(chat.id);
      const nextUnread = new Set(state.unreadChatIds);
      const nextSeen = new Set(state.seenUnreadChatIds);

      if (state.selectedChatId && state.selectedChatId !== chat.id) {
        if (nextUnread.has(state.selectedChatId)) {
          nextUnread.delete(state.selectedChatId);
          nextSeen.delete(state.selectedChatId);
        }
      }

      if (nextUnread.has(chat.id)) {
        nextSeen.add(chat.id);
      }

      if (chat.last_message_time) {
        lastMessageTimesRef.current.set(chat.id, chat.last_message_time);
      }

      dispatch({ type: "set_selected", chatId: chat.id });
      dispatch({
        type: "set_unread_state",
        unreadChatIds: nextUnread,
        seenUnreadChatIds: nextSeen,
      });

      return { wasUnread };
    },
    [state.selectedChatId, state.seenUnreadChatIds, state.unreadChatIds],
  );

  const togglePin = useCallback(
    (chatId: number, maxPinned: number) => {
      const nextPinned = new Set(state.pinnedChatIds);
      let nextOrder = [...state.pinnedChatOrder];

      if (nextPinned.has(chatId)) {
        nextPinned.delete(chatId);
        nextOrder = nextOrder.filter((id) => id !== chatId);
      } else {
        if (nextPinned.size >= maxPinned) {
          return {
            ok: false,
            error: `Maximum ${maxPinned} pinned chats allowed`,
          };
        }
        nextPinned.add(chatId);
        nextOrder = [...nextOrder, chatId];
      }

      dispatch({
        type: "set_pinned",
        pinnedChatIds: nextPinned,
        pinnedChatOrder: nextOrder,
      });

      return { ok: true };
    },
    [state.pinnedChatIds, state.pinnedChatOrder],
  );

  const reorderPinned = useCallback((newOrder: number[]) => {
    dispatch({
      type: "set_pinned",
      pinnedChatIds: new Set(newOrder),
      pinnedChatOrder: newOrder,
    });
  }, []);

  const toggleUnread = useCallback(
    (chatId: number) => {
      const nextUnread = new Set(state.unreadChatIds);
      const nextSeen = new Set(state.seenUnreadChatIds);

      if (nextUnread.has(chatId)) {
        nextUnread.delete(chatId);
        nextSeen.delete(chatId);
      } else {
        nextUnread.add(chatId);
      }

      dispatch({
        type: "set_unread_state",
        unreadChatIds: nextUnread,
        seenUnreadChatIds: nextSeen,
      });
    },
    [state.seenUnreadChatIds, state.unreadChatIds],
  );

  const actions = useMemo<ChatActions>(
    () => ({
      ingestChats,
      selectChat,
      togglePin,
      reorderPinned,
      toggleUnread,
      setError,
    }),
    [ingestChats, reorderPinned, selectChat, setError, togglePin, toggleUnread],
  );

  const store = useMemo<ChatStore>(
    () => ({ state, actions }),
    [actions, state],
  );

  return (
    <ChatStoreContext.Provider value={store}>
      {children}
    </ChatStoreContext.Provider>
  );
};

export const useChatStore = (): ChatStore => {
  const store = useContext(ChatStoreContext);
  if (!store) {
    throw new Error("useChatStore must be used within ChatProvider");
  }
  return store;
};
