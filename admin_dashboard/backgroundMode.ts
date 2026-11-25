/**
 * Background mode for auto-tracked roles (Back Office, Validator, Closer,
 * Team Lead): no check-in, tracking from Windows sign-in, all day.
 *   - starts with Windows (hidden, in the tray) and signs itself in;
 *   - closing the window keeps it running in the tray;
 *   - a Windows scheduled task relaunches it every 5 minutes if it was ended
 *     or crashed (a second copy just exits - single-instance lock in main.ts).
 * Installed builds only; a dev run never registers anything with Windows.
 */
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { execFile } from 'child_process';

export const AUTO_TRACKED_CATEGORIES = ['TEAM_LEAD', 'BACK_OFFICE', 'VALIDATOR', 'CLOSER'];
export const AUTOSTART_ARG = '--autostart';
const WATCHDOG_TASK = 'WorkTrackPro Agent Watchdog';

let enabled = false;
let tray: Tray | null = null;
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
});

export function isBackgroundModeEnabled(): boolean {
  return enabled;
}

/** Launched by Windows sign-in / the watchdog - start hidden in the tray. */
export function launchedInBackground(argv: string[] = process.argv): boolean {
  return argv.includes(AUTOSTART_ARG);
}

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}

export function showMainWindow(): void {
  const win = mainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Window close -> hide to the tray while background mode is on (unless the app is really quitting, e.g. an update). */
export function attachCloseToTray(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (enabled && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

async function ensureTray(): Promise<void> {
  if (tray) return;
  try {
    const icon = await app.getFileIcon(process.execPath, { size: 'small' }).catch(() => nativeImage.createEmpty());
    tray = new Tray(icon);
    tray.setToolTip('WorkTrackPro - activity tracking is on');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open WorkTrackPro', click: showMainWindow }]));
    tray.on('click', showMainWindow);
  } catch (err) {
    console.warn('[BackgroundMode] Tray icon unavailable:', err);
  }
}

function runSchtasks(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('schtasks.exe', args, { windowsHide: true, timeout: 15_000 }, (err) => {
      if (err) console.warn(`[BackgroundMode] schtasks ${args[0]} failed:`, err.message);
      resolve(!err);
    });
  });
}

/** Turn background mode on (auto-tracked role signed in). */
export async function enableBackgroundMode(): Promise<void> {
  enabled = true;
  await ensureTray();
  if (!app.isPackaged || process.platform !== 'win32') {
    console.log('[BackgroundMode] Dev run - not registering Windows start-up / watchdog');
    return;
  }
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [AUTOSTART_ARG] });
  await runSchtasks([
    '/Create',
    '/F',
    '/SC',
    'MINUTE',
    '/MO',
    '5',
    '/TN',
    WATCHDOG_TASK,
    '/TR',
    `"${process.execPath}" ${AUTOSTART_ARG}`,
  ]);
  console.log('[BackgroundMode] Starts with Windows + restart watchdog registered');
}

/** Turn background mode off (signed out, or a role that isn't auto-tracked signed in). */
export async function disableBackgroundMode(): Promise<void> {
  enabled = false;
  tray?.destroy();
  tray = null;
  if (!app.isPackaged || process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [AUTOSTART_ARG] });
  await runSchtasks(['/Delete', '/F', '/TN', WATCHDOG_TASK]);
}
