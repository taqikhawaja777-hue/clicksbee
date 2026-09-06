import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { registerCaptureIpcHandlers } from './captureService';
import { registerProductivityCaptureIpcHandlers } from './productivityCapture';
import { registerIdleTimeTrackerIpcHandlers } from './idleTimeTracker';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[DIAGNOSTIC] did-fail-load', { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[DIAGNOSTIC] render-process-gone', details);
  });
  // Renderer console.log/warn/error don't reach the main process's own
  // stdout/stderr by default - bridge them so they show up wherever main.js
  // output is already being captured (a terminal, a redirected log file).
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Without an explicit handler, Electron has no default UI to answer a
  // getUserMedia() camera/mic permission request (unlike a real browser) -
  // on some versions the promise never resolves or rejects at all, it just
  // hangs forever. Consent for the camera-presence feature is already
  // gated by our own in-app modal (CameraConsentModal.tsx) before the
  // renderer ever calls getUserMedia, so auto-granting the OS/Electron-level
  // 'media' permission here isn't bypassing anything - it's completing the
  // same decision the user already made. (session.defaultSession can only
  // be accessed once the app is ready - accessing it at module top-level
  // throws "Session can only be received when app is ready".)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');

  registerCaptureIpcHandlers();
  registerProductivityCaptureIpcHandlers();
  registerIdleTimeTrackerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});