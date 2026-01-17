import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TIMESTAMP_REVEAL_MAX_PX = 72;
const TIMESTAMP_REVEAL_SCALE = 0.004;
const TIMESTAMP_RELEASE_TIMEOUT_MS = 200;

interface UseTimestampSwipeParams {
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useTimestampSwipe({ containerRef }: UseTimestampSwipeParams) {
  const [timestampReveal, setTimestampReveal] = useState(0);
  const timestampRevealRef = useRef(0);
  const [isTimestampSwipeActive, setIsTimestampSwipeActive] = useState(false);
  const timestampSwipeActiveRef = useRef(false);
  const timestampResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasTrackpadPhaseRef = useRef(false);
  const trackpadActiveRef = useRef(false);

  const setSwipeActive = useCallback((active: boolean) => {
    if (timestampSwipeActiveRef.current !== active) {
      timestampSwipeActiveRef.current = active;
      setIsTimestampSwipeActive(active);
    }
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;

      event.preventDefault();
      event.stopPropagation();

      setSwipeActive(true);

      const delta = event.deltaX * TIMESTAMP_REVEAL_SCALE;
      const next = Math.max(0, Math.min(1, timestampRevealRef.current + delta));
      if (next !== timestampRevealRef.current) {
        timestampRevealRef.current = next;
        setTimestampReveal(next);
      }

      if (timestampResetTimerRef.current) {
        clearTimeout(timestampResetTimerRef.current);
      }
      if (!hasTrackpadPhaseRef.current || !trackpadActiveRef.current) {
        timestampResetTimerRef.current = setTimeout(() => {
          timestampRevealRef.current = 0;
          setTimestampReveal(0);
          setSwipeActive(false);
        }, TIMESTAMP_RELEASE_TIMEOUT_MS);
      }
    },
    [setSwipeActive],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      if (timestampResetTimerRef.current) {
        clearTimeout(timestampResetTimerRef.current);
      }
    };
  }, [containerRef, handleWheel]);

  useEffect(() => {
    if (!window.trackpad?.onSwipePhase) return;

    const unsubscribe = window.trackpad.onSwipePhase((data) => {
      hasTrackpadPhaseRef.current = true;
      const phase = data.phase;
      const momentumPhase = data.momentumPhase;
      const isMomentumActive =
        momentumPhase === "begin" || momentumPhase === "continue";
      const isPhaseActive =
        phase === "began" || phase === "changed" || phase === "mayBegin";
      const isPhaseEnd = phase === "ended" || phase === "cancelled";
      const isMomentumEnd = momentumPhase === "end";

      if (isPhaseActive || isMomentumActive) {
        trackpadActiveRef.current = true;
        if (timestampResetTimerRef.current) {
          clearTimeout(timestampResetTimerRef.current);
          timestampResetTimerRef.current = null;
        }
        if (!timestampSwipeActiveRef.current) {
          setIsTimestampSwipeActive(true);
          timestampSwipeActiveRef.current = true;
        }
        return;
      }

      if (isPhaseEnd || isMomentumEnd) {
        trackpadActiveRef.current = false;
        if (timestampResetTimerRef.current) {
          clearTimeout(timestampResetTimerRef.current);
          timestampResetTimerRef.current = null;
        }
        timestampRevealRef.current = 0;
        setTimestampReveal(0);
        setIsTimestampSwipeActive(false);
        timestampSwipeActiveRef.current = false;
      }
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const timestampShift = useMemo(
    () => Math.round(timestampReveal * TIMESTAMP_REVEAL_MAX_PX),
    [timestampReveal],
  );
  const timestampOpacity = useMemo(
    () => Math.min(1, timestampReveal * 1.2),
    [timestampReveal],
  );

  return {
    timestampShift,
    timestampOpacity,
    isTimestampSwipeActive,
  };
}
