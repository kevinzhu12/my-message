import { contextBridge, ipcRenderer, shell } from "electron";

contextBridge.exposeInMainWorld("electron", {
  shell: {
    openExternal: (url: string) => shell.openExternal(url),
  },
});

contextBridge.exposeInMainWorld("trackpad", {
  onSwipePhase: (
    callback: (data: {
      deltaX: number;
      deltaY: number;
      phase?: string;
      momentumPhase?: string;
    }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        deltaX: number;
        deltaY: number;
        phase?: string;
        momentumPhase?: string;
      }
    ) => callback(data);
    ipcRenderer.on("trackpad-swipe-phase", handler);
    return () => {
      ipcRenderer.removeListener("trackpad-swipe-phase", handler);
    };
  },
});
