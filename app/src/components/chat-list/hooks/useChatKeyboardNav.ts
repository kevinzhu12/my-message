import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { Chat } from "../../../types";

interface UseChatKeyboardNavOptions {
  isActiveSearch: boolean;
  searchResults: Chat[];
  unpinnedChats: Chat[];
  searchActiveIndex: number;
  setSearchActiveIndex: Dispatch<SetStateAction<number>>;
  selectedChatId: number | null;
  keyboardFocusedChatId: number | null;
  setKeyboardFocusedChatId: Dispatch<SetStateAction<number | null>>;
  focusChatId: (chatId: number) => void;
}

const useChatKeyboardNav = ({
  isActiveSearch,
  searchResults,
  unpinnedChats,
  searchActiveIndex,
  setSearchActiveIndex,
  selectedChatId,
  keyboardFocusedChatId,
  setKeyboardFocusedChatId,
  focusChatId,
}: UseChatKeyboardNavOptions) =>
  useCallback(
    (delta: number) => {
      const list = isActiveSearch ? searchResults : unpinnedChats;
      if (list.length === 0) return;
      let currentIndex = -1;
      if (isActiveSearch) {
        currentIndex =
          searchActiveIndex >= 0
            ? searchActiveIndex
            : list.findIndex(
                (chat) => chat.id === (keyboardFocusedChatId ?? selectedChatId),
              );
      } else {
        const currentId = keyboardFocusedChatId ?? selectedChatId;
        if (!currentId) return;
        currentIndex = list.findIndex((chat) => chat.id === currentId);
      }
      const nextIndex =
        currentIndex >= 0
          ? currentIndex + delta
          : delta > 0
            ? 0
            : list.length - 1;
      if (nextIndex < 0 || nextIndex >= list.length) return;
      const nextChat = list[nextIndex];
      if (!nextChat) return;
      if (isActiveSearch) {
        setSearchActiveIndex(nextIndex);
      }
      setKeyboardFocusedChatId(nextChat.id);
      focusChatId(nextChat.id);
    },
    [
      focusChatId,
      isActiveSearch,
      keyboardFocusedChatId,
      searchActiveIndex,
      searchResults,
      selectedChatId,
      setKeyboardFocusedChatId,
      setSearchActiveIndex,
      unpinnedChats,
    ],
  );

export default useChatKeyboardNav;
