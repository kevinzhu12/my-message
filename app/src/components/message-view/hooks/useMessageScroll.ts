import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../../../types";

interface UseMessageScrollParams {
  messages: Message[];
  onLoadOlder: () => void;
  hasMoreMessages: boolean;
  loadingOlder: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  messagesStartRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function useMessageScroll({
  messages,
  onLoadOlder,
  hasMoreMessages,
  loadingOlder,
  containerRef,
  messagesStartRef,
  messagesEndRef,
}: UseMessageScrollParams) {
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
  const previousScrollHeight = useRef<number>(0);
  const previousMessageCount = useRef<number>(0);
  const previousMessageIds = useRef<Set<number>>(new Set());
  const previousFirstMessageId = useRef<number | null>(null);
  const previousLastMessageId = useRef<number | null>(null);
  const messageChangeToken = `${messages.length}:${
    messages[0]?.id ?? 0
  }:${messages[messages.length - 1]?.id ?? 0}`;

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior });
      }
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    },
    [containerRef, messagesEndRef],
  );

  const isNearBottom = useCallback(() => {
    if (!containerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollHeight - scrollTop - clientHeight < 200;
  }, [containerRef]);

  useEffect(() => {
    const wasEmpty = previousMessageIds.current.size === 0;
    const isEmpty = messages.length === 0;

    if (wasEmpty && !isEmpty) {
      setShouldScrollToBottom(true);
      previousMessageIds.current = new Set(messages.map((m) => m.id));
    } else if (!isEmpty && previousMessageIds.current.size > 0) {
      const currentIds = new Set(messages.map((m) => m.id));
      const hasOverlap = messages.some((m) =>
        previousMessageIds.current.has(m.id),
      );

      if (!hasOverlap) {
        setShouldScrollToBottom(true);
      }

      previousMessageIds.current = currentIds;
    }

    if (isEmpty) {
      previousMessageCount.current = 0;
      previousMessageIds.current = new Set();
    }
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) {
      previousFirstMessageId.current = null;
      previousLastMessageId.current = null;
      return;
    }

    const currentFirstId = messages[0]?.id ?? null;
    const currentLastId = messages[messages.length - 1]?.id ?? null;
    const messageCountIncreased =
      messages.length > previousMessageCount.current;
    const isPrepending =
      messageCountIncreased &&
      previousLastMessageId.current === currentLastId &&
      previousFirstMessageId.current !== null &&
      previousFirstMessageId.current !== currentFirstId;

    if (shouldScrollToBottom) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom("auto");
          setShouldScrollToBottom(false);
          previousMessageCount.current = messages.length;
          previousFirstMessageId.current = currentFirstId;
          previousLastMessageId.current = currentLastId;
        });
      });
      return;
    }

    if (isPrepending) {
      previousMessageCount.current = messages.length;
      previousFirstMessageId.current = currentFirstId;
      previousLastMessageId.current = currentLastId;
      return;
    }

    const lastMessage = messages[messages.length - 1];

    if (lastMessage.is_from_me) {
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
        previousMessageCount.current = messages.length;
        previousFirstMessageId.current = currentFirstId;
        previousLastMessageId.current = currentLastId;
      });
    } else if (messageCountIncreased && isNearBottom()) {
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
        previousMessageCount.current = messages.length;
        previousFirstMessageId.current = currentFirstId;
        previousLastMessageId.current = currentLastId;
      });
    } else if (messageCountIncreased) {
      previousMessageCount.current = messages.length;
      previousFirstMessageId.current = currentFirstId;
      previousLastMessageId.current = currentLastId;
    }
  }, [isNearBottom, messages, scrollToBottom, shouldScrollToBottom]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (isNearBottom()) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [containerRef, isNearBottom]);

  useEffect(() => {
    if (!messageChangeToken) {
      return;
    }
    if (containerRef.current && previousScrollHeight.current > 0) {
      const newScrollHeight = containerRef.current.scrollHeight;
      const scrollDiff = newScrollHeight - previousScrollHeight.current;
      containerRef.current.scrollTop += scrollDiff;
      previousScrollHeight.current = 0;
    }
  }, [containerRef, messageChangeToken]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreMessages && !loadingOlder) {
          if (containerRef.current) {
            previousScrollHeight.current = containerRef.current.scrollHeight;
          }
          onLoadOlder();
        }
      },
      { threshold: 1.0 },
    );

    if (messagesStartRef.current) {
      observer.observe(messagesStartRef.current);
    }

    return () => {
      if (messagesStartRef.current) {
        observer.unobserve(messagesStartRef.current);
      }
    };
  }, [
    containerRef,
    hasMoreMessages,
    loadingOlder,
    messagesStartRef,
    onLoadOlder,
  ]);

  return { scrollToBottom };
}
