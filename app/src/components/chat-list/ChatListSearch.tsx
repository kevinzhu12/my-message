import type { Dispatch, SetStateAction } from "react";
import { forwardRef } from "react";
import type { Chat } from "../../types";

interface ChatListSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isActiveSearch: boolean;
  searchResults: Chat[];
  searchActiveIndex: number;
  setSearchActiveIndex: Dispatch<SetStateAction<number>>;
  onSelectChat: (chat: Chat) => void;
  onEscape: () => void;
}

const ChatListSearch = forwardRef<HTMLInputElement, ChatListSearchProps>(
  (
    {
      searchQuery,
      onSearchChange,
      isActiveSearch,
      searchResults,
      searchActiveIndex,
      setSearchActiveIndex,
      onSelectChat,
      onEscape,
    },
    ref,
  ) => (
    <div className="p-3 border-b border-gray-200 dark:border-gray-700">
      <input
        ref={ref}
        type="text"
        placeholder="Search"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onSearchChange("");
            e.currentTarget.blur();
            onEscape();
            return;
          }

          if (!isActiveSearch || searchResults.length === 0) {
            return;
          }

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSearchActiveIndex((prev) => {
              const next = prev < 0 ? 0 : prev + 1;
              return Math.min(next, searchResults.length - 1);
            });
            return;
          }

          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSearchActiveIndex((prev) => {
              const next = prev < 0 ? 0 : prev - 1;
              return Math.max(next, 0);
            });
            return;
          }

          if (e.key === "Enter") {
            e.preventDefault();
            const index = searchActiveIndex >= 0 ? searchActiveIndex : 0;
            const target = searchResults[index];
            if (target) {
              onSelectChat(target);
            }
          }
        }}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
      />
    </div>
  ),
);

ChatListSearch.displayName = "ChatListSearch";

export default ChatListSearch;
