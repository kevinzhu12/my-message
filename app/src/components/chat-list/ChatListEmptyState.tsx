interface ChatListEmptyStateProps {
  isSearching: boolean;
  isActiveSearch: boolean;
  hasSearched: boolean;
  searchQuery: string;
  unpinnedCount: number;
  pinnedCount: number;
  unreadCount: number;
}

const ChatListEmptyState = ({
  isSearching,
  isActiveSearch,
  hasSearched,
  searchQuery,
  unpinnedCount,
  pinnedCount,
  unreadCount,
}: ChatListEmptyStateProps) => {
  if (isSearching) return null;

  if (unpinnedCount === 0 && pinnedCount === 0 && unreadCount === 0) {
    const message = isActiveSearch
      ? hasSearched
        ? `No chats found for "${searchQuery}"`
        : "Type to search all chats..."
      : "No chats found";
    return (
      <div className="p-4 text-center text-gray-500 text-sm">{message}</div>
    );
  }

  if (unpinnedCount === 0 && (pinnedCount > 0 || unreadCount > 0)) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        No other chats
      </div>
    );
  }

  return null;
};

export default ChatListEmptyState;
