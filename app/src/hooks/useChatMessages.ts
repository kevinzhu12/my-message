import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { fetchMessages } from "../api";
import type { Message, MessagesResponse } from "../types";

const OPTIMISTIC_ID_THRESHOLD = 1700000000000;
const MESSAGE_PAGE_SIZE = 50;

export const mergeIncomingMessages = (
  prev: Message[],
  incoming: Message[],
): Message[] => {
  if (prev.length === 0) return incoming;
  if (incoming.length === 0) return prev;

  const incomingIds = new Set(incoming.map((m) => m.id));
  const oldestNewTime = Math.min(...incoming.map((m) => m.time));
  const olderMessages = prev.filter(
    (m) =>
      m.time < oldestNewTime &&
      !incomingIds.has(m.id) &&
      m.id < OPTIMISTIC_ID_THRESHOLD,
  );

  return [...olderMessages, ...incoming];
};

const flattenMessages = (data: InfiniteData<MessagesResponse> | undefined) => {
  if (!data) return [];
  const orderedPages = [...data.pages].reverse();
  return orderedPages.flatMap((page) => page.messages);
};

const buildInfiniteData = (
  messages: Message[],
  total: number,
  hasMoreOverride?: boolean,
): InfiniteData<MessagesResponse> => {
  const pages: MessagesResponse[] = [];
  const pageParams: number[] = [];
  let end = messages.length;
  let offset = 0;
  const hasMore = hasMoreOverride ?? total > messages.length;

  while (end > 0) {
    const start = Math.max(0, end - MESSAGE_PAGE_SIZE);
    const pageMessages = messages.slice(start, end);
    const isOldestPage = start === 0;
    pages.push({
      messages: pageMessages,
      total,
      has_more: isOldestPage ? hasMore : true,
    });
    pageParams.push(offset);
    offset += pageMessages.length;
    end = start;
  }

  return { pages, pageParams };
};

export function useChatMessages(activeChatId: number | null) {
  const activeChatIdRef = useRef(activeChatId);
  const queryClient = useQueryClient();

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const messagesQuery = useInfiniteQuery({
    queryKey: ["messages", activeChatId],
    queryFn: ({ pageParam = 0, queryKey }) => {
      const chatId = queryKey[1] as number;
      return fetchMessages(chatId, MESSAGE_PAGE_SIZE, pageParam);
    },
    enabled: typeof activeChatId === "number",
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (!lastPage.has_more) return undefined;
      const loaded = pages.reduce(
        (count, page) => count + page.messages.length,
        0,
      );
      return loaded;
    },
  });

  const messages = useMemo(
    () => flattenMessages(messagesQuery.data),
    [messagesQuery.data],
  );

  const total = messagesQuery.data?.pages[0]?.total ?? 0;
  const hasMore = messagesQuery.hasNextPage ?? false;
  const loadingOlder = messagesQuery.isFetchingNextPage;

  const loadOlder = useCallback(async () => {
    if (!activeChatId || !messagesQuery.hasNextPage) return;
    if (messagesQuery.isFetchingNextPage) return;
    try {
      await messagesQuery.fetchNextPage();
    } catch (err) {
      throw err;
    }
  }, [
    activeChatId,
    messagesQuery.fetchNextPage,
    messagesQuery.hasNextPage,
    messagesQuery.isFetchingNextPage,
  ]);

  const applyWsUpdate = useCallback(
    (chatId: number, newMessages: Message[], total: number) => {
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        ["messages", chatId],
        (data) => {
          const baseMessages = flattenMessages(data);
          const merged = mergeIncomingMessages(baseMessages, newMessages);
          const hasMoreFromCache = data
            ? data.pages[data.pages.length - 1]?.has_more
            : undefined;
          return buildInfiniteData(merged, total, hasMoreFromCache);
        },
      );
    },
    [queryClient],
  );

  const addOptimistic = useCallback(
    (message: Message) => {
      const chatId = activeChatIdRef.current;
      if (chatId === null) return;
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        ["messages", chatId],
        (data) => {
          const baseMessages = flattenMessages(data);
          const merged = [...baseMessages, message];
          const total = (data?.pages[0]?.total ?? merged.length - 1) + 1;
          const hasMoreFromCache = data
            ? data.pages[data.pages.length - 1]?.has_more
            : undefined;
          return buildInfiniteData(merged, total, hasMoreFromCache);
        },
      );
    },
    [queryClient],
  );

  const rollbackOptimistic = useCallback(
    (tempId: number) => {
      const chatId = activeChatIdRef.current;
      if (chatId === null) return;
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        ["messages", chatId],
        (data) => {
          if (!data) return data;
          const baseMessages = flattenMessages(data);
          const had = baseMessages.some((message) => message.id === tempId);
          if (!had) return data;
          const merged = baseMessages.filter(
            (message) => message.id !== tempId,
          );
          const currentTotal = data.pages[0]?.total ?? merged.length + 1;
          const nextTotal = Math.max(0, currentTotal - 1);
          const hasMoreFromCache =
            data.pages[data.pages.length - 1]?.has_more ?? undefined;
          return buildInfiniteData(merged, nextTotal, hasMoreFromCache);
        },
      );
    },
    [queryClient],
  );

  const replaceFromServer = useCallback(
    (messages: Message[], total: number, hasMore: boolean) => {
      const chatId = activeChatIdRef.current;
      if (chatId === null) return;
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        ["messages", chatId],
        buildInfiniteData(messages, total, hasMore),
      );
    },
    [queryClient],
  );

  return {
    messages,
    total,
    hasMore,
    loadingOlder,
    error:
      messagesQuery.error instanceof Error ? messagesQuery.error.message : null,
    loadOlder,
    applyWsUpdate,
    addOptimistic,
    rollbackOptimistic,
    replaceFromServer,
  };
}
