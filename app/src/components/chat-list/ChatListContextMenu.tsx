interface ChatListContextMenuProps {
  chatId: number;
  x: number;
  y: number;
  isPinned: boolean;
  onTogglePin: (chatId: number) => void;
  onClose: () => void;
}

const ChatListContextMenu = ({
  chatId,
  x,
  y,
  isPinned,
  onTogglePin,
  onClose,
}: ChatListContextMenuProps) => (
  <div
    className="fixed bg-white border border-gray-300 rounded-lg shadow-lg py-1 z-50"
    style={{ left: x, top: y }}
    onClick={(e) => e.stopPropagation()}
  >
    <button
      onClick={() => {
        onTogglePin(chatId);
        onClose();
      }}
      className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
    >
      {isPinned ? "📌 Unpin Chat" : "📌 Pin Chat"}
    </button>
  </div>
);

export default ChatListContextMenu;
