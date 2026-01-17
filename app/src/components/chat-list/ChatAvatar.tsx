import { memo, useEffect, useState } from "react";
import { fetchContactPhoto, getCachedPhoto } from "../../photoCache";

const ChatAvatar = memo(function ChatAvatar({
  handle,
  displayName,
  isGroup,
  size = "md",
}: {
  handle: string | undefined;
  displayName: string;
  isGroup: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    if (!handle || isGroup) {
      setPhotoUrl(null);
      return () => {
        isActive = false;
      };
    }

    const cached = getCachedPhoto(handle);
    if (cached !== undefined) {
      setPhotoUrl(cached);
      return () => {
        isActive = false;
      };
    }

    fetchContactPhoto(handle).then((url) => {
      if (isActive) {
        setPhotoUrl(url);
      }
    });

    return () => {
      isActive = false;
    };
  }, [handle, isGroup]);

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-base",
  };

  const sizeClass = sizeClasses[size];

  const isPhoneOrEmail =
    /^[+\d\s\-()]+$/.test(displayName) || displayName.includes("@");

  const initials = isPhoneOrEmail
    ? null
    : displayName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={displayName}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  if (isGroup) {
    return (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 bg-gradient-to-br from-green-400 to-green-600`}
      >
        <svg
          className={`${
            size === "sm" ? "w-5 h-5" : size === "md" ? "w-6 h-6" : "w-8 h-8"
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
        </svg>
      </div>
    );
  }

  if (initials) {
    return (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 bg-gradient-to-br from-blue-400 to-blue-600`}
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center text-white flex-shrink-0 bg-gradient-to-br from-gray-400 to-gray-500`}
    >
      <svg
        className={`${
          size === "sm" ? "w-5 h-5" : size === "md" ? "w-6 h-6" : "w-8 h-8"
        }`}
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
});

export default ChatAvatar;
