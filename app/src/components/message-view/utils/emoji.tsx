import type { ReactNode } from "react";

// Regex to match emojis - excludes regular ASCII numbers (0-9) and letters.
const EMOJI_ONLY_REGEX =
  /([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E0}-\u{1F1FF}]{2}|[\u{1F3FB}-\u{1F3FF}]|\p{Emoji_Presentation}(?![0-9#*])|\p{Emoji}\uFE0F?(?![0-9#*])|\p{Emoji_Modifier_Base}[\p{Emoji_Modifier}]?)/gu;

const EMOJI_REGEX =
  /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?|\p{Emoji_Modifier_Base}[\p{Emoji_Modifier}]?|[\u{1F1E0}-\u{1F1FF}]{2}|[\u{1F3FB}-\u{1F3FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F300}-\u{1F9FF}])/gu;

export function isEmojiOnly(text: string): boolean {
  const textWithoutEmojis = text.replace(EMOJI_ONLY_REGEX, "").trim();
  if (textWithoutEmojis.length > 0) {
    return false;
  }

  EMOJI_ONLY_REGEX.lastIndex = 0;
  const emojiMatches = text.match(EMOJI_ONLY_REGEX);
  if (!emojiMatches) return false;

  const actualEmojis = emojiMatches.filter((match) => !/^[0-9]$/.test(match));
  const emojiCount = actualEmojis.length;

  return emojiCount >= 1 && emojiCount <= 3;
}

export function hasEmojis(text: string): boolean {
  const matches = text.match(EMOJI_REGEX);
  if (!matches) return false;

  return matches.some((match) => !/^[0-9]$/.test(match));
}

export function renderTextWithLargeEmojis(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  EMOJI_REGEX.lastIndex = 0;
  match = EMOJI_REGEX.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matchedChar = match[0];
    const isRegularDigit = /^[0-9]$/.test(matchedChar);

    if (isRegularDigit) {
      parts.push(matchedChar);
    } else {
      parts.push(
        <span key={`emoji-${keyCounter++}`} className="message-emoji">
          {matchedChar}
        </span>,
      );
    }
    lastIndex = match.index + match[0].length;
    match = EMOJI_REGEX.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
