import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableBorderProps {
  onResize: (delta: number) => void;
  className?: string;
}

export default function ResizableBorder({ onResize, className = "" }: ResizableBorderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      startXRef.current = e.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onResize]);

  return (
    <div
      className={`relative group ${className}`}
      onMouseDown={handleMouseDown}
      style={{ cursor: "col-resize" }}
    >
      {/* Invisible hit area for easier dragging */}
      <div className="absolute inset-y-0 -left-1 -right-1 w-2 cursor-col-resize" />

      {/* Visual indicator */}
      <div
        className={`absolute inset-y-0 left-0 w-[1px] transition-colors ${
          isDragging
            ? "bg-blue-500 dark:bg-blue-400"
            : "bg-gray-200 dark:bg-gray-700 group-hover:bg-blue-400 dark:group-hover:bg-blue-500"
        }`}
      />
    </div>
  );
}
