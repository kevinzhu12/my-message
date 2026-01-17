import type { Message } from "../../types";
import AttachmentPreview from "./AttachmentPreview";
import InlineTimestamp from "./InlineTimestamp";
import MessageBubble from "./MessageBubble";
import ReactionBubbles from "./ReactionBubbles";
import { isImageAttachment } from "./utils/attachments";
import {
  hasEmojis,
  isEmojiOnly,
  renderTextWithLargeEmojis,
} from "./utils/emoji";

interface MessageRowProps {
  message: Message;
  previousMessage: Message | null;
  isGroup: boolean;
  showTimestamp: boolean;
  timestampShift: number;
  timestampOpacity: number;
  isTimestampSwipeActive: boolean;
}

export default function MessageRow({
  message,
  previousMessage,
  isGroup,
  showTimestamp,
  timestampShift,
  timestampOpacity,
  isTimestampSwipeActive,
}: MessageRowProps) {
  const text = message.text || "";
  const isAttachmentPlaceholder = text.includes("📎 Attachment");
  const reactions = message.reactions || [];
  const attachments = message.attachments || [];
  const hasAttachments = attachments.length > 0;
  const isEmojiOnlyMessage =
    !hasAttachments && text && !isAttachmentPlaceholder && isEmojiOnly(text);

  const messageHasEmojis = text && !isAttachmentPlaceholder && hasEmojis(text);

  const reactionCounts = reactions.reduce(
    (acc, reaction) => {
      acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const hasReactions = Object.keys(reactionCounts).length > 0;

  const hasImageAttachments =
    hasAttachments && attachments.some(isImageAttachment);

  const trimmedText = text.trim();
  const isObjectReplacementOnly = /^[\uFFFC\s]*$/.test(trimmedText);
  const hasNoMeaningfulText =
    !trimmedText || isAttachmentPlaceholder || isObjectReplacementOnly;
  const hasOnlyImageAttachments =
    hasImageAttachments &&
    attachments.every(isImageAttachment) &&
    hasNoMeaningfulText;

  const isConsecutiveFromSameSender =
    previousMessage &&
    previousMessage.is_from_me === message.is_from_me &&
    (message.is_from_me
      ? true
      : previousMessage.handle === message.handle ||
        (previousMessage.handle === null && message.handle === null));

  let topSpacing = "";
  if (previousMessage) {
    topSpacing =
      isConsecutiveFromSameSender && !showTimestamp ? "mt-0.5" : "mt-4";
  }

  const bottomSpacing = hasReactions ? "mb-3" : "";
  const messageShift = message.is_from_me ? timestampShift : 0;

  const shouldShowContactName =
    isGroup &&
    !message.is_from_me &&
    (message.contact_name || message.handle) &&
    (!isConsecutiveFromSameSender || showTimestamp);

  return (
    <div className={`${topSpacing} ${bottomSpacing}`}>
      <div className="relative w-full">
        <div
          className={`flex ${
            message.is_from_me ? "justify-end" : "justify-start"
          }`}
          style={{
            transform: messageShift
              ? `translateX(-${messageShift}px)`
              : undefined,
            transition: isTimestampSwipeActive
              ? "none"
              : "transform 160ms ease-out",
          }}
        >
          <div className="relative flex flex-col items-start">
            {isEmojiOnlyMessage ? (
              <div className="flex items-center gap-1 py-1">
                {renderTextWithLargeEmojis(text)}
              </div>
            ) : hasOnlyImageAttachments ? (
              <>
                {shouldShowContactName && (
                  <div className="text-xs text-gray-600 mb-1 pl-2">
                    {message.contact_name || message.handle}
                  </div>
                )}
                <div>
                  {attachments.map((attachment) => (
                    <AttachmentPreview
                      key={attachment.id}
                      attachment={attachment}
                      isFromMe={message.is_from_me}
                    />
                  ))}
                </div>
              </>
            ) : (
              <>
                {shouldShowContactName && (
                  <div className="text-xs text-gray-600 mb-1 pl-2">
                    {message.contact_name || message.handle}
                  </div>
                )}
                <MessageBubble
                  message={message}
                  text={text}
                  attachments={attachments}
                  hasAttachments={hasAttachments}
                  hasImageAttachments={hasImageAttachments}
                  messageHasEmojis={Boolean(messageHasEmojis)}
                  isAttachmentPlaceholder={isAttachmentPlaceholder}
                />
              </>
            )}
            <ReactionBubbles
              reactionCounts={reactionCounts}
              isFromMe={message.is_from_me}
            />
          </div>
        </div>
        <InlineTimestamp
          timestamp={message.time}
          opacity={timestampOpacity}
          shiftPx={8}
          isActive={isTimestampSwipeActive}
        />
      </div>
    </div>
  );
}
