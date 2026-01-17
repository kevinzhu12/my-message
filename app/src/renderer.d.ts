export {};

declare global {
  interface Window {
    trackpad?: {
      onSwipePhase?: (
        callback: (data: {
          deltaX: number;
          deltaY: number;
          phase?: string;
          momentumPhase?: string;
        }) => void
      ) => () => void;
    };
    electron?: {
      shell?: {
        openExternal: (url: string) => void;
      };
    };
  }
}
