import { formatInlineTimestamp } from "./utils/timestamps";

interface InlineTimestampProps {
  timestamp: number;
  opacity: number;
  shiftPx: number;
  isActive: boolean;
}

export default function InlineTimestamp({
  timestamp,
  opacity,
  shiftPx,
  isActive,
}: InlineTimestampProps) {
  return (
    <div
      className="absolute right-0 top-1/2 text-[11px] text-gray-500 pointer-events-none select-none"
      style={{
        opacity,
        transform: `translateY(-50%) translateX(${
          opacity > 0 ? (1 - opacity) * shiftPx : shiftPx
        }px)`,
        transition: isActive
          ? "none"
          : "opacity 160ms ease-out, transform 160ms ease-out",
      }}
    >
      {formatInlineTimestamp(timestamp)}
    </div>
  );
}
