import { useCallback, useState } from "react";

const useChatSwipe = () => {
  const [revealedChatId, setRevealedChatId] = useState<number | null>(null);
  const [activeSwipeChatId, setActiveSwipeChatId] = useState<number | null>(
    null,
  );
  const [activeSwipeOffset, setActiveSwipeOffset] = useState(0);

  const handleSwipeOffset = useCallback((chatId: number, offset: number) => {
    setRevealedChatId((current) =>
      current !== null && current !== chatId ? null : current,
    );
    setActiveSwipeChatId(chatId);
    setActiveSwipeOffset(offset);
  }, []);

  const handleSwipeEnd = useCallback((chatId: number, shouldOpen: boolean) => {
    setActiveSwipeChatId(null);
    setActiveSwipeOffset(0);
    setRevealedChatId(shouldOpen ? chatId : null);
  }, []);

  return {
    revealedChatId,
    setRevealedChatId,
    activeSwipeChatId,
    activeSwipeOffset,
    handleSwipeOffset,
    handleSwipeEnd,
  };
};

export default useChatSwipe;
