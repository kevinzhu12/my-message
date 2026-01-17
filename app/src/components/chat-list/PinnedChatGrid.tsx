import { useState } from "react";
import type { Chat } from "../../types";
import ChatAvatar from "./ChatAvatar";

interface PinnedChatGridProps {
  pinnedChats: Chat[];
  pinnedChatOrder: number[];
  selectedChatId: number | null;
  unreadChatIds: Set<number>;
  seenUnreadChatIds: Set<number>;
  onSelectChat: (chat: Chat) => void;
  onContextMenu: (chatId: number, x: number, y: number) => void;
  onReorderPinned: (newOrder: number[]) => void;
}

const PinnedChatGrid = ({
  pinnedChats,
  pinnedChatOrder,
  selectedChatId,
  unreadChatIds,
  seenUnreadChatIds,
  onSelectChat,
  onContextMenu,
  onReorderPinned,
}: PinnedChatGridProps) => {
  const [draggedChatId, setDraggedChatId] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, chatId: number) => {
    setDraggedChatId(chatId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  };

  const handleDragOver = (
    e: React.DragEvent,
    chatId: number,
    index: number,
  ) => {
    e.preventDefault();
    if (draggedChatId === null || draggedChatId === chatId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const insertBefore = e.clientX < midpoint;

    const newDropIndex = insertBefore ? index : index + 1;
    setDropTargetIndex(newDropIndex);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedChatId === null || dropTargetIndex === null) {
      setDraggedChatId(null);
      setDropTargetIndex(null);
      return;
    }

    const currentOrder = [...pinnedChatOrder];
    const draggedIndex = currentOrder.indexOf(draggedChatId);

    if (
      draggedIndex === -1 ||
      dropTargetIndex === draggedIndex ||
      dropTargetIndex === draggedIndex + 1
    ) {
      setDraggedChatId(null);
      setDropTargetIndex(null);
      return;
    }

    currentOrder.splice(draggedIndex, 1);

    let insertIndex = dropTargetIndex;
    if (draggedIndex < dropTargetIndex) {
      insertIndex = dropTargetIndex - 1;
    }

    currentOrder.splice(insertIndex, 0, draggedChatId);
    onReorderPinned(currentOrder);

    setDraggedChatId(null);
    setDropTargetIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedChatId(null);
    setDropTargetIndex(null);
  };

  return (
    <div
      className="border-b border-gray-200 dark:border-gray-700 py-3 px-2"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-2">
        {Array.from({ length: Math.ceil(pinnedChats.length / 3) }).map(
          (_, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: TODO: look into a better way of doing this
            <div key={rowIndex} className="flex">
              {pinnedChats
                .slice(rowIndex * 3, rowIndex * 3 + 3)
                .map((chat, indexInRow) => {
                  const index = rowIndex * 3 + indexInRow;
                  const isUnread = unreadChatIds.has(chat.id);
                  const isSeen = seenUnreadChatIds.has(chat.id);
                  const isSelected = selectedChatId === chat.id;

                  const selectedClass = isSelected
                    ? "bg-blue-100 dark:bg-blue-900/40 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.18)]"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700";

                  const draggedItemIndex =
                    draggedChatId !== null
                      ? pinnedChats.findIndex((c) => c.id === draggedChatId)
                      : -1;

                  const isValidDropPosition =
                    dropTargetIndex !== null &&
                    dropTargetIndex !== draggedItemIndex &&
                    dropTargetIndex !== draggedItemIndex + 1;

                  const showDropIndicatorBefore =
                    isValidDropPosition && dropTargetIndex === index;
                  const showDropIndicatorAfter =
                    isValidDropPosition &&
                    dropTargetIndex === index + 1 &&
                    index === pinnedChats.length - 1;

                  return (
                    <div
                      key={chat.id}
                      className="flex items-center justify-center w-1/3 overflow-hidden"
                    >
                      <div
                        className={`w-1 rounded-full transition-all duration-200 ease-out ${
                          showDropIndicatorBefore
                            ? "h-14 bg-blue-500 shadow-lg shadow-blue-500/50 mx-1"
                            : "h-0 bg-transparent mx-0"
                        }`}
                      />
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(e, chat.id)}
                        onDragOver={(e) => handleDragOver(e, chat.id, index)}
                        onDragLeave={() => undefined}
                        onDragEnd={handleDragEnd}
                        onClick={() => onSelectChat(chat)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onContextMenu(chat.id, e.clientX, e.clientY);
                        }}
                        className={`flex flex-col items-center gap-1 cursor-grab active:cursor-grabbing group select-none w-full max-w-full overflow-hidden rounded-xl px-2 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-inset focus-visible:bg-blue-50/70 focus-visible:shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)] ${selectedClass}`}
                      >
                        <div className="relative">
                          <ChatAvatar
                            handle={chat.handles[0]}
                            displayName={chat.display_name}
                            isGroup={chat.is_group}
                            size="lg"
                          />
                          {isSelected && (
                            <div className="absolute inset-0 rounded-full border-2 border-blue-500" />
                          )}
                        </div>
                        <span
                          className={`text-xs text-center truncate w-full px-1 group-hover:text-gray-900 dark:group-hover:text-gray-100 ${
                            isUnread && !isSeen
                              ? "text-gray-900 dark:text-gray-100 font-bold"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {chat.display_name}
                        </span>
                      </div>
                      <div
                        className={`w-1 rounded-full transition-all duration-200 ease-out ${
                          showDropIndicatorAfter
                            ? "h-14 bg-blue-500 shadow-lg shadow-blue-500/50 mx-1"
                            : "h-0 bg-transparent mx-0"
                        }`}
                      />
                    </div>
                  );
                })}
            </div>
          ),
        )}
      </div>
    </div>
  );
};

export default PinnedChatGrid;
