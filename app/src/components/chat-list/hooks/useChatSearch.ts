import { useCallback, useEffect, useRef, useState } from "react";
import { searchChats } from "../../../api";
import type { Chat } from "../../../types";

interface UseChatSearchOptions {
  query: string;
  scrollToChatId: (chatId: number) => void;
}

const useChatSearch = ({ query, scrollToChatId }: UseChatSearchOptions) => {
  const [searchResults, setSearchResults] = useState<Chat[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState<number>(-1);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveSearch = query.trim().length > 0;

  const sanitizeSearchResults = useCallback((results: unknown): Chat[] => {
    if (!Array.isArray(results)) return [];
    return results.filter(
      (chat): chat is Chat =>
        Boolean(chat) && typeof chat === "object" && "id" in chat,
    );
  }, []);

  const findSearchIndex = useCallback(
    (chatId: number) => searchResults.findIndex((chat) => chat.id === chatId),
    [searchResults],
  );

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await searchChats(query.trim(), 200);
        setSearchResults(sanitizeSearchResults(response?.chats));
        setHasSearched(true);
      } catch (error) {
        console.error("Search failed:", error);
        setSearchResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, sanitizeSearchResults]);

  useEffect(() => {
    if (!isActiveSearch || searchResults.length === 0) {
      setSearchActiveIndex(-1);
      return;
    }
    setSearchActiveIndex(0);
  }, [isActiveSearch, searchResults]);

  useEffect(() => {
    if (!isActiveSearch || isSearching) return;
    if (searchActiveIndex < 0 || searchActiveIndex >= searchResults.length) {
      return;
    }
    const chat = searchResults[searchActiveIndex];
    if (!chat) return;
    requestAnimationFrame(() => {
      scrollToChatId(chat.id);
    });
  }, [
    isActiveSearch,
    isSearching,
    scrollToChatId,
    searchActiveIndex,
    searchResults,
  ]);

  return {
    searchResults,
    isSearching,
    hasSearched,
    searchActiveIndex,
    setSearchActiveIndex,
    isActiveSearch,
    findSearchIndex,
  };
};

export default useChatSearch;
