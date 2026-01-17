import type { Chat } from "../../../types";

export const formatTime = (timestamp: number | null) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

export const formatLastMessage = (chat: Chat) => {
  const text = chat.last_message_text;
  if (!text) return "No messages";

  const reactionVerbs = [
    "loved",
    "liked",
    "disliked",
    "laughed at",
    "emphasized",
    "questioned",
  ];

  for (const verb of reactionVerbs) {
    if (text.startsWith(`${verb} `)) {
      const firstName = chat.display_name.split(" ")[0];
      const who = chat.last_message_is_from_me ? "You" : firstName;
      return `${who} ${text}`;
    }
  }

  if (text.startsWith("removed ")) {
    const firstName = chat.display_name.split(" ")[0];
    const who = chat.last_message_is_from_me ? "You" : firstName;
    return `${who} ${text}`;
  }

  return text;
};
