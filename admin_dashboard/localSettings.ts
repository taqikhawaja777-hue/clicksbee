import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Persisted settings for the local-network screenshot pipeline (replaces
 * the old MongoDB Atlas upload path). No settings-persistence mechanism
 * existed anywhere in this app before this file - not electron-store (not
 * a dependency), not a hand-rolled JSON file, nothing (confirmed: the only
 * "persistence" anywhere was renderer-side localStorage). A plain JSON
 * file under Electron's per-OS userData directory is the simplest thing
 * that actually survives an app restart, which localStorage-in-the-
 * renderer-only never did for anything main-process-owned like a listening
 * HTTP server's port.
 *
 * The same settings object is used regardless of whether this install is
 * running as a manager (who cares about localServerPort/screenshotStoragePath -
 * their OWN local server's config) or an employee (who cares about
 * adminPcIp/adminPcPort - where to SEND captures). Harmless to have unused
 * fields depending on role, and far simpler than two separate schemas.
 */
export interface LocalSettings {
  localServerPort: number;
  screenshotStoragePath: string;
  adminPcIp: string;
  adminPcPort: number;
}

const DEFAULT_SETTINGS: LocalSettings = {
  localServerPort: 5000,
  screenshotStoragePath: 'C:\\WorkTrackPro-Screenshots',
  adminPcIp: '',
  adminPcPort: 5000,
};

function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), 'worktrackpro-local-settings.json');
}

let cachedSettings: LocalSettings | null = null;

export function getLocalSettings(): LocalSettings {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = fs.readFileSync(getSettingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    // Merge onto defaults - a settings file saved by an older build
    // missing a newer field must never come back undefined (same lesson
    // as the renderer's own localStorage-merge fix for stitch_employee_state).
    cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings as LocalSettings;
}

export function updateLocalSettings(updates: Partial<LocalSettings>): LocalSettings {
  const next = { ...getLocalSettings(), ...updates };
  cachedSettings = next;
  try {
    fs.mkdirSync(path.dirname(getSettingsFilePath()), { recursive: true });
    fs.writeFileSync(getSettingsFilePath(), JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[localSettings] Failed to persist settings to disk:', err);
  }
  return next;
}

/** Every non-internal IPv4 address this machine has on the LAN - shown in
 * Settings so a manager can tell employees what to type into "Admin PC IP",
 * without needing to open a terminal and run ipconfig themselves. */
export function getLanIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

export function registerLocalSettingsIpcHandlers(): void {
  ipcMain.handle('get-local-settings', async () => {
    return { settings: getLocalSettings(), lanIpAddresses: getLanIpAddresses() };
  });

  ipcMain.handle('set-local-settings', async (_event, updates: Partial<LocalSettings>) => {
    return updateLocalSettings(updates);
  });
}
