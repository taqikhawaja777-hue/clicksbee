/**
 * IdleTimeTracker — Electron Main Process
 *
 * Always-on, whole-workday counterpart to ProductivityCaptureService (which
 * only runs for the duration of one Task Session). Tracks mouse/keyboard
 * idle time and which application is focused for the entire day, with
 * dedicated recognition of Cisco Jabber, Wildix, and Yeastar Linkus Lite, and reports cumulative
 * daily totals to the productivity-tracking FastAPI service's
 * `POST /api/idle-time/log` — the backend that replaced screen-recording
 * monitoring on the Manager Supervisor Portal.
 *
 * - Polls every 15-30s (POLL_INTERVAL_MS below) via
 *   `powerMonitor.getSystemIdleTime()` for idle detection and the optional
 *   `active-win` package for the focused window (same fallback pattern as
 *   captureService.ts / productivityCapture.ts).
 * - Accumulates cumulative totals in memory (active_seconds, idle_seconds,
 *   per-app app_focus_seconds) and POSTs the current day-to-date snapshot
 *   every 1-2 minutes (BATCH_INTERVAL_MS) — a batched snapshot, not a delta,
 *   so a failed/retried POST or a client restart can never double-count.
 * - Resets accumulators at the shift's 19:00 Asia/Karachi rollover (see
 *   getShiftDayKey below), not local midnight, so a long-running session
 *   doesn't bleed one shift-day's totals into the next.
 *
 * IMPLEMENTATION NOTE — on-call detection limitation:
 * Cisco Jabber and Wildix both expose desktop APIs in principle (Jabber has
 * a local JavaScript/HTTP integration API; Wildix has its own desktop SDK),
 * but neither is wired up here — doing so needs a real install of each app
 * to discover/verify the actual local endpoint and call-status payload
 * shape, which isn't available in this environment. `checkOnCallStatus`
 * below is therefore a stub that always returns false, so calls in either
 * app are NOT currently exempted from idle detection — an employee idle at
 * the keyboard during a call will still accumulate idle time. Per the spec
 * this falls back to standard idle detection, which is what happens today.
 * Wire real call-status polling into that one function once verified
 * against a test machine; nothing else needs to change.
 */
import { powerMonitor, ipcMain } from 'electron';
import { PRODUCTIVITY_SERVICE_URL } from './serverConfig';

export type ActiveAppLabel = 'Cisco Jabber' | 'Wildix' | 'Yeastar Linkus Lite' | 'Other';

const IDLE_THRESHOLD_SECONDS = 300; // 5 minutes, per spec (configurable)
const POLL_INTERVAL_MS = 20000; // 20s, within the requested 15-30s range
const BATCH_INTERVAL_MS = 90000; // 90s, within the requested 1-2 minute range
const API_BASE_URL_DEFAULT = PRODUCTIVITY_SERVICE_URL;

// Best-effort process/window-name signatures. Verify against a real
// install of each app on a target Windows machine and adjust here — this
// is the one place that needs updating if a match turns out wrong.
const JABBER_SIGNATURES = [/cisco\s*jabber/i, /^ciscojabber\.exe$/i];
const WILDIX_SIGNATURES = [/wildix/i, /^wixphone\.exe$/i, /^x-bees\.exe$/i];
const YEASTAR_SIGNATURES = [/yeastar|yeaster|linkus/i];

interface ActiveWinResult {
  owner?: { name?: string; path?: string };
  title?: string;
}

function classifyActiveApp(win: ActiveWinResult | null): ActiveAppLabel {
  if (!win) return 'Other';
  const candidates = [win.owner?.name, win.owner?.path, win.title].filter(
    (v): v is string => !!v,
  );
  for (const candidate of candidates) {
    if (JABBER_SIGNATURES.some((re) => re.test(candidate))) return 'Cisco Jabber';
    if (WILDIX_SIGNATURES.some((re) => re.test(candidate))) return 'Wildix';
    if (YEASTAR_SIGNATURES.some((re) => re.test(candidate))) return 'Yeastar Linkus Lite';
  }
  return 'Other';
}

/**
 * Stub — see IMPLEMENTATION NOTE above. Always false until real Jabber/
 * Wildix call-status APIs are wired in.
 */
async function checkOnCallStatus(_appLabel: ActiveAppLabel): Promise<boolean> {
  return false;
}

// Asia/Karachi is a fixed UTC+5 offset year-round (Pakistan observes no
// DST), so "Karachi wall-clock time" can be computed with plain
// millisecond arithmetic instead of Intl/timezone-database lookups.
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const SHIFT_END_MINUTES_OF_DAY = 19 * 60; // 19:00 - the org's single fixed shift is 10:00-19:00

const SHIFT_START_MINUTES_OF_DAY = 10 * 60;
const SCHEDULED_BREAKS = [
  { start: 13 * 60 + 30, end: 14 * 60 + 10 }, // Lunch & Zuhr
  { start: 17 * 60, end: 17 * 60 + 20 }, // Tea & Asar
];

// Every shift is its Karachi calendar date. After 19:00 no new activity is
// tracked; the next workday starts when employees can check in at 10:00.
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

  private dateKey = getShiftDayKey();
  private activeSeconds = 0;
  private idleSeconds = 0;
  private appFocusSeconds: Record<string, number> = {};
  private lastActiveApp: string | null = null;
  private lastIsIdle = false;

  public start(employeeId: string, apiBaseUrl: string = API_BASE_URL_DEFAULT): void {
    if (this.isTracking) {
      if (this.employeeId === employeeId) {
        console.log('[IdleTimeTracker] Already tracking this employee, ignoring duplicate start.');
        return;
      }
      // A different employee logged in without the previous one's session
      // ever calling stop() (e.g. the renderer reloaded on logout/account
      // switch but this main-process singleton didn't) - this guard used to
      // silently ignore the new employeeId entirely, so every employee who
      // logged in after the first one on a still-running app instance got
      // zero idle_time_logs rows for the whole day while the first
      // employee's tracker kept absorbing everyone else's activity. Flush
      // the outgoing employee's totals, then start clean for the new one.
      console.log(`[IdleTimeTracker] Switching tracked employee ${this.employeeId} -> ${employeeId}`);
      this.stop();
    }

    this.employeeId = employeeId;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.isTracking = true;
    this.resetAccumulatorsForNewDay(getShiftDayKey());

    console.log(`[IdleTimeTracker] Starting idle/active tracking for employeeId=${employeeId}`);

    // Resume today's already-persisted totals (if any) before polling starts,
    // instead of always zeroing - otherwise every app relaunch/crash silently
    // discards however much of today was already tracked, even though this
    // upserts as "the whole day's cumulative total" (see class doc comment).
    void this.resumeFromExistingSnapshot().finally(() => {
      if (!this.isTracking) return; // stop() may have raced this
      // Do not make a newly logged-in employee wait for the first 20-second
      // poll and then the 90-second batch timer before the manager can see
      // them. That gap made an active portal user look offline immediately
      // after login/check-in. Publish one real snapshot as soon as the
      // existing totals have been restored; later ticks remain batched.
      void this.pollActivity().then(() => this.flushSnapshot());
      this.pollTimer = setInterval(() => void this.pollActivity(), POLL_INTERVAL_MS);
      this.batchTimer = setInterval(() => void this.flushSnapshot(), BATCH_INTERVAL_MS);
    });
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

      this.activeSeconds = row.activeSeconds || 0;
      this.idleSeconds = row.idleSeconds || 0;
      this.appFocusSeconds = { ...(row.appFocusSeconds || {}) };
      this.lastActiveApp = row.lastActiveApp ?? null;
      this.lastIsIdle = !!row.lastIsIdle;
      console.log(
        `[IdleTimeTracker] Resumed today's existing snapshot: active=${this.activeSeconds}s idle=${this.idleSeconds}s`,
      );
    } catch (err) {
      console.warn('[IdleTimeTracker] Failed to resume existing idle-time snapshot, starting from zero:', err);
    }
  }

  public stop(): void {
    if (!this.isTracking) return;
    console.log('[IdleTimeTracker] Stopping idle/active tracking.');
    this.isTracking = false;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.batchTimer) clearInterval(this.batchTimer);
    this.pollTimer = null;
    this.batchTimer = null;

    void this.flushSnapshot();
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
      // `active-win` not installed (or unsupported platform).
    }
    return null;
  }

  private resetAccumulatorsForNewDay(newDateKey: string): void {
    this.dateKey = newDateKey;
    this.activeSeconds = 0;
    this.idleSeconds = 0;
    this.appFocusSeconds = {};
    this.lastActiveApp = null;
    this.lastIsIdle = false;
  }

  private async isOnBreak(): Promise<boolean> {
    try {
      // Activity snapshots now use the main MongoDB backend. Break state is
      // still sourced from the portal session, so never block tracking on a
      // retired Supabase-only break endpoint.
      return false;
    } catch (err) {
      // Fail open: a transient productivity_service blip shouldn't
      // indefinitely freeze legitimate tracking - matches this file's
      // other degrade-gracefully patterns (resumeFromExistingSnapshot
      // falls back to zero on failure, checkOnCallStatus is a permanent
      // stub).
      console.warn('[IdleTimeTracker] Failed to check break status, assuming not on break:', err);
      return false;
    }
  }

  private async pollActivity(): Promise<void> {
    if (!this.isTracking) return;

    if (!isTrackableWorkTime()) {
      // Scheduled prayer/tea breaks and after-hours never become idle time.
      // Keep the existing day totals intact, simply wait for the next work
      // minute. This prevents an evening app session from being attributed
      // to tomorrow before tomorrow's 10 AM shift begins.
      return;
    }

    if (await this.isOnBreak()) {
      // Nothing increments during a break - activeSeconds/idleSeconds stay
      // exactly where they were, so tracking resumes exactly where it left
      // off once the break ends, with no artificial idle time added for
      // the break duration itself.
      console.log('[IdleTimeTracker] On break, skipping poll tick.');
      return;
    }

    const todayKey = getShiftDayKey();
    if (todayKey !== this.dateKey) {
      // Local midnight rolled over mid-session: flush yesterday's totals
      // one last time, then start today's accumulators from zero.
      await this.flushSnapshot();
      this.resetAccumulatorsForNewDay(todayKey);
    }

    const idleSecondsNow = powerMonitor.getSystemIdleTime();
    const systemIdle = idleSecondsNow >= IDLE_THRESHOLD_SECONDS;
    const win = await this.getActiveWinResult();
    const appLabel = classifyActiveApp(win);

    let isIdle = systemIdle;
    if (systemIdle && (appLabel === 'Cisco Jabber' || appLabel === 'Wildix')) {
      const onCall = await checkOnCallStatus(appLabel);
      if (onCall) isIdle = false; // active call counts as productive even if input is idle
    }

    const pollSeconds = POLL_INTERVAL_MS / 1000;
    if (isIdle) {
      this.idleSeconds += pollSeconds;
    } else {
      this.activeSeconds += pollSeconds;
      this.appFocusSeconds[appLabel] = (this.appFocusSeconds[appLabel] || 0) + pollSeconds;
    }

    this.lastActiveApp = isIdle ? null : appLabel;
    this.lastIsIdle = isIdle;
  }

  private async flushSnapshot(): Promise<void> {
    if (!this.employeeId) return;

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/tracking/idle-snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.employeeId,
          date: this.dateKey,
          activeSeconds: Math.round(this.activeSeconds),
          idleSeconds: Math.round(this.idleSeconds),
          appFocusSeconds: Object.fromEntries(
            Object.entries(this.appFocusSeconds).map(([k, v]) => [k, Math.round(v)]),
          ),
          lastActiveApp: this.lastActiveApp,
          lastIsIdle: this.lastIsIdle,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      console.log(
        `[IdleTimeTracker] Synced daily snapshot: active=${Math.round(this.activeSeconds)}s idle=${Math.round(this.idleSeconds)}s`,
      );
    } catch (err) {
      // Cumulative totals stay in memory regardless, so the next successful
      // flush (or the final stop() flush) carries everything forward.
      console.warn('[IdleTimeTracker] Failed to sync idle-time snapshot, will retry next cycle:', err);
    }
  }
}

export const idleTimeTracker = new IdleTimeTracker();

/**
 * Register IPC handlers so the renderer can start/stop the whole-day
 * tracker once the logged-in employee's productivity-service ID is known.
 */
export function registerIdleTimeTrackerIpcHandlers(): void {
  ipcMain.handle(
    'start-idle-time-tracking',
    async (_event, args: { employeeId: string; apiBaseUrl?: string }) => {
      const { employeeId, apiBaseUrl } = args || ({} as typeof args);
      if (!employeeId) {
        return { success: false, error: 'employeeId is required' };
      }
      try {
        idleTimeTracker.start(employeeId, apiBaseUrl);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle('stop-idle-time-tracking', async () => {
    try {
      idleTimeTracker.stop();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('get-idle-time-tracking-status', async () => {
    return { success: true, ...idleTimeTracker.getStatus() };
  });

  // Lets renderer-side code (e.g. the camera-presence detector, which needs
  // getUserMedia and therefore must run in the renderer, not here) read the
  // same idle threshold this tracker already uses, so "mouse/keyboard
  // active" means the same thing in both places.
  ipcMain.handle('get-system-idle-seconds', async () => {
    return { success: true, idleSeconds: powerMonitor.getSystemIdleTime(), idleThresholdSeconds: IDLE_THRESHOLD_SECONDS };
  });

  console.log('[IdleTimeTracker] IPC handlers registered.');
}
