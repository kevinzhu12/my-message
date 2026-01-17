import type { Attachment } from "../../../types";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAttachmentDisplayName(attachment: Attachment): string {
  return attachment.transfer_name || attachment.filename || "Attachment";
}

export function isImageAttachment(attachment: Attachment): boolean {
  if (attachment.mime_type?.startsWith("image/")) return true;
  const name = getAttachmentDisplayName(attachment).toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(name);
}

export function isVideoAttachment(attachment: Attachment): boolean {
  if (attachment.mime_type?.startsWith("video/")) return true;
  const name = getAttachmentDisplayName(attachment).toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(name);
}
