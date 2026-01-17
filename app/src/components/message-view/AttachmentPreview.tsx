import { getAttachmentUrl } from "../../api";
import type { Attachment } from "../../types";
import {
  formatFileSize,
  getAttachmentDisplayName,
  isImageAttachment,
  isVideoAttachment,
} from "./utils/attachments";

interface AttachmentPreviewProps {
  attachment: Attachment;
  isFromMe: boolean;
}

export default function AttachmentPreview({
  attachment,
  isFromMe,
}: AttachmentPreviewProps) {
  const url = getAttachmentUrl(attachment.id);
  const fileName = getAttachmentDisplayName(attachment);

  if (isImageAttachment(attachment)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={fileName}
          className="max-w-md max-h-64 w-auto h-auto object-contain rounded-2xl"
          loading="lazy"
        />
      </a>
    );
  }

  if (isVideoAttachment(attachment)) {
    return (
      <video
        src={url}
        controls
        className="max-w-md max-h-64 w-auto rounded-lg"
        preload="metadata"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 p-2 rounded-lg ${
        isFromMe ? "bg-blue-500/30" : "bg-gray-300/50"
      }`}
    >
      <svg
        className="w-8 h-8 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{fileName}</div>
        <div
          className={`text-xs ${isFromMe ? "text-blue-100" : "text-gray-500"}`}
        >
          {formatFileSize(attachment.total_bytes)}
        </div>
      </div>
    </a>
  );
}
