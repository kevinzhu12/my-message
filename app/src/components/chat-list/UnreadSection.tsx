import { useState } from "react";
import type { Chat } from "../../types";
import { UNREAD_COLLAPSED_COUNT } from "./constants";
import SwipeableChatItem from "./SwipeableChatItem";

interface UnreadSectionProps {
  unreadChats: Chat[];
  selectedChatId: number | null;
  seenUnreadChatIds: Set<number>;
  keyboardFocusedChatId: number | null;
  revealedChatId: number | null;
  activeSwipeChatId: number | null;
  activeSwipeOffset: number;
  onReveal: (chatId: number | null) => void;
  onSwipeOffset: (chatId: number, offset: number) => void;
  onSwipeEnd: (chatId: number, shouldOpen: boolean) => void;
  onSelectChat: (chat: Chat) => void;
  onContextMenu: (chatId: number, x: number, y: number) => void;
  onToggleUnread: (chatId: number) => void;
  onArrowNavigate: (delta: number) => void;
}

const UnreadSection = ({
  unreadChats,
  selectedChatId,
  seenUnreadChatIds,
  keyboardFocusedChatId,
  revealedChatId,
  activeSwipeChatId,
  activeSwipeOffset,
  onReveal,
  onSwipeOffset,
  onSwipeEnd,
  onSelectChat,
  onContextMenu,
  onToggleUnread,
  onArrowNavigate,
}: UnreadSectionProps) => {
  const [isUnreadExpanded, setIsUnreadExpanded] = useState(false);

  return (
    <div className="border-b-2 border-gray-300 dark:border-gray-700 shadow-sm">
      <div className="px-4 py-2 flex items-center justify-between bg-gray-50 dark:bg-gray-700/50">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Unread Messages
        </span>
        {unreadChats.length > UNREAD_COLLAPSED_COUNT && (
          <button
            onClick={() => setIsUnreadExpanded(!isUnreadExpanded)}
            className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
          >
            {isUnreadExpanded
              ? "Show less"
              : `+${unreadChats.length - UNREAD_COLLAPSED_COUNT} more`}
          </button>
        )}
      </div>
      {unreadChats.length > 0 && (
        <div
          className={`overflow-y-auto transition-all duration-200 ${
            isUnreadExpanded ? "max-h-80" : ""
          }`}
        >
          {(isUnreadExpanded
            ? unreadChats
            : unreadChats.slice(0, UNREAD_COLLAPSED_COUNT)
          ).map((chat) => {
            const isSeen = seenUnreadChatIds.has(chat.id);
            const isKeyboardFocused = keyboardFocusedChatId === chat.id;
            return (
              <SwipeableChatItem
                key={chat.id}
                chat={chat}
                isSelected={selectedChatId === chat.id}
                isUnread={true}
                isSeen={isSeen}
                isKeyboardFocused={isKeyboardFocused}
                isRevealed={revealedChatId === chat.id}
                activeSwipeChatId={activeSwipeChatId}
                activeSwipeOffset={activeSwipeOffset}
                onReveal={onReveal}
                onSwipeOffset={onSwipeOffset}
                onSwipeEnd={onSwipeEnd}
                onSelect={() => onSelectChat(chat)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu(chat.id, e.clientX, e.clientY);
                }}
                onToggleUnread={onToggleUnread}
                onArrowNavigate={onArrowNavigate}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UnreadSection;
