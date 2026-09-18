import { app, BrowserWindow, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import os from 'os';
import { registerCaptureIpcHandlers } from './captureService';
import { registerProductivityCaptureIpcHandlers } from './productivityCapture';
import { registerIdleTimeTrackerIpcHandlers } from './idleTimeTracker';
import { registerLocalSettingsIpcHandlers } from './localSettings';
import { registerLocalScreenshotServerIpcHandlers, startLocalScreenshotServer } from './localScreenshotServer';
import { startScreenshotCleanupSweep } from './screenshotCleanup';

// Electron's default (native Wayland) Ozone backend has known GPU
// compositing bugs on this machine's Intel/Mesa/GNOME-Wayland stack, which
// show up as severely laggy clicks/scrolls - the renderer ends up doing
// software rendering instead of GPU-accelerated compositing. VSCode itself
// forces the same X11 (XWayland) fallback on this system for the same
// reason (visible in its own process args). Must be set before app is
// ready. Windows (the real deployment target) has no Ozone/Wayland
// concept, so this is a no-op there.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

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
  // Cooperative, not a hard cap: this only changes how Windows' scheduler
  // arbitrates CPU time under contention (maps to SetPriorityClass on
  // Windows, a nice adjustment on Linux/macOS) - on an idle machine this
  // process still gets full CPU, it just yields first to foreground apps
  // when the 2-core/4-thread laptops this runs on are actually busy.
  try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (err) {
    console.warn('[main] Failed to lower process priority (platform/permissions may not allow it):', err);
  }

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
  registerLocalSettingsIpcHandlers();
  registerLocalScreenshotServerIpcHandlers();

  // Local-network screenshot receiver + its daily cleanup sweep - runs on
  // every install regardless of role (harmless if nobody ever POSTs to it
  // on an employee's machine; a manager's machine is exactly where this
  // needs to be listening). Replaces the old MongoDB Atlas upload path.
  startLocalScreenshotServer();
  startScreenshotCleanupSweep();

  createWindow();

  // Auto-update from this repo's GitHub Releases (see package.json's
  // build.publish config) - only meaningful for a real packaged build
  // (electron-builder generates the app-update.yml this reads; a dev run
  // has no such file and no installer to update in place). Only the NSIS
  // installer target supports being updated this way - the portable .exe
  // target has no installed location to update into, so this silently
  // finds no update to apply there. checkForUpdatesAndNotify() downloads
  // in the background and shows a native OS notification once ready; the
  // update then applies on the app's next normal restart, never forcing
  // one mid-shift.
  if (process.env.NODE_ENV !== 'development') {
    const checkForUpdates = () => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[AutoUpdater] Update check failed:', err);
      });
    };
    autoUpdater.on('error', (err) => console.warn('[AutoUpdater] Error:', err));
    autoUpdater.on('update-available', (info) => console.log('[AutoUpdater] Update available:', info.version));
    autoUpdater.on('update-downloaded', (info) => console.log('[AutoUpdater] Update downloaded, will install on next restart:', info.version));
    checkForUpdates();
    setInterval(checkForUpdates, 4 * 60 * 60 * 1000); // re-check every 4h - this app never quits on its own
  }
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