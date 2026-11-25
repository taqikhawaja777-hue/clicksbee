/**
 * IdleTimeTracker — Electron Main Process
 *
 * Always-on, whole-workday counterpart to ProductivityCaptureService (which
 * only runs for the duration of one Task Session). Tracks mouse/keyboard
 * idle time and which application is focused for the entire day, with
 * dedicated recognition of Cisco Jabber, the 3CX web dialer, and Yeastar Linkus Lite, and reports cumulative
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
import { powerMonitor, ipcMain, app, BrowserWindow, Notification, shell } from 'electron';
import { BACKEND_URL } from './serverConfig';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  ActivityState,
  ACTIVE_STATES,
  CALL_MERGE_GAP_SECONDS,
  DEFAULT_UNPRODUCTIVE_KEYWORDS,
  DIALER_CONTEXT_SECONDS,
  DialerLabel,
  IDLE_STATES,
  IDLE_THRESHOLD_SECONDS,
  NO_CALL_ALERT_SECONDS,
  SPREADSHEET_INPUT_SECONDS,
  analyzeInputPattern,
  classifyTick,
  isSpreadsheetWindow,
  isUnproductiveWindow,
} from './activityClassifier';
import { AudioLevelProbe, InputSampler, ScreenChangeSampler, readMicrophoneUsers } from './activitySignals';
import { authHeaders } from './authSession';

export type ActiveAppLabel = 'Cisco Jabber' | '3CX' | 'Yeastar Linkus Lite' | 'Other';

/** Per-day call/activity breakdown sent with every snapshot (backend: IdleTimeLog.activityBreakdown). */
interface ActivityBreakdown {
  callSeconds: number;
  callCount: number;
  dialingSeconds: number;
  otherWorkSeconds: number;
  unproductiveSeconds: number;
  suspiciousSeconds: number;
  longestNoCallGapSeconds: number;
  /** Spreadsheet in front + mouse/keyboard use - part of active time, not extra. */
  spreadsheetSeconds: number;
}

const emptyBreakdown = (): ActivityBreakdown => ({
  callSeconds: 0,
  callCount: 0,
  dialingSeconds: 0,
  otherWorkSeconds: 0,
  unproductiveSeconds: 0,
  suspiciousSeconds: 0,
  longestNoCallGapSeconds: 0,
  spreadsheetSeconds: 0,
});

const POLL_INTERVAL_MS = 10000; // 10s - call start/end resolution
const BATCH_INTERVAL_MS = 90000; // 90s
const API_BASE_URL_DEFAULT = BACKEND_URL;

// Configurable dialer alias mapping - covers Windows, Linux, and macOS process & window names
export const DIALER_SIGNATURES: Record<'Cisco Jabber' | '3CX' | 'Yeastar Linkus Lite', RegExp[]> = {
  'Cisco Jabber': [
    /cisco\s*jabber/i,
    /^ciscojabber(\.exe)?$/i,
    /^jabber(\.exe)?$/i,
    /^ciscocollabhost(\.exe)?$/i,
    /\bjabber\b/i,
    /cisco\s*collab/i,
  ],
  // 3CX web dialer (https://dialpro.3cx.ca:5001). Windows can't read a
  // browser's URL, so it's matched on the window title: the page title is
  // "3CX Webclient", i.e. "3CX Webclient - Google Chrome" / "- Microsoft Edge".
  // Also covers the 3CX desktop/installed app (3CXDesktopApp.exe, "3CX").
  '3CX': [
    /3cx/i,
    /dialpro\.3cx/i,
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
  activityBreakdown?: ActivityBreakdown;
  lastState?: ActivityState | null;
  idleSince?: string | null;
  queuedAt: number;
}

function classifyActiveApp(win: ActiveWinResult | null): ActiveAppLabel {
  if (!win) return 'Other';
  const candidates = [win.owner?.name, win.owner?.path, win.title].filter(
    (v): v is string => !!v,
  );
  for (const candidate of candidates) {
    if (DIALER_SIGNATURES['Cisco Jabber'].some((re) => re.test(candidate))) return 'Cisco Jabber';
    if (DIALER_SIGNATURES['3CX'].some((re) => re.test(candidate))) return '3CX';
    if (DIALER_SIGNATURES['Yeastar Linkus Lite'].some((re) => re.test(candidate))) return 'Yeastar Linkus Lite';
  }
  return 'Other';
}

// Fixed UTC+5 offset for Asia/Karachi (Pakistan has no DST)
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const SHIFT_START_MINUTES_OF_DAY = 10 * 60; // 10:00
const SHIFT_END_MINUTES_OF_DAY = 19 * 60; // 19:00

const SCHEDULED_BREAKS = [
  { start: 14 * 60, end: 15 * 60 }, // the only break: 2:00 PM - 3:00 PM (same as backend shift-day.util.ts)
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

export function isBeforeShiftEnd(d: Date = new Date()): boolean {
  return getKarachiMinutesOfDay(d) < SHIFT_END_MINUTES_OF_DAY;
}

export function isScheduledBreakNow(d: Date = new Date()): boolean {
  const minutes = getKarachiMinutesOfDay(d);
  return SCHEDULED_BREAKS.some((period) => minutes >= period.start && minutes < period.end);
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

  // Current idle episode (ms epoch of the last input), for the idle alert.
  private idleEpisodeStart: number | null = null;
  private idleNotification: Notification | null = null;

  // Activity classification (see activityClassifier.ts)
  private breakdown: ActivityBreakdown = emptyBreakdown();
  private lastState: ActivityState | null = null;
  private inCall = false;
  private lastCallDialer: DialerLabel | null = null;
  private lastCallEndedAt: number | null = null;
  private lastThreeCxFocusAt = 0;
  private foregroundKey = '';
  private foregroundChangeTimes: number[] = [];
  private noCallAlerted = false;
  private suspiciousSince: number | null = null;
  private gapPausedForBreak = false;
  private unproductiveKeywords: string[] = DEFAULT_UNPRODUCTIVE_KEYWORDS;
  private lastDiagnostics: Record<string, unknown> = {};
  private readonly audioProbe = new AudioLevelProbe();
  private readonly inputSampler = new InputSampler();
  private readonly screenSampler = new ScreenChangeSampler();

  private flexibleHours = false;

  /** Back Office / Validator: no duty hours or breaks - count activity at any time of day. */
  public setFlexibleHours(flexible: boolean): void {
    this.flexibleHours = flexible;
  }

  public setUnproductiveKeywords(keywords: string[] | null | undefined): void {
    this.unproductiveKeywords = Array.isArray(keywords) ? keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean) : DEFAULT_UNPRODUCTIVE_KEYWORDS;
  }

  /** "No call for 15 min" and "suspicious activity" alerts - renderer beeps, shows and reports them. */
  private sendActivityAlert(payload: Record<string, unknown>, notificationBody?: string): void {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('activity-alert', payload);
    });
    if (!notificationBody) return;
    try {
      shell.beep();
      if (Notification.isSupported()) {
        new Notification({ title: 'WorkTrackPro', body: notificationBody, urgency: 'critical' }).show();
      }
    } catch {
      // no notification support
    }
  }

  /**
   * Idle alert on the employee's PC the moment they cross the idle
   * threshold: Windows notification with sound, a beep, and a flashing
   * taskbar button. The renderer shows the in-app alert and reports the
   * event (it holds the login token) - see IdleAlertWatcher.tsx.
   */
  private startIdleEpisode(idleSince: number): void {
    this.idleEpisodeStart = idleSince;
    this.sendIdleAlert({ state: 'idle', idleSince: new Date(idleSince).toISOString() });
    try {
      shell.beep();
    } catch {
      // no sound device
    }
    try {
      if (Notification.isSupported()) {
        this.idleNotification?.close();
        // Windows often shows only the title of a collapsed notification - keep the time in it.
        const since = new Date(idleSince).toLocaleTimeString('en-US', {
          timeZone: 'Asia/Karachi',
          hour: 'numeric',
          minute: '2-digit',
        });
        const notification = new Notification({
          title: `You are idle since ${since}`,
          body: 'Move your mouse or press any key to continue working.',
          urgency: 'critical',
          timeoutType: 'never',
        });
        notification.on('click', () => {
          const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
          if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
        });
        notification.show();
        this.idleNotification = notification;
      }
    } catch (err) {
      console.warn('[IdleTimeTracker] Could not show idle notification:', err);
    }
    BrowserWindow.getAllWindows().forEach((w) => {
      if (w.isDestroyed()) return;
      w.flashFrame(true);
      // Bring the app in front (without taking the keyboard) so the "You are
      // idle" message is actually on screen, not behind other programs.
      try {
        if (w.webContents.isOffscreen()) return; // hidden helper window (screenshot stamping), never shown
        if (w.isMinimized()) w.restore();
        if (!w.isVisible()) w.showInactive();
        w.moveTop();
      } catch {
        // window closing
      }
    });
  }

  /** reason 'active' = input resumed; 'break'/'stopped' = closed without the person returning. */
  private endIdleEpisode(reason: 'active' | 'break' | 'stopped', endedAt: number = Date.now()): void {
    if (this.idleEpisodeStart === null) return;
    const idleSince = this.idleEpisodeStart;
    this.idleEpisodeStart = null;
    this.sendIdleAlert({
      state: 'active',
      reason,
      idleSince: new Date(idleSince).toISOString(),
      endedAt: new Date(Math.max(endedAt, idleSince)).toISOString(),
    });
    try {
      this.idleNotification?.close();
    } catch {
      // already dismissed
    }
    this.idleNotification = null;
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.flashFrame(false);
    });
  }

  private sendIdleAlert(payload: Record<string, unknown>): void {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('idle-alert', payload);
    });
  }

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
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            userId: item.userId,
            date: item.date,
            activeSeconds: Math.round(item.activeSeconds),
            idleSeconds: Math.round(item.idleSeconds),
            appFocusSeconds: item.appFocusSeconds,
            lastActiveApp: item.lastActiveApp,
            lastIsIdle: item.lastIsIdle,
            activityBreakdown: item.activityBreakdown,
            lastState: item.lastState ?? null,
            idleSince: item.idleSince ?? null,
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

    this.inputSampler.start();
    this.screenSampler.start();
    this.audioProbe.start();

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
              if (DIALER_SIGNATURES['3CX'].some((re) => re.test(procName))) {
                detected = '3CX';
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
    this.breakdown = emptyBreakdown();
    this.lastState = null;
    this.inCall = false;
    this.lastCallDialer = null;
    this.lastCallEndedAt = null;
    this.noCallAlerted = false;
    this.suspiciousSince = null;
    this.gapPausedForBreak = false;
  }

  private async resumeFromExistingSnapshot(): Promise<void> {
    try {
      const today = this.dateKey;
      const url = `${this.apiBaseUrl}/api/v1/tracking/idle-snapshots?employeeId=${this.employeeId}&startDate=${today}&endDate=${today}`;
      const response = await fetch(url, { headers: authHeaders() });
      if (!response.ok) return;
      const payload = await response.json();
      const rows: Array<{
        date: string;
        activeSeconds: number;
        idleSeconds: number;
        appFocusSeconds: Record<string, number>;
        lastActiveApp: string | null;
        lastIsIdle: boolean;
        activityBreakdown?: Partial<ActivityBreakdown> | null;
      }> = Array.isArray(payload) ? payload : (payload?.data || []);
      const row = rows.find((r) => r.date === today);
      if (!row) return;

      this.activeSeconds = Math.max(this.activeSeconds, row.activeSeconds || 0);
      this.idleSeconds = Math.max(this.idleSeconds, row.idleSeconds || 0);
      this.appFocusSeconds = { ...(row.appFocusSeconds || {}), ...this.appFocusSeconds };
      this.lastActiveApp = row.lastActiveApp ?? this.lastActiveApp;
      this.lastIsIdle = row.lastIsIdle ?? this.lastIsIdle;
      const saved = row.activityBreakdown || {};
      (Object.keys(this.breakdown) as (keyof ActivityBreakdown)[]).forEach((k) => {
        this.breakdown[k] = Math.max(this.breakdown[k], Number(saved[k]) || 0);
      });
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
    this.endIdleEpisode('stopped');
    this.inputSampler.stop();
    this.screenSampler.stop();
    this.audioProbe.stop();

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
    const now = Date.now();

    // Back Office / Validator have no duty hours - tracked at any time of day.
    if (!this.flexibleHours && !isTrackableWorkTime()) {
      // Break or off-shift: nothing is counted, open episodes end, and the
      // "no call" gap pauses (it restarts when work time resumes).
      this.endIdleEpisode('break');
      this.suspiciousSince = null;
      if (this.inCall) {
        this.inCall = false;
        this.lastCallEndedAt = now;
      }
      if (this.breakdown.callCount > 0 && this.lastCallEndedAt !== null && !this.gapPausedForBreak) {
        this.breakdown.longestNoCallGapSeconds = Math.max(
          this.breakdown.longestNoCallGapSeconds,
          Math.round((now - this.lastCallEndedAt) / 1000),
        );
        this.gapPausedForBreak = true;
      }
      this.lastState = null;
      return;
    }

    const todayKey = getShiftDayKey();
    if (todayKey !== this.dateKey) {
      await this.flushSnapshot();
      this.resetAccumulatorsForNewDay(todayKey);
    }

    if (this.gapPausedForBreak) {
      if (this.lastCallEndedAt !== null) this.lastCallEndedAt = now;
      this.gapPausedForBreak = false;
      this.noCallAlerted = false;
    }

    const idleSecondsNow = powerMonitor.getSystemIdleTime();
    // Who holds the mic: the Windows audio engine (live, via the level probe)
    // plus the privacy registry as a backup - Windows doesn't always update
    // the registry for every program.
    const [win, registryMicUsers] = await Promise.all([this.getActiveWinResult(), readMicrophoneUsers()]);
    const micProcesses = [...new Set([...(this.audioProbe.getMicUsers(now) || []), ...registryMicUsers])];
    const appLabel = classifyActiveApp(win);
    const foregroundDialer: DialerLabel | null = appLabel === 'Other' ? null : appLabel;
    if (foregroundDialer === '3CX') this.lastThreeCxFocusAt = now;

    const foregroundKey = `${win?.owner?.name || ''}|${win?.title || ''}`;
    if (foregroundKey !== this.foregroundKey) {
      if (this.foregroundKey) this.foregroundChangeTimes.push(now);
      this.foregroundKey = foregroundKey;
    }
    this.foregroundChangeTimes = this.foregroundChangeTimes.filter((t) => now - t < 11 * 60 * 1000);

    const unproductive =
      !foregroundDialer && isUnproductiveWindow(win?.title || '', win?.owner?.name || '', this.unproductiveKeywords);
    const pattern = analyzeInputPattern(
      this.inputSampler.samples,
      this.screenSampler.samples,
      this.foregroundChangeTimes,
      now,
    );
    const secondsSinceVoice = this.audioProbe.secondsSinceVoice(micProcesses, now);
    const result = classifyTick({
      idleSeconds: idleSecondsNow,
      foreground: { dialer: foregroundDialer, unproductive },
      micProcesses,
      threeCxContext: now - this.lastThreeCxFocusAt <= DIALER_CONTEXT_SECONDS * 1000,
      secondsSinceVoice,
      pattern,
      // A call still marked open that isn't on the mic any more ended just now.
      secondsSinceCallEnded: this.inCall ? 0 : this.lastCallEndedAt !== null ? (now - this.lastCallEndedAt) / 1000 : null,
      lastCallDialer: this.lastCallDialer,
    });

    // Spreadsheet time: Excel / Sheets in front AND the mouse or keyboard used recently.
    const spreadsheet =
      isSpreadsheetWindow(win?.title || '', win?.owner?.name || '') && idleSecondsNow <= SPREADSHEET_INPUT_SECONDS;
    this.applyTick(result.state, result.dialer, result.reason || null, now, idleSecondsNow, spreadsheet);

    this.lastDiagnostics = {
      at: new Date(now).toISOString(),
      state: result.state,
      dialer: result.dialer,
      reason: result.reason || null,
      idleSeconds: idleSecondsNow,
      foreground: win?.title || win?.owner?.name || null,
      micProcesses,
      secondsSinceVoice: secondsSinceVoice === null ? null : Math.round(secondsSinceVoice),
      voiceProbe: this.audioProbe.isRunning(),
      inCall: this.inCall,
      breakdown: { ...this.breakdown },
    };
    this.writeDiagnosticsLine(this.lastDiagnostics);
  }

  private applyTick(
    state: ActivityState,
    dialer: DialerLabel | null,
    reason: string | null,
    now: number,
    idleSecondsNow: number,
    spreadsheet = false,
  ): void {
    const secs = POLL_INTERVAL_MS / 1000;
    const b = this.breakdown;

    if (state === 'ON_CALL') b.callSeconds += secs;
    else if (state === 'DIALING') b.dialingSeconds += secs;
    else if (state === 'OTHER_WORK') b.otherWorkSeconds += secs;
    else if (state === 'UNPRODUCTIVE') b.unproductiveSeconds += secs;
    else if (state === 'SUSPICIOUS') b.suspiciousSeconds += secs;

    // Active = on call / dialing / other work; idle = idle + suspicious.
    // Unproductive is its own bucket - neither active nor idle.
    if (ACTIVE_STATES.includes(state)) {
      this.activeSeconds += secs;
      if (spreadsheet) b.spreadsheetSeconds += secs; // a part of active time, never added on top
      const label = dialer || 'Other';
      this.appFocusSeconds[label] = (this.appFocusSeconds[label] || 0) + secs;
    } else if (IDLE_STATES.includes(state)) {
      this.idleSeconds += secs;
    }

    // Calls: count each mic-on period (short drops merge into the same call).
    if (state === 'ON_CALL') {
      if (dialer === '3CX') this.lastThreeCxFocusAt = now; // a long call keeps its 3CX context
      if (!this.inCall) {
        const gap = this.lastCallEndedAt !== null ? (now - this.lastCallEndedAt) / 1000 : null;
        if (gap === null || gap > CALL_MERGE_GAP_SECONDS) {
          b.callCount += 1;
          if (gap !== null) b.longestNoCallGapSeconds = Math.max(b.longestNoCallGapSeconds, Math.round(gap));
        }
        this.inCall = true;
        this.noCallAlerted = false;
      }
      this.lastCallDialer = dialer;
    } else if (this.inCall) {
      this.inCall = false;
      this.lastCallEndedAt = now;
    }

    // "No call for 15 minutes" - only for someone who has made calls today.
    if (!this.inCall && b.callCount > 0 && this.lastCallEndedAt !== null && !this.noCallAlerted) {
      const gapSeconds = (now - this.lastCallEndedAt) / 1000;
      if (gapSeconds >= NO_CALL_ALERT_SECONDS) {
        this.noCallAlerted = true;
        const minutes = Math.round(gapSeconds / 60);
        this.sendActivityAlert(
          { kind: 'no_call', since: new Date(this.lastCallEndedAt).toISOString(), minutes },
          `No call for ${minutes} minutes. Your manager has been notified.`,
        );
      }
    }

    // Suspicious activity (jiggler / auto-input): alert once per episode.
    if (state === 'SUSPICIOUS') {
      if (this.suspiciousSince === null) {
        this.suspiciousSince = now;
        this.sendActivityAlert(
          { kind: 'suspicious', since: new Date(now).toISOString(), reason },
          'Unusual activity detected - it has been recorded and your manager notified.',
        );
      }
    } else if (state !== 'IDLE') {
      this.suspiciousSince = null;
    }

    // Idle alert episode (real idle only; suspicious has its own alert).
    if (state === 'IDLE' && this.idleEpisodeStart === null) {
      this.startIdleEpisode(now - idleSecondsNow * 1000);
    } else if (state !== 'IDLE' && state !== 'SUSPICIOUS' && this.idleEpisodeStart !== null) {
      // Input resumed idleSecondsNow ago; a headset call with no input ends it now.
      this.endIdleEpisode('active', idleSecondsNow >= IDLE_THRESHOLD_SECONDS ? now : now - idleSecondsNow * 1000);
    }

    this.lastState = state;
    this.lastIsIdle = IDLE_STATES.includes(state);
    this.lastActiveApp = this.lastIsIdle ? null : dialer || 'Other';
  }

  /** Breakdown with the still-running "no call" gap included. */
  private breakdownForSnapshot(): ActivityBreakdown {
    const b = { ...this.breakdown };
    if (!this.inCall && b.callCount > 0 && this.lastCallEndedAt !== null && !this.gapPausedForBreak) {
      b.longestNoCallGapSeconds = Math.max(b.longestNoCallGapSeconds, Math.round((Date.now() - this.lastCallEndedAt) / 1000));
    }
    (Object.keys(b) as (keyof ActivityBreakdown)[]).forEach((k) => {
      b[k] = Math.round(b[k]);
    });
    return b;
  }

  /**
   * One line per poll in userData/activity-diagnostics.log (kept under
   * ~1 MB) - the field test reads this to see exactly why each 10 seconds
   * was classified the way it was.
   */
  private writeDiagnosticsLine(entry: Record<string, unknown>): void {
    try {
      const file = path.join(app.getPath('userData'), 'activity-diagnostics.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
        const tail = fs.readFileSync(file, 'utf-8').split('\n').slice(-2000).join('\n');
        fs.writeFileSync(file, tail, 'utf-8');
      }
      fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
    } catch {
      // diagnostics are best-effort
    }
  }

  public getDiagnostics(): Record<string, unknown> {
    return { ...this.lastDiagnostics };
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
      activityBreakdown: this.breakdownForSnapshot(),
      lastState: this.lastState,
      // Start of the current idle period - the Team Lead "agent idle" alert reads it.
      idleSince: this.idleEpisodeStart !== null ? new Date(this.idleEpisodeStart).toISOString() : null,
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/tracking/idle-snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
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

  // Manager's unproductive apps/sites list (Settings) - sent by the renderer at login.
  ipcMain.handle('set-activity-config', (_event, config: { unproductiveKeywords?: string[] | null }) => {
    idleTimeTracker.setUnproductiveKeywords(config?.unproductiveKeywords ?? null);
    return { success: true };
  });

  ipcMain.handle('get-activity-diagnostics', () => idleTimeTracker.getDiagnostics());

  console.log('[IdleTimeTracker] IPC handlers registered.');
}
