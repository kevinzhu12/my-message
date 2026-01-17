import type { Message } from "../../../types";

export function formatInlineTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimestampDivider(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const diffInDays = Math.floor(
    (today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  let datePrefix: string;
  if (diffInDays === 0) {
    datePrefix = "Today";
  } else if (diffInDays === 1) {
    datePrefix = "Yesterday";
  } else if (diffInDays < 7) {
    datePrefix = date.toLocaleDateString("en-US", { weekday: "long" });
  } else {
    datePrefix = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${datePrefix} ${timeStr}`;
}

export function shouldShowTimestamp(
  currentMessage: Message,
  previousMessage: Message | null,
): boolean {
  if (!previousMessage) {
    return false;
  }

  const currentTime = currentMessage.time;
  const previousTime = previousMessage.time;
  const timeDiff = Math.abs(currentTime - previousTime);

  const thirtyMinutes = 30 * 60 * 1000;
  const currentDate = new Date(currentTime);
  const previousDate = new Date(previousTime);

  const isDifferentDay =
    currentDate.getDate() !== previousDate.getDate() ||
    currentDate.getMonth() !== previousDate.getMonth() ||
    currentDate.getFullYear() !== previousDate.getFullYear();

  return timeDiff > thirtyMinutes || isDifferentDay;
}
