import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeContactContext,
  fetchContactContext,
  updateContactContext,
} from "../api";
import { fetchContactPhoto, getCachedPhoto } from "../photoCache";
import type { Chat, ContactContext } from "../types";

interface ContactCardProps {
  chat: Chat;
  onClose: () => void;
}

function ContactCard({ chat, onClose }: ContactCardProps) {
  const primaryHandle = chat.handles[0] || "";
  const isPhone = primaryHandle.startsWith("+") || /^\d+$/.test(primaryHandle);
  const isEmail = primaryHandle.includes("@");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [context, setContext] = useState<ContactContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [basicInfo, setBasicInfo] = useState({
    birthday: "",
    hometown: "",
    work: "",
    school: "",
  });
  const [savingContext, setSavingContext] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!primaryHandle) {
      setPhotoUrl(null);
      return;
    }

    // Check cache first (shared with ChatList)
    const cached = getCachedPhoto(primaryHandle);
    if (cached !== undefined) {
      // Already know the result (either has photo or doesn't)
      setPhotoUrl(cached);
      return;
    }

    // Fetch photo using shared cache (handles deduplication and queuing)
    let isActive = true;
    fetchContactPhoto(primaryHandle).then((url) => {
      if (isActive) {
        setPhotoUrl(url);
      }
    });

    return () => {
      isActive = false;
    };
  }, [primaryHandle]);

  useEffect(() => {
    if (!primaryHandle) {
      setContext(null);
      setNotes("");
      setBasicInfo({
        birthday: "",
        hometown: "",
        work: "",
        school: "",
      });
      isInitialLoadRef.current = true;
      return;
    }

    // Reset initial load flag when switching contacts
    isInitialLoadRef.current = true;

    setLoadingContext(true);
    setContextError(null);
    fetchContactContext(primaryHandle)
      .then((data) => {
        setContext(data);
        setNotes(data?.notes || "");
        setBasicInfo({
          birthday: data?.basic_info?.birthday || "",
          hometown: data?.basic_info?.hometown || "",
          work: data?.basic_info?.work || "",
          school: data?.basic_info?.school || "",
        });
      })
      .catch((error) => {
        setContextError(
          error instanceof Error ? error.message : "Failed to load context",
        );
      })
      .finally(() => {
        setLoadingContext(false);
        // Mark initial load as complete after a short delay to prevent immediate save
        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 500);
      });
  }, [primaryHandle]);

  const handleAnalyze = async () => {
    if (!primaryHandle) return;
    setAnalyzing(true);
    setContextError(null);
    try {
      const updated = await analyzeContactContext(
        chat.id,
        primaryHandle,
        chat.display_name,
      );
      setContext(updated);
      setNotes(updated.notes || "");
      setBasicInfo({
        birthday: updated.basic_info?.birthday || "",
        hometown: updated.basic_info?.hometown || "",
        work: updated.basic_info?.work || "",
        school: updated.basic_info?.school || "",
      });
    } catch (error) {
      setContextError(
        error instanceof Error ? error.message : "Failed to analyze contact",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const saveContext = useCallback(async () => {
    if (!primaryHandle || isInitialLoadRef.current) return;

    setSavingContext(true);
    setContextError(null);

    try {
      const updated = await updateContactContext(primaryHandle, {
        display_name: chat.display_name,
        basic_info: {
          birthday: basicInfo.birthday || null,
          hometown: basicInfo.hometown || null,
          work: basicInfo.work || null,
          school: basicInfo.school || null,
        },
        notes: notes || null,
      });
      setContext(updated);
    } catch (error) {
      setContextError(
        error instanceof Error ? error.message : "Failed to save context",
      );
    } finally {
      setSavingContext(false);
    }
  }, [primaryHandle, notes, basicInfo, chat.display_name]);

  // Auto-save with debouncing
  useEffect(() => {
    if (isInitialLoadRef.current) return;

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save (800ms after user stops typing)
    saveTimeoutRef.current = setTimeout(() => {
      saveContext();
    }, 800);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [saveContext]);

  const formatDate = (timestamp?: number | null) => {
    if (!timestamp) return "—";
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[36rem] max-h-[85vh] flex flex-col overflow-hidden border border-gray-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-all duration-200"
        >
          <svg
            className="w-4 h-4 text-gray-500"
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

        {/* Header */}
        <div className="flex-shrink-0 pt-8 pb-5 px-8">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            {(() => {
              if (photoUrl) {
                return (
                  <img
                    src={photoUrl}
                    alt={chat.display_name}
                    className="w-20 h-20 rounded-full object-cover shadow-md"
                  />
                );
              }

              // Check if displayName is a phone number or email (not a real name)
              const isPhoneOrEmail =
                /^[+\d\s\-()]+$/.test(chat.display_name) ||
                chat.display_name.includes("@");

              if (isPhoneOrEmail) {
                // Show person silhouette for phone numbers/emails
                return (
                  <div className="w-20 h-20 rounded-full bg-gray-400 flex items-center justify-center text-white shadow-md">
                    <svg
                      className="w-10 h-10"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                );
              }

              // Show initials for real names
              const initials = chat.display_name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();

              return (
                <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center text-white text-2xl font-semibold shadow-md">
                  {initials}
                </div>
              );
            })()}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold text-gray-800 truncate">
                {chat.display_name}
              </h2>
              {primaryHandle && (
                <a
                  href={
                    isPhone
                      ? `tel:${primaryHandle}`
                      : isEmail
                        ? `mailto:${primaryHandle}`
                        : undefined
                  }
                  className="text-sm text-gray-500 hover:text-blue-600 transition-colors"
                >
                  {primaryHandle}
                </a>
              )}
            </div>
          </div>

          {/* Quick actions */}
          {isEmail && (
            <div className="flex gap-2 mt-5">
              <a
                href={`mailto:${primaryHandle}`}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200"
              >
                <svg
                  className="w-4 h-4 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-sm font-medium text-gray-700">Email</span>
              </a>
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Context header */}
          <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm px-8 pt-4 pb-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1 h-5 bg-blue-500 rounded-full"></div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Context
                </h3>
              </div>
              <div className="flex items-center gap-3">
                {loadingContext && (
                  <span className="text-xs text-gray-400 flex items-center gap-1.5">
                    <svg
                      className="w-3 h-3 animate-spin text-blue-500"
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
                    Loading...
                  </span>
                )}
                {savingContext && (
                  <span className="text-xs text-gray-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></span>
                    Saving
                  </span>
                )}
                {context?.last_analyzed_at && !loadingContext && (
                  <span className="text-xs text-gray-400">
                    Analyzed {formatDate(context.last_analyzed_at)}
                  </span>
                )}
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="text-xs px-4 py-2 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {analyzing ? (
                    <span className="flex items-center gap-2">
                      <svg
                        className="w-3 h-3 animate-spin"
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
                      Analyzing
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                        />
                      </svg>
                      Analyze
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="px-8 pb-8 pt-4 space-y-5">
            {contextError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-center gap-2">
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {contextError}
              </div>
            )}

            {!loadingContext && !context && (
              <div className="text-sm text-gray-500 py-6 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <svg
                  className="w-8 h-8 mx-auto mb-2 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                No context yet. Run an analysis or add details below.
              </div>
            )}

            {/* Profile details - inline with icons */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
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
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <input
                  value={basicInfo.birthday}
                  onChange={(e) =>
                    setBasicInfo((prev) => ({
                      ...prev,
                      birthday: e.target.value,
                    }))
                  }
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all placeholder:text-gray-300"
                  placeholder="Birthday"
                />
              </div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
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
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <input
                  value={basicInfo.hometown}
                  onChange={(e) =>
                    setBasicInfo((prev) => ({
                      ...prev,
                      hometown: e.target.value,
                    }))
                  }
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all placeholder:text-gray-300"
                  placeholder="Hometown"
                />
              </div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
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
                      d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <input
                  value={basicInfo.work}
                  onChange={(e) =>
                    setBasicInfo((prev) => ({ ...prev, work: e.target.value }))
                  }
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all placeholder:text-gray-300"
                  placeholder="Work"
                />
              </div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
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
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                </div>
                <input
                  value={basicInfo.school}
                  onChange={(e) =>
                    setBasicInfo((prev) => ({
                      ...prev,
                      school: e.target.value,
                    }))
                  }
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all placeholder:text-gray-300"
                  placeholder="School"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
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
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={12}
                className="w-full text-sm bg-white border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-y transition-all placeholder:text-gray-300 min-h-[200px]"
                placeholder="Notes about this person—interests, preferences, shared experiences, ongoing situations in their life..."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContactCard;
