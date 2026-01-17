import { formatTimestampDivider } from "./utils/timestamps";

interface TimestampDividerProps {
  timestamp: number;
}

export default function TimestampDivider({ timestamp }: TimestampDividerProps) {
  return (
    <div className="flex justify-center my-4">
      <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1">
        {formatTimestampDivider(timestamp)}
      </span>
    </div>
  );
}
