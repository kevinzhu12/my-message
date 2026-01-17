import type { ReactNode } from "react";

// URL regex that matches http(s) URLs and common domains without protocol
const URL_REGEX =
  /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`[\]]+|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|io|co|app|dev|me|info|biz|xyz|ai)(?:\/[^\s<>"{}|\\^`[\]]*)?/gi;

function openLink(url: string) {
  // Ensure URL has protocol
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;

  try {
    // Try to use Electron's shell.openExternal if available
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(fullUrl);
      return;
    }
  } catch {
    // Fall through to window.open
  }

  window.open(fullUrl, "_blank", "noopener,noreferrer");
}

export function renderTextWithLinks(
  text: string,
  isFromMe: boolean,
): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  URL_REGEX.lastIndex = 0;
  match = URL_REGEX.exec(text);
  while (match !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const url = match[0];
    parts.push(
      <a
        key={`link-${keyCounter++}`}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          openLink(url);
        }}
        className={`underline hover:opacity-80 cursor-pointer ${
          isFromMe ? "text-white" : "text-blue-600"
        }`}
      >
        {url}
      </a>,
    );

    lastIndex = match.index + match[0].length;
    match = URL_REGEX.exec(text);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
