import { app, BrowserWindow } from 'electron';
import path from 'path';

type TrackpadPhaseEvent = Electron.MouseWheelInputEvent & {
  phase?: string;
  momentumPhase?: string;
};

function isMouseWheelEvent(
  input: Electron.InputEvent,
): input is Electron.MouseWheelInputEvent {
  return input.type === 'mouseWheel';
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.webContents.on('input-event', (_event, input) => {
    if (!isMouseWheelEvent(input)) return;

    const { deltaX = 0, deltaY = 0, phase, momentumPhase } =
      input as TrackpadPhaseEvent;

    if (Math.abs(deltaX) < Math.abs(deltaY)) return;
    if (!phase && !momentumPhase) return;

    mainWindow.webContents.send('trackpad-swipe-phase', {
      deltaX,
      deltaY,
      phase,
      momentumPhase,
    });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
