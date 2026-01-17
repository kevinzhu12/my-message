import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Message } from "../../types";
import { useMessageScroll } from "./hooks/useMessageScroll";
import { useTimestampSwipe } from "./hooks/useTimestampSwipe";
import MessageList from "./MessageList";

interface MessageViewProps {
  messages: Message[];
  onLoadOlder: () => void;
  hasMoreMessages: boolean;
  loadingOlder: boolean;
  totalMessages: number;
  isGroup: boolean;
}

export interface MessageViewRef {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

const MessageView = forwardRef<MessageViewRef, MessageViewProps>(
  (
    {
      messages,
      onLoadOlder,
      hasMoreMessages,
      loadingOlder,
      totalMessages,
      isGroup,
    },
    ref,
  ) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesStartRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const { scrollToBottom } = useMessageScroll({
      messages,
      onLoadOlder,
      hasMoreMessages,
      loadingOlder,
      containerRef,
      messagesStartRef,
      messagesEndRef,
    });

    const { timestampShift, timestampOpacity, isTimestampSwipeActive } =
      useTimestampSwipe({
        containerRef,
      });

    useImperativeHandle(ref, () => ({
      scrollToBottom,
    }));

    return (
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4"
      >
        {hasMoreMessages && (
          <div ref={messagesStartRef} className="text-center py-2">
            {loadingOlder ? (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Loading older messages...
              </span>
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500">
                Scroll up for older messages
              </span>
            )}
          </div>
        )}

        {!hasMoreMessages &&
          messages.length > 0 &&
          messages.length < totalMessages && (
            <div className="text-center py-2 text-sm text-gray-400 dark:text-gray-500">
              Showing {messages.length} of {totalMessages} messages
            </div>
          )}

        {!hasMoreMessages &&
          messages.length === totalMessages &&
          totalMessages > 50 && (
            <div className="text-center py-2 text-sm text-gray-400 dark:text-gray-500">
              All {totalMessages} messages loaded
            </div>
          )}

        <MessageList
          messages={messages}
          isGroup={isGroup}
          timestampShift={timestampShift}
          timestampOpacity={timestampOpacity}
          isTimestampSwipeActive={isTimestampSwipeActive}
        />

        <div ref={messagesEndRef} />
      </div>
    );
  },
);

MessageView.displayName = "MessageView";

export default MessageView;
