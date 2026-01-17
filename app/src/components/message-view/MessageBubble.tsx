import type { Attachment, Message } from "../../types";
import AttachmentPreview from "./AttachmentPreview";
import { renderTextWithLinks } from "./utils/links";

interface MessageBubbleProps {
  message: Message;
  text: string;
  attachments: Attachment[];
  hasAttachments: boolean;
  hasImageAttachments: boolean;
  messageHasEmojis: boolean;
  isAttachmentPlaceholder: boolean;
}

export default function MessageBubble({
  message,
  text,
  attachments,
  hasAttachments,
  hasImageAttachments,
  messageHasEmojis,
  isAttachmentPlaceholder,
}: MessageBubbleProps) {
  return (
    <div
      className={`max-w-md w-fit rounded-2xl ${
        hasImageAttachments
          ? "px-1 py-1"
          : messageHasEmojis
            ? "px-3 py-2"
            : "px-3 py-1.5"
      } ${
        message.is_from_me
          ? "bg-blue-600 dark:bg-blue-600 text-white"
          : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
      }`}
    >
      {hasAttachments && (
        <div
          className={hasImageAttachments ? "space-y-1 mb-1" : "space-y-2 mb-1"}
        >
          {attachments.map((attachment) => (
            <AttachmentPreview
              key={attachment.id}
              attachment={attachment}
              isFromMe={message.is_from_me}
            />
          ))}
        </div>
      )}
      {text && !isAttachmentPlaceholder && (
        <p
          className={`text-sm whitespace-pre-wrap break-words ${
            hasImageAttachments ? "px-3" : ""
          }`}
        >
          {renderTextWithLinks(text, message.is_from_me)}
        </p>
      )}
      {!hasAttachments && !text && (
        <p className="text-sm opacity-60">(Empty message)</p>
      )}
    </div>
  );
}
