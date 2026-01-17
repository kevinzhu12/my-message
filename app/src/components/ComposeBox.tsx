import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Chat, SuggestionAction } from "../types";
import type { Suggestion } from "../hooks/useSuggestion";
import { findChatBySearchTerm } from "../utils/chatSearch";

const DEBOUNCE_MS = 300;

interface ComposeBoxProps {
  messageText: string;
  setMessageText: (text: string) => void;
  onSend: (text: string) => void;
  onSendAttachment?: (filePath: string) => void;
  sending: boolean;
  suggestionCache: Map<string, Suggestion | null>;
  onAcceptSuggestion?: (forText: string) => void;
  onEscape?: () => void;
  onTabAction?: (action: SuggestionAction) => void;
  chats: Chat[];
}

export interface ComposeBoxRef {
  focus: () => void;
}

const ComposeBox = forwardRef<ComposeBoxRef, ComposeBoxProps>(
  (
    {
      messageText,
      setMessageText,
      onSend,
      onSendAttachment,
      sending,
      suggestionCache,
      onAcceptSuggestion,
      onEscape,
      onTabAction,
      chats,
    },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const measureRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const emojiPickerRef = useRef<HTMLDivElement>(null);

    // Internal state for responsive typing, debounced to external
    const [localText, setLocalText] = useState(messageText);
    const lastExternalTextRef = useRef(messageText);

    // Sync from external messageText when it changes (e.g., suggestion accepted)
    useEffect(() => {
      if (messageText !== lastExternalTextRef.current) {
        lastExternalTextRef.current = messageText;
        setLocalText(messageText);
      }
    }, [messageText]);

    // Debounce updates to external state
    useEffect(() => {
      if (localText === lastExternalTextRef.current) return;

      const timer = setTimeout(() => {
        lastExternalTextRef.current = localText;
        setMessageText(localText);
      }, DEBOUNCE_MS);

      return () => clearTimeout(timer);
    }, [localText, setMessageText]);

    const cachedSuggestion = suggestionCache.get(localText);
    const suggestionText =
      cachedSuggestion?.type === "text" ? cachedSuggestion.text : null;

    // Derive tab action from cache
    const tabAction: SuggestionAction | null = (() => {
      if (sending) return null;
      if (cachedSuggestion?.type === "action") {
        const action = cachedSuggestion.action;
        // For switch_chat, verify the search term matches an existing chat
        if (action.action === "switch_chat") {
          if (!findChatBySearchTerm(chats, action.chat_search_term)) {
            return null;
          }
        }
        return action;
      }
      // if (localText.trim()) return { action: "send" };
      return null;
    })();

    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus();
      },
    }));
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Close emoji picker when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          emojiPickerRef.current &&
          !emojiPickerRef.current.contains(event.target as Node) &&
          !(event.target as HTMLElement).closest("[data-emoji-button]")
        ) {
          setShowEmojiPicker(false);
        }
      };

      if (showEmojiPicker) {
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
          document.removeEventListener("mousedown", handleClickOutside);
      }
    }, [showEmojiPicker]);

    // Auto-resize textarea
    useEffect(() => {
      const textarea = textareaRef.current;
      const measure = measureRef.current;
      if (!textarea) return;

      if (measure) {
        measure.value = `${localText}${suggestionText ?? ""}`;
        measure.style.height = "auto";
        const style = window.getComputedStyle(textarea);
        const borderTop = parseFloat(style.borderTopWidth) || 0;
        const borderBottom = parseFloat(style.borderBottomWidth) || 0;
        const baseHeight = 30;
        const nextHeight = Math.min(
          measure.scrollHeight + borderTop + borderBottom,
          120,
        );
        const targetHeight = Math.max(baseHeight, Math.ceil(nextHeight));
        textarea.style.height = "auto";
        textarea.style.height = `${targetHeight}px`;
      } else {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
      }
    }, [localText, suggestionText]);

    const flushAndSend = () => {
      if (!localText.trim() || sending) return;
      // Capture text to send
      const textToSend = localText;
      // Clear input immediately to cancel any pending debounce timers
      setLocalText("");
      lastExternalTextRef.current = "";
      setMessageText("");
      // Send the captured text
      onSend(textToSend);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab to accept text suggestion
      if (e.key === "Tab" && suggestionText && onAcceptSuggestion) {
        e.preventDefault();
        onAcceptSuggestion(localText);
        return;
      }
      // Tab to execute action (send, call, facetime, switch_chat)
      if (e.key === "Tab" && tabAction) {
        e.preventDefault();
        if (tabAction.action === "send") {
          flushAndSend();
        } else if (onTabAction) {
          onTabAction(tabAction);
        }
        return;
      }
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      // Enter to send
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        flushAndSend();
      }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onSendAttachment) {
        // In Electron, we can get the actual file path
        // The file object has a 'path' property in Electron
        const filePath = (file as File & { path?: string }).path;
        if (filePath) {
          onSendAttachment(filePath);
        }
      }
      // Reset the input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    const handleEmojiClick = (emoji: string) => {
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newText =
          localText.substring(0, start) + emoji + localText.substring(end);
        setLocalText(newText);
        // Set cursor position after the inserted emoji
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(
            start + emoji.length,
            start + emoji.length,
          );
        }, 0);
      } else {
        setLocalText(localText + emoji);
      }
      setShowEmojiPicker(false);
    };

    const commonEmojis = [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🤣",
      "😊",
      "😇",
      "🙂",
      "🙃",
      "😉",
      "😌",
      "😍",
      "🥰",
      "😘",
      "😗",
      "😙",
      "😚",
      "😋",
      "😛",
      "😝",
      "😜",
      "🤪",
      "🤨",
      "🧐",
      "🤓",
      "😎",
      "🤩",
      "🥳",
      "😏",
      "😒",
      "😞",
      "😔",
      "😟",
      "😕",
      "🙁",
      "☹️",
      "😣",
      "😖",
      "😫",
      "😩",
      "🥺",
      "😢",
      "😭",
      "😤",
      "😠",
      "😡",
      "🤬",
      "🤯",
      "😳",
      "🥵",
      "🥶",
      "😱",
      "😨",
      "😰",
      "😥",
      "😓",
      "🤗",
      "🤔",
      "🤭",
      "🤫",
      "🤥",
      "😶",
      "😐",
      "😑",
      "😬",
      "🙄",
      "😯",
      "😦",
      "😧",
      "😮",
      "😲",
      "🥱",
      "😴",
      "🤤",
      "😪",
      "😵",
      "🤐",
      "🥴",
      "🤢",
      "🤮",
      "🤧",
      "😷",
      "🤒",
      "🤕",
      "🤑",
      "🤠",
      "😈",
      "👿",
      "👹",
      "👺",
      "🤡",
      "💩",
      "👻",
      "💀",
      "☠️",
      "👽",
      "👾",
      "🤖",
      "🎃",
      "😺",
      "😸",
      "😹",
      "😻",
      "😼",
      "😽",
      "🙀",
      "😿",
      "😾",
      "👋",
      "🤚",
      "🖐",
      "✋",
      "🖖",
      "👌",
      "🤌",
      "🤏",
      "✌️",
      "🤞",
      "🤟",
      "🤘",
      "🤙",
      "👈",
      "👉",
      "👆",
      "🖕",
      "👇",
      "☝️",
      "👍",
      "👎",
      "✊",
      "👊",
      "🤛",
      "🤜",
      "👏",
      "🙌",
      "👐",
      "🤲",
      "🤝",
      "🙏",
      "✍️",
      "💪",
      "🦾",
      "🦿",
      "🦵",
      "🦶",
      "👂",
      "🦻",
      "👃",
      "🧠",
      "🦷",
      "🦴",
      "👀",
      "👁",
      "👅",
      "👄",
      "💋",
      "💘",
      "💝",
      "💖",
      "💗",
      "💓",
      "💞",
      "💕",
      "💟",
      "❣️",
      "💔",
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "🤎",
      "💯",
      "💢",
      "💥",
      "💫",
      "💦",
      "💨",
      "🕳️",
      "💣",
      "💬",
      "👁️‍🗨️",
      "🗨️",
      "🗯️",
      "💭",
      "💤",
    ];

    return (
      <div
        ref={containerRef}
        className="px-2 py-2 bg-gray-100/50 dark:bg-gray-800/50 backdrop-blur-2xl"
      >
        <div className="flex items-end gap-1">
          <div className="flex">
          {/* Emoji button */}
          <div>
            <button
              data-emoji-button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              disabled={sending}
              className="h-[30px] w-[30px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors disabled:opacity-50"
              title="Add emoji"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
            {showEmojiPicker && (
              <div
                ref={emojiPickerRef}
                className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 w-64 h-64 overflow-y-auto z-50"
              >
                <div className="grid grid-cols-8 gap-1">
                  {commonEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleEmojiClick(emoji)}
                      className="text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded p-1 transition-colors"
                      type="button"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Attachment button */}
          {onSendAttachment && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                disabled={sending}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="h-[30px] w-[30px] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors disabled:opacity-50"
                title="Attach file"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>
            </div>
          )}
          </div>
          <div className="flex-1 relative">
            {/* Action pill tooltip */}
            {tabAction && (
              <button
                type="button"
                onClick={() => {
                  if (tabAction.action === "send") {
                    flushAndSend();
                  } else if (onTabAction) {
                    onTabAction(tabAction);
                  }
                }}
                disabled={sending || (tabAction.action === "send" && !localText.trim())}
                className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[calc(100%+10px)] flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 dark:bg-gray-700 text-white text-sm rounded-full shadow-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 z-10 max-w-[300px]"
              >
                <span className="text-blue-400 dark:text-blue-300">tab</span>
                {tabAction.action === "send" && (
                  <>
                    <span>send</span>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 10l7-7m0 0l7 7m-7-7v18"
                      />
                    </svg>
                  </>
                )}
                {tabAction.action === "call" && (
                  <>
                    <span>call</span>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                  </>
                )}
                {tabAction.action === "facetime" && (
                  <>
                    <span>facetime</span>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </>
                )}
                {tabAction.action === "switch_chat" && (
                  <>
                    <div className="overflow-x-hidden whitespace-nowrap truncate">
                      switch to{" "}
                      <span className="font-bold">
                        {findChatBySearchTerm(chats, tabAction.chat_search_term)?.display_name ?? "chat"}
                      </span>
                    </div>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </>
                )}
              </button>
            )}
            {/* Ghost text overlay for suggestions */}
            {suggestionText && (
              <div
                className="absolute inset-0 px-2 py-[2px] text-sm pointer-events-none overflow-hidden whitespace-pre-wrap break-words rounded-3xl emoji-text flex items-start border border-transparent"
                style={{ minHeight: "24px" }}
              >
                <span>
                  <span className="invisible">{localText}</span>
                  <span className="text-gray-400 dark:text-gray-500">{suggestionText}</span>
                </span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              className={`block w-full px-2 py-[2px] text-sm border border-gray-600 dark:border-gray-500 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400 dark:disabled:text-gray-500 max-h-[120px] overflow-y-auto emoji-text box-border text-gray-900 dark:text-gray-100 ${
                suggestionText
                  ? "bg-transparent"
                  : "bg-gray-100 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600"
              }`}
              rows={1}
              style={{ minHeight: "24px" }}
            />
            <textarea
              ref={measureRef}
              className="absolute left-0 top-0 w-full -z-10 invisible px-2 py-[2px] text-sm border border-transparent emoji-text resize-none overflow-hidden box-border"
              rows={1}
              tabIndex={-1}
              aria-hidden="true"
              readOnly
              style={{ minHeight: "24px" }}
            />
          </div>
        </div>
      </div>
    );
  },
);

ComposeBox.displayName = "ComposeBox";

export default ComposeBox;
