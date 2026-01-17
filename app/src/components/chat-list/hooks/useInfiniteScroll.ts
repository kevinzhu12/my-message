import type { RefObject } from "react";
import { useEffect } from "react";

interface UseInfiniteScrollOptions {
  rootRef: RefObject<HTMLElement>;
  targetRef: RefObject<HTMLElement>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

const useInfiniteScroll = ({
  rootRef,
  targetRef,
  hasMore,
  loadingMore,
  onLoadMore,
}: UseInfiniteScrollOptions) => {
  useEffect(() => {
    const root = rootRef.current;
    const target = targetRef.current;

    if (!root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore();
        }
      },
      {
        root,
        threshold: 0.1,
        rootMargin: "100px",
      },
    );

    observer.observe(target);

    return () => {
      observer.unobserve(target);
    };
  }, [hasMore, loadingMore, onLoadMore, rootRef, targetRef]);
};

export default useInfiniteScroll;
