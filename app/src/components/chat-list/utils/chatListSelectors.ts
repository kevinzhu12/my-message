import type { Chat } from "../../../types";

export const getPinnedChats = (
  chats: Chat[],
  pinnedChatIds: Set<number>,
  pinnedChatOrder: number[],
) =>
  chats
    .filter((chat) => pinnedChatIds.has(chat.id))
    .sort((a, b) => {
      const indexA = pinnedChatOrder.indexOf(a.id);
      const indexB = pinnedChatOrder.indexOf(b.id);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

export const getUnreadChats = (chats: Chat[], unreadChatIds: Set<number>) =>
  chats.filter((chat) => unreadChatIds.has(chat.id));

export const getUnpinnedChats = (chats: Chat[], pinnedChatIds: Set<number>) =>
  chats.filter((chat) => !pinnedChatIds.has(chat.id));
