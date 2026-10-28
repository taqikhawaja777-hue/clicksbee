/**
 * IdleTimeTracker — Electron Main Process
 *
 * Always-on, whole-workday counterpart to ProductivityCaptureService (which
 * only runs for the duration of one Task Session). Tracks mouse/keyboard
 * idle time and which application is focused for the entire day, with
 * dedicated recognition of Cisco Jabber, Wildix, and Yeastar Linkus Lite, and reports cumulative
 * daily totals to the backend MongoDB tracking API at `/api/v1/tracking/idle-snapshots`.
 *
 * - Polls every 15-30s (POLL_INTERVAL_MS below) via
 *   `powerMonitor.getSystemIdleTime()` for idle detection and the optional
 *   `active-win` package for the focused window.
 * - Detects dialers running in background, minimized, on-call, or as tray app.
 * - Accumulates cumulative totals in memory and POSTs the current day-to-date snapshot.
 * - Persistent disk-backed queue on network failure with automatic retry and idempotent upserts.
 * - Resets accumulators at the shift's 19:00 Asia/Karachi rollover.
 */
import { powerMonitor, ipcMain, app } from 'electron';
import { BACKEND_URL } from './serverConfig';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

export type ActiveAppLabel = 'Cisco Jabber' | 'Wildix' | 'Yeastar Linkus Lite' | 'Other';

const IDLE_THRESHOLD_SECONDS = 300; // 5 minutes (configurable)
const POLL_INTERVAL_MS = 20000; // 20s
const BATCH_INTERVAL_MS = 90000; // 90s
const API_BASE_URL_DEFAULT = BACKEND_URL;

// Configurable dialer alias mapping - covers Windows, Linux, and macOS process & window names
export const DIALER_SIGNATURES: Record<'Cisco Jabber' | 'Wildix' | 'Yeastar Linkus Lite', RegExp[]> = {
  'Cisco Jabber': [
    /cisco\s*jabber/i,
    /^ciscojabber(\.exe)?$/i,
    /^jabber(\.exe)?$/i,
    /^ciscocollabhost(\.exe)?$/i,
    /\bjabber\b/i,
    /cisco\s*collab/i,
  ],
  'Wildix': [
    /wildix/i,
    /^wixphone(\.exe)?$/i,
    /^x-bees(\.exe)?$/i,
    /^wildix(\.exe)?$/i,
    /wildix\s*collaboration/i,
  ],
  'Yeastar Linkus Lite': [
    /yeastar|yeaster|linkus/i,
    /^linkus(\.exe)?$/i,
    /linkus\s*lite/i,
    /yeastar\s*linkus/i,
  ],
};

interface ActiveWinResult {
  owner?: { name?: string; path?: string };
  title?: string;
}

interface QueuedSnapshot {
  userId: string;
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  appFocusSeconds: Record<string, number>;
  lastActiveApp: string | null;
  lastIsIdle: boolean;
  queuedAt: number;
}

function classifyActiveApp(win: ActiveWinResult | null): ActiveAppLabel {
  if (!win) return 'Other';
  const candidates = [win.owner?.name, win.owner?.path, win.title].filter(
    (v): v is string => !!v,
  );
  for (const candidate of candidates) {
    if (DIALER_SIGNATURES['Cisco Jabber'].some((re) => re.test(candidate))) return 'Cisco Jabber';
    if (DIALER_SIGNATURES['Wildix'].some((re) => re.test(candidate))) return 'Wildix';
    if (DIALER_SIGNATURES['Yeastar Linkus Lite'].some((re) => re.test(candidate))) return 'Yeastar Linkus Lite';
  }
  return 'Other';
}

// Fixed UTC+5 offset for Asia/Karachi (Pakistan has no DST)
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const SHIFT_START_MINUTES_OF_DAY = 10 * 60; // 10:00
const SHIFT_END_MINUTES_OF_DAY = 19 * 60; // 19:00

const SCHEDULED_BREAKS = [
  { start: 13 * 60 + 30, end: 14 * 60 + 10 }, // Lunch & Zuhr (13:30 - 14:10)
  { start: 17 * 60, end: 17 * 60 + 20 }, // Tea & Asar (17:00 - 17:20)
];

function getShiftDayKey(d: Date = new Date()): string {
  const karachi = new Date(d.getTime() + KARACHI_OFFSET_MS);
  const year = karachi.getUTCFullYear();
  const month = String(karachi.getUTCMonth() + 1).padStart(2, '0');
  const day = String(karachi.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getKarachiMinutesOfDay(d: Date = new Date()): number {
  const karachi = new Date(d.getTime() + KARACHI_OFFSET_MS);
  return karachi.getUTCHours() * 60 + karachi.getUTCMinutes();
}

function isTrackableWorkTime(d: Date = new Date()): boolean {
  const minutes = getKarachiMinutesOfDay(d);
  return minutes >= SHIFT_START_MINUTES_OF_DAY
    && minutes < SHIFT_END_MINUTES_OF_DAY
    && !SCHEDULED_BREAKS.some((period) => minutes >= period.start && minutes < period.end);
}

class IdleTimeTracker {
  private isTracking = false;
  private employeeId = '';
  private apiBaseUrl = API_BASE_URL_DEFAULT;

  private pollTimer: NodeJS.Timeout | null = null;
  private batchTimer: NodeJS.Timeout | null = null;
  private queueFlushTimer: NodeJS.Timeout | null = null;

  // Running dialer processes detected in background/tray
  private runningDialerCache: { app: ActiveAppLabel | null; timestamp: number } = {
    app: null,
    timestamp: 0,
  };

  // Day-accumulated state
  private dateKey = '';
  private activeSeconds = 0;
  private idleSeconds = 0;
  private appFocusSeconds: Record<string, number> = {};
  private lastActiveApp: string | null = null;
  private lastIsIdle = false;

  private getQueueFilePath(): string {
    try {
      const userDataDir = app?.getPath ? app.getPath('userData') : process.cwd();
      return path.join(userDataDir, 'worktrackpro_idle_queue.json');
    } catch {
      return path.join(process.cwd(), 'worktrackpro_idle_queue.json');
    }
  }

  private loadQueue(): QueuedSnapshot[] {
    try {
      const file = this.getQueueFilePath();
      if (!fs.existsSync(file)) return [];
      const content = fs.readFileSync(file, 'utf-8');
      return JSON.parse(content) || [];
    } catch (e) {
      console.warn('[IdleTimeTracker] Could not load offline queue:', e);
      return [];
    }
  }

  private saveQueue(queue: QueuedSnapshot[]): void {
    try {
      const file = this.getQueueFilePath();
      fs.writeFileSync(file, JSON.stringify(queue.slice(-50)), 'utf-8');
    } catch (e) {
      console.warn('[IdleTimeTracker] Could not save offline queue:', e);
    }
  }

  private enqueueSnapshot(snapshot: QueuedSnapshot): void {
    const queue = this.loadQueue();
    // Replace existing snapshot for same userId + date or append
    const idx = queue.findIndex((q) => q.userId === snapshot.userId && q.date === snapshot.date);
    if (idx >= 0) {
      queue[idx] = snapshot;
    } else {
      queue.push(snapshot);
    }
    this.saveQueue(queue);
  }

  private async drainQueue(): Promise<void> {
    const queue = this.loadQueue();
    if (queue.length === 0) return;

    const remaining: QueuedSnapshot[] = [];
    for (const item of queue) {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/v1/tracking/idle-snapshots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: item.userId,
            date: item.date,
            activeSeconds: Math.round(item.activeSeconds),
            idleSeconds: Math.round(item.idleSeconds),
            appFocusSeconds: item.appFocusSeconds,
            lastActiveApp: item.lastActiveApp,
            lastIsIdle: item.lastIsIdle,
          }),
        });
        if (!response.ok && response.status >= 500) {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
      }
    }
    this.saveQueue(remaining);
  }

  public start(employeeId: string, apiBaseUrl: string = API_BASE_URL_DEFAULT): void {
    if (this.isTracking) {
      if (this.employeeId === employeeId) {
        console.log('[IdleTimeTracker] Already tracking this employee, ignoring duplicate start.');
        return;
      }
      console.log(`[IdleTimeTracker] Switching tracked employee ${this.employeeId} -> ${employeeId}`);
      this.stop();
    }

    this.employeeId = employeeId;
    this.apiBaseUrl = (apiBaseUrl || API_BASE_URL_DEFAULT).replace(/\/+$/, '');
    this.isTracking = true;
    this.resetAccumulatorsForNewDay(getShiftDayKey());

    console.log(`[IdleTimeTracker] Starting idle/active tracking for employeeId=${employeeId}`);

    void this.drainQueue();
    void this.resumeFromExistingSnapshot().finally(() => {
      if (!this.isTracking) return;
      void this.pollActivity().then(() => this.flushSnapshot());
    });

    this.pollTimer = setInterval(() => {
      void this.pollActivity();
    }, POLL_INTERVAL_MS);

    this.batchTimer = setInterval(() => {
      void this.flushSnapshot();
    }, BATCH_INTERVAL_MS);

    this.queueFlushTimer = setInterval(() => {
      void this.drainQueue();
    }, 120000);
  }

  public getStatus() {
    return {
      isTracking: this.isTracking,
      employeeId: this.employeeId,
      date: this.dateKey,
      activeSeconds: this.activeSeconds,
      idleSeconds: this.idleSeconds,
      appFocusSeconds: { ...this.appFocusSeconds },
      lastActiveApp: this.lastActiveApp,
      lastIsIdle: this.lastIsIdle,
    };
  }

  private async getActiveWinResult(): Promise<ActiveWinResult | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const activeWin = require('active-win');
      const result = await activeWin();
      if (result) return result;
    } catch {
      // active-win not installed or unsupported
    }
    return null;
  }

  /**
   * Checks whether any supported dialer process is running in background or tray.
   */
  private async getBackgroundRunningDialer(): Promise<ActiveAppLabel | null> {
    const now = Date.now();
    // Cache for 15 seconds to avoid spawning process too often
    if (now - this.runningDialerCache.timestamp < 15000) {
      return this.runningDialerCache.app;
    }

    return new Promise<ActiveAppLabel | null>((resolve) => {
      if (process.platform === 'win32') {
        execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeout: 3000 }, (err, stdout) => {
          let detected: ActiveAppLabel | null = null;
          if (!err && stdout) {
            const lines = stdout.split('\n');
            for (const line of lines) {
              const procMatch = line.match(/^"([^"]+)"/);
              const procName = procMatch ? procMatch[1] : '';
              if (DIALER_SIGNATURES['Cisco Jabber'].some((re) => re.test(procName))) {
                detected = 'Cisco Jabber';
                break;
              }
              if (DIALER_SIGNATURES['Wildix'].some((re) => re.test(procName))) {
                detected = 'Wildix';
                break;
              }
              if (DIALER_SIGNATURES['Yeastar Linkus Lite'].some((re) => re.test(procName))) {
                detected = 'Yeastar Linkus Lite';
                break;
              }
            }
          }
          this.runningDialerCache = { app: detected, timestamp: now };
          resolve(detected);
        });
      } else {
        this.runningDialerCache = { app: null, timestamp: now };
        resolve(null);
      }
    });
  }

  private resetAccumulatorsForNewDay(newDateKey: string): void {
    this.dateKey = newDateKey;
    this.activeSeconds = 0;
    this.idleSeconds = 0;
    this.appFocusSeconds = {};
    this.lastActiveApp = null;
    this.lastIsIdle = false;
  }

  private async resumeFromExistingSnapshot(): Promise<void> {
    try {
      const today = this.dateKey;
      const url = `${this.apiBaseUrl}/api/v1/tracking/idle-snapshots?employeeId=${this.employeeId}&startDate=${today}&endDate=${today}`;
      const response = await fetch(url);
      if (!response.ok) return;
      const payload = await response.json();
      const rows: Array<{
        date: string;
        activeSeconds: number;
        idleSeconds: number;
        appFocusSeconds: Record<string, number>;
        lastActiveApp: string | null;
        lastIsIdle: boolean;
      }> = Array.isArray(payload) ? payload : (payload?.data || []);
      const row = rows.find((r) => r.date === today);
      if (!row) return;

      this.activeSeconds = Math.max(this.activeSeconds, row.activeSeconds || 0);
      this.idleSeconds = Math.max(this.idleSeconds, row.idleSeconds || 0);
      this.appFocusSeconds = { ...(row.appFocusSeconds || {}), ...this.appFocusSeconds };
      this.lastActiveApp = row.lastActiveApp ?? this.lastActiveApp;
      this.lastIsIdle = row.lastIsIdle ?? this.lastIsIdle;
      console.log(
        `[IdleTimeTracker] Resumed today's snapshot: active=${this.activeSeconds}s idle=${this.idleSeconds}s`,
      );
    } catch (err) {
      console.warn('[IdleTimeTracker] Failed to resume existing snapshot, starting from zero:', err);
    }
  }

  public stop(): void {
    if (!this.isTracking) return;
    console.log('[IdleTimeTracker] Stopping idle/active tracking.');
    this.isTracking = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.queueFlushTimer) {
      clearInterval(this.queueFlushTimer);
      this.queueFlushTimer = null;
    }

    void this.flushSnapshot();
  }

  private async pollActivity(): Promise<void> {
    if (!this.isTracking) return;

    if (!isTrackableWorkTime()) {
      return;
    }

    const todayKey = getShiftDayKey();
    if (todayKey !== this.dateKey) {
      await this.flushSnapshot();
      this.resetAccumulatorsForNewDay(todayKey);
    }

    const idleSecondsNow = powerMonitor.getSystemIdleTime();
    const systemIdle = idleSecondsNow >= IDLE_THRESHOLD_SECONDS;
    const win = await this.getActiveWinResult();
    let appLabel = classifyActiveApp(win);

    // If focused app is not a dialer, check if a dialer is running in background/tray
    const backgroundDialer = await this.getBackgroundRunningDialer();
    
    let isIdle = systemIdle;
    if (systemIdle && (appLabel === 'Cisco Jabber' || appLabel === 'Wildix' || appLabel === 'Yeastar Linkus Lite' || backgroundDialer)) {
      // User is on a headset/voice call via the dialer: exempt from idle
      isIdle = false;
      if (appLabel === 'Other' && backgroundDialer) {
        appLabel = backgroundDialer;
      }
    }

    const pollSeconds = POLL_INTERVAL_MS / 1000;
    if (isIdle) {
      this.idleSeconds += pollSeconds;
    } else {
      this.activeSeconds += pollSeconds;
      this.appFocusSeconds[appLabel] = (this.appFocusSeconds[appLabel] || 0) + pollSeconds;
      // If employee is actively working in another app while dialer runs in background,
      // also ensure dialer receives focus credit
      if (backgroundDialer && appLabel !== backgroundDialer) {
        this.appFocusSeconds[backgroundDialer] = (this.appFocusSeconds[backgroundDialer] || 0) + pollSeconds;
      }
    }

    this.lastActiveApp = isIdle ? null : appLabel;
    this.lastIsIdle = isIdle;
  }

  private async flushSnapshot(): Promise<void> {
    if (!this.employeeId) return;

    const snapshotPayload = {
      userId: this.employeeId,
      date: this.dateKey,
      activeSeconds: Math.round(this.activeSeconds),
      idleSeconds: Math.round(this.idleSeconds),
      appFocusSeconds: Object.fromEntries(
        Object.entries(this.appFocusSeconds).map(([k, v]) => [k, Math.round(v)]),
      ),
      lastActiveApp: this.lastActiveApp,
      lastIsIdle: this.lastIsIdle,
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/tracking/idle-snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshotPayload),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      console.log(
        `[IdleTimeTracker] Synced snapshot: active=${snapshotPayload.activeSeconds}s idle=${snapshotPayload.idleSeconds}s`,
      );
    } catch (err) {
      console.warn('[IdleTimeTracker] Failed to sync snapshot, enqueuing locally for retry:', err);
      this.enqueueSnapshot({ ...snapshotPayload, queuedAt: Date.now() });
    }
  }
}

export const idleTimeTracker = new IdleTimeTracker();

export function registerIdleTimeTrackerIpcHandlers(): void {
  ipcMain.handle(
    'start-idle-time-tracking',
    async (_event, args: { employeeId: string; apiBaseUrl?: string }) => {
      const employeeId = args?.employeeId;
      const apiBaseUrl = args?.apiBaseUrl || API_BASE_URL_DEFAULT;
      if (!employeeId) {
        return { success: false, error: 'Missing employeeId' };
      }
      try {
        idleTimeTracker.start(employeeId, apiBaseUrl);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
  );

  ipcMain.handle('stop-idle-time-tracking', async () => {
    try {
      idleTimeTracker.stop();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('get-idle-time-tracker-status', () => {
    return { success: true, ...idleTimeTracker.getStatus() };
  });

  console.log('[IdleTimeTracker] IPC handlers registered.');
}
