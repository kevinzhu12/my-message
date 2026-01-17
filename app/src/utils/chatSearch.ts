import type { Chat } from "../types";

export function findChatBySearchTerm(chats: Chat[], searchTerm?: string | null): Chat | undefined {
  if (!searchTerm) return undefined;
  const searchLower = searchTerm.toLowerCase();
  return chats.find((chat) =>
    chat.display_name.toLowerCase().includes(searchLower)
  );
}
