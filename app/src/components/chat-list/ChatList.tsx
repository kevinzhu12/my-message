import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Chat } from "../../types";
import ChatListContextMenu from "./ChatListContextMenu";
import ChatListEmptyState from "./ChatListEmptyState";
import ChatListSearch from "./ChatListSearch";
import useChatKeyboardNav from "./hooks/useChatKeyboardNav";
import useChatSearch from "./hooks/useChatSearch";
import useChatSwipe from "./hooks/useChatSwipe";
import useInfiniteScroll from "./hooks/useInfiniteScroll";
import PinnedChatGrid from "./PinnedChatGrid";
import SwipeableChatItem from "./SwipeableChatItem";
import UnreadSection from "./UnreadSection";
import {
  getPinnedChats,
  getUnpinnedChats,
  getUnreadChats,
} from "./utils/chatListSelectors";

export interface ChatListRef {
  focusSearch: () => void;
  scrollToChat: (chatId: number) => void;
  focusSelectedChat: () => void;
}

interface ChatListProps {
  chats: Chat[];
  selectedChat: Chat | null;
  onSelectChat: (chat: Chat) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  pinnedChatIds: Set<number>;
  pinnedChatOrder: number[];
  onTogglePin: (chatId: number) => void;
  onReorderPinned: (newOrder: number[]) => void;
  unreadChatIds: Set<number>;
  seenUnreadChatIds: Set<number>;
  onToggleUnread: (chatId: number) => void;
}

const ChatList = forwardRef<ChatListRef, ChatListProps>(
  (
    {
      chats,
      selectedChat,
      onSelectChat,
      searchQuery,
      onSearchChange,
      onLoadMore,
      hasMore,
      loadingMore,
      pinnedChatIds,
      pinnedChatOrder,
      onTogglePin,
      onReorderPinned,
      unreadChatIds,
      seenUnreadChatIds,
      onToggleUnread,
    },
    ref,
  ) => {
    const [contextMenu, setContextMenu] = useState<{
      chatId: number;
      x: number;
      y: number;
    } | null>(null);
    const [keyboardFocusedChatId, setKeyboardFocusedChatId] = useState<
      number | null
    >(null);
    const observerTarget = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const scrollToChatId = useCallback((chatId: number) => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) return;
      try {
        const selector = `[data-chat-id="${chatId}"]`;
        const target = scrollContainer.querySelector(
          selector,
        ) as HTMLElement | null;
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "center" });
        }
      } catch {
        return;
      }
    }, []);

    const focusChatId = useCallback(
      (chatId: number) => {
        scrollToChatId(chatId);
        const scrollContainer = scrollContainerRef.current;
        if (!scrollContainer) return;
        try {
          const selector = `[data-chat-id="${chatId}"]`;
          const target = scrollContainer.querySelector(
            selector,
          ) as HTMLElement | null;
          if (target) {
            target.focus();
          }
        } catch {
          return;
        }
      },
      [scrollToChatId],
    );

    const {
      searchResults,
      isSearching,
      hasSearched,
      searchActiveIndex,
      setSearchActiveIndex,
      isActiveSearch,
      findSearchIndex,
    } = useChatSearch({ query: searchQuery, scrollToChatId });

    const {
      revealedChatId,
      setRevealedChatId,
      activeSwipeChatId,
      activeSwipeOffset,
      handleSwipeOffset,
      handleSwipeEnd,
    } = useChatSwipe();

    const displayChats = isActiveSearch ? searchResults : chats;

    const pinnedChats = useMemo(
      () =>
        isActiveSearch
          ? []
          : getPinnedChats(displayChats, pinnedChatIds, pinnedChatOrder),
      [displayChats, isActiveSearch, pinnedChatIds, pinnedChatOrder],
    );

    const unreadChats = useMemo(
      () => (isActiveSearch ? [] : getUnreadChats(displayChats, unreadChatIds)),
      [displayChats, isActiveSearch, unreadChatIds],
    );

    const unpinnedChats = useMemo(
      () =>
        isActiveSearch
          ? displayChats
          : getUnpinnedChats(displayChats, pinnedChatIds),
      [displayChats, isActiveSearch, pinnedChatIds],
    );

    const handleArrowNavigate = useChatKeyboardNav({
      isActiveSearch,
      searchResults,
      unpinnedChats,
      searchActiveIndex,
      setSearchActiveIndex,
      selectedChatId: selectedChat?.id ?? null,
      keyboardFocusedChatId,
      setKeyboardFocusedChatId,
      focusChatId,
    });

    useInfiniteScroll({
      rootRef: scrollContainerRef,
      targetRef: observerTarget,
      hasMore,
      loadingMore,
      onLoadMore,
    });

    useImperativeHandle(
      ref,
      () => ({
        focusSearch: () => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
            const length = searchInputRef.current.value.length;
            searchInputRef.current.setSelectionRange(length, length);
          }
        },
        scrollToChat: (chatId: number) => {
          scrollToChatId(chatId);
        },
        focusSelectedChat: () => {
          if (!selectedChat) return;
          let targetChatId = selectedChat.id;
          if (isActiveSearch) {
            const index = findSearchIndex(selectedChat.id);
            if (index >= 0) {
              setSearchActiveIndex(index);
            } else if (searchResults.length > 0) {
              const firstResult = searchResults[0];
              if (firstResult) {
                setSearchActiveIndex(0);
                targetChatId = firstResult.id;
              }
            }
          }
          setKeyboardFocusedChatId(targetChatId);
          focusChatId(targetChatId);
        },
      }),
      [
        findSearchIndex,
        focusChatId,
        isActiveSearch,
        scrollToChatId,
        searchResults,
        selectedChat,
        setSearchActiveIndex,
      ],
    );

    useEffect(() => {
      const handleClick = () => setContextMenu(null);
      if (contextMenu) {
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
      }
    }, [contextMenu]);

    const handleSelectChat = useCallback(
      (chat: Chat) => {
        setKeyboardFocusedChatId(null);
        if (isActiveSearch) {
          const index = findSearchIndex(chat.id);
          if (index >= 0) {
            setSearchActiveIndex(index);
          }
        }
        onSelectChat(chat);
      },
      [findSearchIndex, isActiveSearch, onSelectChat, setSearchActiveIndex],
    );

    const handleSearchEscape = useCallback(() => {
      requestAnimationFrame(() => {
        if (!selectedChat) return;
        focusChatId(selectedChat.id);
      });
    }, [focusChatId, selectedChat]);

    const handleSearchReturn = useCallback(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }, []);

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatListSearch
          ref={searchInputRef}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          isActiveSearch={isActiveSearch}
          searchResults={searchResults}
          searchActiveIndex={searchActiveIndex}
          setSearchActiveIndex={setSearchActiveIndex}
          onSelectChat={handleSelectChat}
          onEscape={handleSearchEscape}
        />

        {pinnedChats.length > 0 && !searchQuery && (
          <PinnedChatGrid
            pinnedChats={pinnedChats}
            pinnedChatOrder={pinnedChatOrder}
            selectedChatId={selectedChat?.id ?? null}
            unreadChatIds={unreadChatIds}
            seenUnreadChatIds={seenUnreadChatIds}
            onSelectChat={handleSelectChat}
            onContextMenu={(chatId, x, y) => setContextMenu({ chatId, x, y })}
            onReorderPinned={onReorderPinned}
          />
        )}

        {!searchQuery && (
          <UnreadSection
            unreadChats={unreadChats}
            selectedChatId={selectedChat?.id ?? null}
            seenUnreadChatIds={seenUnreadChatIds}
            keyboardFocusedChatId={keyboardFocusedChatId}
            revealedChatId={revealedChatId}
            activeSwipeChatId={activeSwipeChatId}
            activeSwipeOffset={activeSwipeOffset}
            onReveal={setRevealedChatId}
            onSwipeOffset={handleSwipeOffset}
            onSwipeEnd={handleSwipeEnd}
            onSelectChat={handleSelectChat}
            onContextMenu={(chatId, x, y) => setContextMenu({ chatId, x, y })}
            onToggleUnread={onToggleUnread}
            onArrowNavigate={handleArrowNavigate}
          />
        )}

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {!searchQuery && (
            <div className="px-4 py-2 flex items-center justify-between bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                All Messages
              </span>
            </div>
          )}

          {isActiveSearch && isSearching && (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              Searching...
            </div>
          )}

          <ChatListEmptyState
            isSearching={isSearching}
            isActiveSearch={isActiveSearch}
            hasSearched={hasSearched}
            searchQuery={searchQuery}
            unpinnedCount={unpinnedChats.length}
            pinnedCount={pinnedChats.length}
            unreadCount={unreadChats.length}
          />

          {!isSearching &&
            unpinnedChats.length > 0 &&
            unpinnedChats.map((chat, index) => {
              const isUnread = unreadChatIds.has(chat.id);
              const isSeen = seenUnreadChatIds.has(chat.id);
              const isKeyboardFocused = isActiveSearch
                ? searchActiveIndex === index
                : keyboardFocusedChatId === chat.id;
              return (
                <SwipeableChatItem
                  key={chat.id}
                  chat={chat}
                  isSelected={selectedChat?.id === chat.id}
                  isUnread={isUnread}
                  isSeen={isSeen}
                  isKeyboardFocused={isKeyboardFocused}
                  isRevealed={revealedChatId === chat.id}
                  activeSwipeChatId={activeSwipeChatId}
                  activeSwipeOffset={activeSwipeOffset}
                  onReveal={setRevealedChatId}
                  onSwipeOffset={handleSwipeOffset}
                  onSwipeEnd={handleSwipeEnd}
                  onSelect={() => handleSelectChat(chat)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      chatId: chat.id,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onToggleUnread={onToggleUnread}
                  onArrowNavigate={handleArrowNavigate}
                  onEscapeToSearch={
                    isActiveSearch ? handleSearchReturn : undefined
                  }
                />
              );
            })}

          {!isActiveSearch && hasMore && (
            <div ref={observerTarget} className="p-4 text-center">
              {loadingMore ? (
                <div className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4 text-blue-500 dark:text-blue-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
                </div>
              ) : (
                <span className="text-sm text-gray-400 dark:text-gray-500">Scroll for more</span>
              )}
            </div>
          )}

          {!isActiveSearch && !hasMore && chats.length > 0 && (
            <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">
              All chats loaded
            </div>
          )}

          {isActiveSearch &&
            hasSearched &&
            !isSearching &&
            searchResults.length > 0 && (
              <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">
                {searchResults.length} result
                {searchResults.length !== 1 ? "s" : ""} found
              </div>
            )}
        </div>

        {contextMenu && (
          <ChatListContextMenu
            chatId={contextMenu.chatId}
            x={contextMenu.x}
            y={contextMenu.y}
            isPinned={pinnedChatIds.has(contextMenu.chatId)}
            onTogglePin={onTogglePin}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  },
);

ChatList.displayName = "ChatList";

export default ChatList;
