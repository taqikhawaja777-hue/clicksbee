import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
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

let manualUpdateCheckPending = false;
let updatePromptVisible = false;
type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
let updateStatus: { state: UpdateState; message: string; version?: string } = {
  state: 'idle',
  message: 'Updates are checked automatically.',
};

function publishUpdateStatus(state: UpdateState, message: string, version?: string): void {
  updateStatus = { state, message, version };
  console.log(`[AutoUpdater] ${message}`);
  if (app.isReady()) {
    const logPath = path.join(app.getPath('userData'), 'updater.log');
    fs.appendFile(logPath, `${new Date().toISOString()} ${message}\n`, () => undefined);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updater:status', updateStatus);
  }
}

function checkForUpdates(manual = false): void {
  // A development run has no app-update.yml or installed NSIS target, so it
  // cannot update itself. Making that explicit avoids a misleading menu item.
  if (!app.isPackaged) {
    if (manual) {
      void dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: 'Updates are available only in the installed Windows application.',
      });
    }
    return;
  }

  manualUpdateCheckPending = manual;
  publishUpdateStatus('checking', 'Checking for updates…');
  autoUpdater.checkForUpdates().catch((err) => {
    publishUpdateStatus('error', 'Unable to check for updates.');
    if (manual) {
      void dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Unable to check for updates. Please try again later.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function registerAutoUpdaterDialogs(): void {
  // Download only after the employee chooses it in the update prompt.
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', async (info) => {
    publishUpdateStatus('available', `Version ${info.version} is available.`, info.version);
    if (updatePromptVisible) return;
    updatePromptVisible = true;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `WorkTrackPro ${info.version} is available.`,
      detail: 'Download the update now? It will install after you choose Restart and Install.',
      buttons: ['Download Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    updatePromptVisible = false;
    manualUpdateCheckPending = false;

    if (response === 0) {
      publishUpdateStatus('downloading', `Downloading version ${info.version}…`, info.version);
      autoUpdater.downloadUpdate().catch((err) => {
        publishUpdateStatus('error', 'The update could not be downloaded.', info.version);
        void dialog.showMessageBox({
          type: 'error',
          title: 'Update Download Failed',
          message: 'The update could not be downloaded. Please try again later.',
          detail: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    publishUpdateStatus('idle', `WorkTrackPro ${info.version} is up to date.`, info.version);
    if (!manualUpdateCheckPending) return;
    manualUpdateCheckPending = false;
    void dialog.showMessageBox({
      type: 'info',
      title: 'Check for Updates',
      message: `You already have the latest version (${info.version}).`,
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    publishUpdateStatus('ready', `Version ${info.version} is ready to install.`, info.version);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `WorkTrackPro ${info.version} has been downloaded.`,
      detail: 'Restart now to install the update.',
      buttons: ['Restart and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    publishUpdateStatus('error', 'Update service reported an error.');
    console.warn('[AutoUpdater] Error:', err);
  });
}

function createApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => checkForUpdates(true),
        },
        {
          label: 'About WorkTrackPro',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About WorkTrackPro',
              message: `WorkTrackPro ${app.getVersion()}`,
              detail: 'Updates are checked at startup and every four hours. When an update is downloaded, restart the app to install it.',
            });
          },
        },
      ],
    },
  ]));
}

app.whenReady().then(() => {
  const credentialsPath = path.join(app.getPath('userData'), 'auth-credentials.json');
  ipcMain.handle('auth:get-saved-credentials', () => {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(credentialsPath)) return null;
    try {
      const stored = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as { email: string; password: string };
      return {
        email: stored.email,
        password: safeStorage.decryptString(Buffer.from(stored.password, 'base64')),
      };
    } catch (error) {
      console.warn('[Auth] Saved credentials could not be decrypted:', error);
      return null;
    }
  });
  ipcMain.handle('auth:save-credentials', (_event, credentials: { email: string; password: string }) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
    fs.writeFileSync(credentialsPath, JSON.stringify({
      email: credentials.email,
      password: safeStorage.encryptString(credentials.password).toString('base64'),
    }));
    return { success: true };
  });
  ipcMain.handle('auth:clear-saved-credentials', () => {
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
    return { success: true };
  });

  ipcMain.handle('updater:get-status', () => updateStatus);
  createApplicationMenu();
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
  // finds no update to apply there. A GitHub release is offered in a
  // dialog, downloaded only after the user agrees, then installed after
  // they choose "Restart and Install".
  if (process.env.NODE_ENV !== 'development') {
    registerAutoUpdaterDialogs();
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
