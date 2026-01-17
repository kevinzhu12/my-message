interface ReactionBubblesProps {
  reactionCounts: Record<string, number>;
  isFromMe: boolean;
}

export default function ReactionBubbles({
  reactionCounts,
  isFromMe,
}: ReactionBubblesProps) {
  const entries = Object.entries(reactionCounts);
  if (entries.length === 0) return null;

  return (
    <div
      className={`absolute -bottom-4 flex gap-0.5 ${
        isFromMe ? "right-2" : "left-2"
      }`}
    >
      {entries.map(([emoji, count]) => (
        <span
          key={emoji}
          className="inline-flex items-center bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-xs shadow-sm"
          title={`${count} reaction${count > 1 ? "s" : ""}`}
        >
          {emoji}
          {count > 1 && <span className="ml-0.5 text-gray-500">{count}</span>}
        </span>
      ))}
    </div>
  );
}
