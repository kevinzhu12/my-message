import type { Message } from "../../types";
import MessageRow from "./MessageRow";
import TimestampDivider from "./TimestampDivider";
import { shouldShowTimestamp } from "./utils/timestamps";

interface MessageListProps {
  messages: Message[];
  isGroup: boolean;
  timestampShift: number;
  timestampOpacity: number;
  isTimestampSwipeActive: boolean;
}

export default function MessageList({
  messages,
  isGroup,
  timestampShift,
  timestampOpacity,
  isTimestampSwipeActive,
}: MessageListProps) {
  return (
    <>
      {messages.map((message, index) => {
        const previousMessage = index > 0 ? messages[index - 1] : null;
        const showTimestamp = shouldShowTimestamp(message, previousMessage);

        return (
          <div key={message.id}>
            {showTimestamp && <TimestampDivider timestamp={message.time} />}
            <MessageRow
              message={message}
              previousMessage={previousMessage}
              isGroup={isGroup}
              showTimestamp={showTimestamp}
              timestampShift={timestampShift}
              timestampOpacity={timestampOpacity}
              isTimestampSwipeActive={isTimestampSwipeActive}
            />
          </div>
        );
      })}
    </>
  );
}
