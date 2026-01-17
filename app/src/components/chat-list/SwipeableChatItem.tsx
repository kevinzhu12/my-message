import { memo, useEffect, useRef } from "react";
import type { Chat } from "../../types";
import ChatAvatar from "./ChatAvatar";
import {
  ACTION_WIDTH,
  OVERDRAG_MAX,
  OVERDRAG_RESISTANCE,
  SWIPE_SENSITIVITY,
} from "./constants";
import { formatLastMessage, formatTime } from "./utils/chatListFormatters";

function SwipeableChatItemComponent({
  chat,
  isSelected,
  isUnread,
  isSeen,
  isKeyboardFocused,
  isRevealed,
  activeSwipeChatId,
  activeSwipeOffset,
  onReveal,
  onSwipeOffset,
  onSwipeEnd,
  onSelect,
  onContextMenu,
  onToggleUnread,
  onArrowNavigate,
  onEscapeToSearch,
}: {
  chat: Chat;
  isSelected: boolean;
  isUnread: boolean;
  isSeen: boolean;
  isKeyboardFocused: boolean;
  isRevealed: boolean;
  activeSwipeChatId: number | null;
  activeSwipeOffset: number;
  onReveal: (chatId: number | null) => void;
  onSwipeOffset: (chatId: number, offset: number) => void;
  onSwipeEnd: (chatId: number, shouldOpen: boolean) => void;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleUnread: (chatId: number) => void;
  onArrowNavigate: (delta: number) => void;
  onEscapeToSearch?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef(chat.id);
  const swipeOffsetRef = useRef(0);
  const snapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    chatIdRef.current = chat.id;
  }, [chat.id]);

  const effectiveOffset =
    activeSwipeChatId === chat.id
      ? activeSwipeOffset
      : isRevealed
        ? ACTION_WIDTH
        : 0;
  const isActiveSwipe = activeSwipeChatId === chat.id;
  const actionWidth = Math.max(0, effectiveOffset);

  useEffect(() => {
    swipeOffsetRef.current = effectiveOffset;
  }, [effectiveOffset]);

  useEffect(() => {
    return () => {
      if (snapTimerRef.current) {
        clearTimeout(snapTimerRef.current);
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;

      e.preventDefault();
      e.stopPropagation();

      const proposed = swipeOffsetRef.current - e.deltaX * SWIPE_SENSITIVITY;
      let nextOffset = Math.max(0, proposed);
      if (nextOffset > ACTION_WIDTH) {
        const overdrag = (nextOffset - ACTION_WIDTH) * OVERDRAG_RESISTANCE;
        nextOffset = Math.min(
          ACTION_WIDTH + OVERDRAG_MAX,
          ACTION_WIDTH + overdrag,
        );
      }
      swipeOffsetRef.current = nextOffset;
      pendingOffsetRef.current = nextOffset;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingOffsetRef.current !== null) {
            const target = pendingOffsetRef.current;
            pendingOffsetRef.current = null;
            onSwipeOffset(chatIdRef.current, target);
          }
        });
      }

      if (snapTimerRef.current) {
        clearTimeout(snapTimerRef.current);
      }
      snapTimerRef.current = setTimeout(() => {
        const shouldOpen = swipeOffsetRef.current > ACTION_WIDTH / 2;
        const snappedOffset = shouldOpen ? ACTION_WIDTH : 0;
        swipeOffsetRef.current = snappedOffset;
        onSwipeOffset(chatIdRef.current, snappedOffset);
        onSwipeEnd(chatIdRef.current, shouldOpen);
      }, 120);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [onSwipeOffset, onSwipeEnd]);

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleUnread(chat.id);
    swipeOffsetRef.current = 0;
    onSwipeOffset(chat.id, 0);
    onSwipeEnd(chat.id, false);
    onReveal(null);
  };

  const handleClick = () => {
    if (effectiveOffset > 0) {
      swipeOffsetRef.current = 0;
      onSwipeOffset(chat.id, 0);
      onSwipeEnd(chat.id, false);
      onReveal(null);
      return;
    }
    onSelect();
  };

  const showBold = isUnread && !isSeen;

  const keyboardFocusClass =
    isKeyboardFocused && !isSelected
      ? "ring-2 ring-blue-300 dark:ring-blue-500 ring-inset bg-blue-50/70 dark:bg-blue-900/30 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]"
      : "";

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden focus:outline-none focus-visible:outline-none focus:ring-0"
      data-chat-id={chat.id}
      tabIndex={isSelected ? 0 : -1}
      aria-selected={isSelected}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onEscapeToSearch) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeToSearch();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onArrowNavigate(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          onArrowNavigate(-1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 overflow-hidden ${
          isUnread ? "bg-blue-500" : "bg-orange-500"
        }`}
        style={{
          width: `${actionWidth}px`,
          opacity: effectiveOffset > 0 ? 1 : 0,
        }}
      >
        <button
          onClick={handleActionClick}
          className="w-20 h-full flex flex-col items-center justify-center text-white text-xs font-medium px-2"
        >
          {isUnread ? (
            <>
              <svg
                className="w-5 h-5 mb-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76"
                />
              </svg>
              <span>Read</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5 mb-1"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="5" />
              </svg>
              <span>Unread</span>
            </>
          )}
        </button>
      </div>

      <div
        className={`mx-1 p-4 border-b border-gray-100 dark:border-gray-700 border-l-4 rounded-xl cursor-pointer ${keyboardFocusClass} ${
          isSelected
            ? "bg-blue-100 dark:bg-blue-900/40 border-l-blue-600 dark:border-l-blue-500 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.18)]"
            : "bg-white dark:bg-gray-700/50 border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-700"
        }`}
        style={{
          transform: `translateX(${effectiveOffset}px)`,
          transition: isActiveSwipe ? "none" : "transform 0.2s ease-out",
        }}
        onClick={handleClick}
        onContextMenu={onContextMenu}
      >
        <div className="flex items-start gap-3">
          <ChatAvatar
            handle={chat.handles[0]}
            displayName={chat.display_name}
            isGroup={chat.is_group}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <h3
                  className={`truncate ${
                    showBold
                      ? "text-black dark:text-white font-bold"
                      : "text-gray-900 dark:text-gray-100 font-semibold"
                  }`}
                >
                  {chat.display_name}
                </h3>
              </div>
              <span
                className={`text-xs ml-2 flex-shrink-0 ${
                  showBold ? "text-blue-500 dark:text-blue-400 font-bold" : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {formatTime(chat.last_message_time)}
              </span>
            </div>
            <p
              className={`text-sm truncate mt-1 ${
                showBold ? "text-gray-900 dark:text-gray-100 font-bold" : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {formatLastMessage(chat)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const SwipeableChatItem = memo(SwipeableChatItemComponent, (prev, next) => {
  if (prev.chat.id !== next.chat.id) return false;
  if (prev.chat.display_name !== next.chat.display_name) return false;
  if (prev.chat.last_message_text !== next.chat.last_message_text) return false;
  if (prev.chat.last_message_time !== next.chat.last_message_time) return false;
  if (prev.chat.last_message_is_from_me !== next.chat.last_message_is_from_me) {
    return false;
  }
  if (prev.chat.is_group !== next.chat.is_group) return false;
  if (prev.chat.chat_identifier !== next.chat.chat_identifier) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isUnread !== next.isUnread) return false;
  if (prev.isSeen !== next.isSeen) return false;
  if (prev.isKeyboardFocused !== next.isKeyboardFocused) return false;
  if (prev.isRevealed !== next.isRevealed) return false;

  const prevActive = prev.activeSwipeChatId === prev.chat.id;
  const nextActive = next.activeSwipeChatId === next.chat.id;
  if (prevActive !== nextActive) return false;
  if (
    prevActive &&
    nextActive &&
    prev.activeSwipeOffset !== next.activeSwipeOffset
  ) {
    return false;
  }

  return true;
});

export default SwipeableChatItem;
