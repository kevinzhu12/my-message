import {
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";

export interface AssistEntry {
  id: string;
  prompt: string;
  reply?: string;
  error?: string | null;
  createdAt: number;
}

export interface AssistDrafts {
  options: string[];
}

export interface AiAssistPanelRef {
  focus: () => void;
}

interface AiAssistPanelProps {
  isOpen: boolean;
  chatName: string;
  input: string;
  history: AssistEntry[];
  pending: boolean;
  error: string | null;
  drafts: AssistDrafts | null;
  generatingDrafts: boolean;
  width?: number;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onInsertDraft: (text: string) => void;
  onToggle: () => void;
}

const AiAssistPanel = forwardRef<AiAssistPanelRef, AiAssistPanelProps>(
  (
    {
      isOpen,
      chatName,
      input,
      history,
      pending,
      error,
      drafts,
      generatingDrafts,
      width,
      onInputChange,
      onSubmit,
      onInsertDraft,
      onToggle,
    },
    ref
  ) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const measureRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          // Move cursor to the end of the text
          const length = textarea.value.length;
          textarea.setSelectionRange(length, length);
        }
      },
    }));

    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [history, pending]);

    useEffect(() => {
      const textarea = textareaRef.current;
      const measure = measureRef.current;
      if (!textarea) return;

      if (measure) {
        measure.value = input;
        measure.style.height = "auto";
        const style = window.getComputedStyle(textarea);
        const borderTop = parseFloat(style.borderTopWidth) || 0;
        const borderBottom = parseFloat(style.borderBottomWidth) || 0;
        const baseHeight = 30;
        const nextHeight = Math.min(
          measure.scrollHeight + borderTop + borderBottom,
          120
        );
        const targetHeight = Math.max(baseHeight, Math.ceil(nextHeight));
        textarea.style.height = "auto";
        textarea.style.height = `${targetHeight}px`;
      } else {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
      }
    }, [input]);

    if (!isOpen) {
      return null;
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onSubmit();
      }
    };

    return (
      <div
        className="border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col"
        style={{ width: width ? `${width}px` : "384px", flexShrink: 0 }}
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              AI Companion
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {chatName}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="h-8 w-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Close AI panel"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-5"
        >
          {history.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Ask about the conversation or request ideas for what to say next.
            </div>
          )}
          {history.map((entry, index) => {
            const isLast = index === history.length - 1;
            const showPending =
              isLast && pending && !entry.reply && !entry.error;
            return (
              <div key={entry.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-blue-600 dark:bg-blue-700 text-white px-3 py-2 text-sm shadow">
                    {entry.prompt}
                  </div>
                </div>
                {(entry.reply || entry.error || showPending) && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 shadow">
                      {entry.error ? (
                        <span className="text-red-600 dark:text-red-400">
                          {entry.error}
                        </span>
                      ) : entry.reply ? (
                        entry.reply
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">
                          Thinking...
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
          {generatingDrafts && (
            <div className="flex items-center justify-center py-3 text-sm text-gray-500 dark:text-gray-400">
              <svg
                className="animate-spin h-4 w-4 mr-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Generating message options...
            </div>
          )}
          {!generatingDrafts && drafts && drafts.options.length > 0 && (
            <div className="max-h-72 overflow-y-auto space-y-2">
              {drafts.options.map((option, index) => (
                <button
                  key={`draft-option-${index}`}
                  type="button"
                  onClick={() => onInsertDraft(option)}
                  className="w-full text-left text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 px-3 py-2 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-gray-900 dark:text-gray-100"
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask the assistant..."
              className="block w-full px-2 py-[2px] text-sm border border-gray-600 dark:border-gray-500 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 max-h-[120px] overflow-y-auto emoji-text box-border bg-gray-100 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
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
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }
);

AiAssistPanel.displayName = "AiAssistPanel";

export default AiAssistPanel;
