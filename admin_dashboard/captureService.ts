import { app, desktopCapturer, powerMonitor, ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLocalSettings } from './localSettings';
import { BACKEND_URL, PRODUCTIVITY_SERVICE_URL } from './serverConfig';

export interface ScreenshotRecord {
  id: string;
  userId: string;
  userName: string;
  userRole?: string;
  timestamp: string; // Readable timestamp e.g. 10:45 AM
  isoTimestamp: string; // ISO String
  date: string; // YYYY-MM-DD
  imageUrl: string; // Base64 data URL or HTTP URL
  isIdle: boolean;
  activeWindowName?: string;
  screenshotNumber?: number;
  totalTodayCount?: number;
  syncStatus?: 'ONLINE' | 'QUEUED_OFFLINE';
}

// In-memory store (gallery/team feed) - unrelated to the disk-persisted
// offline queue below.
let screenshotRecordsStore: ScreenshotRecord[] = [];
let automatedCaptureTimer: NodeJS.Timeout | null = null;
let liveVisionCaptureTimer: NodeJS.Timeout | null = null;
let offlineQueueRetryTimer: NodeJS.Timeout | null = null;

// Failed-upload queue, persisted to disk (not just an in-memory array like
// before) so a screenshot captured while the admin PC is unreachable isn't
// silently lost if the employee's app restarts before connectivity comes
// back - the whole point of "queue and retry until reachable" is defeated
// if a crash/restart between the capture and the retry drops it anyway.
const OFFLINE_QUEUE_RETRY_MS = 60 * 1000;

function getOfflineQueueFilePath(): string {
  return path.join(app.getPath('userData'), 'worktrackpro-screenshot-offline-queue.json');
}

function loadOfflineQueue(): ScreenshotRecord[] {
  try {
    return JSON.parse(fs.readFileSync(getOfflineQueueFilePath(), 'utf-8'));
  } catch {
    return [];
  }
}

function saveOfflineQueue(queue: ScreenshotRecord[]): void {
  try {
    fs.mkdirSync(path.dirname(getOfflineQueueFilePath()), { recursive: true });
    fs.writeFileSync(getOfflineQueueFilePath(), JSON.stringify(queue), 'utf-8');
  } catch (err) {
    console.warn('[CaptureService] Failed to persist offline screenshot queue to disk:', err);
  }
}

/**
 * Whoever is actually logged in on this device right now - set via the
 * 'set-monitor-employee-context' IPC handler right after a real login,
 * using the real MongoDB User id (previously nothing ever called this;
 * both capture loops below were hardcoded to a fake 'emp-101' user that
 * doesn't exist, so every automated screenshot/analysis was silently
 * attributed to nobody real regardless of who was actually signed in).
 * null before login / after logout - both capture loops skip entirely
 * rather than falling back to a fake placeholder.
 */
let currentEmployeeContext: { id: string; name: string; role: string } | null = null;

/**
 * Same break-status check idleTimeTracker.ts already uses to freeze its
 * whole-day active/idle accumulators - screenshot capture (both loops
 * below) previously ran straight through breaks (scheduled or manual)
 * with no check at all, capturing/analyzing desktop activity during time
 * the employee is explicitly not supposed to be monitored. Fails open on
 * a transient productivity_service blip, matching every other
 * degrade-gracefully check in this file/idleTimeTracker.ts.
 */
async function isEmployeeOnBreak(employeeId: string): Promise<boolean> {
  try {
    const response = await fetch(`${PRODUCTIVITY_SERVICE_URL}/api/shift/break-status/${employeeId}`);
    if (!response.ok) return false;
    const data = await response.json();
    return !!data.onBreak;
  } catch (err) {
    console.warn('[CaptureService] Failed to check break status, assuming not on break:', err);
    return false;
  }
}

/**
 * 1. AUTOMATIC TIMED TRIGGER & 2. SILENT DESKTOP CAPTURE
 */
export async function captureDesktopScreen(
  userId?: string,
  userName?: string,
  userRole?: string
): Promise<ScreenshotRecord | null> {
  // Manual-trigger callers already pass real values explicitly; the
  // automated loop passes nothing and relies on whoever actually logged
  // in via currentEmployeeContext. No employee known yet (not logged in,
  // or the app just started) -> skip rather than falling back to a fake
  // placeholder user that doesn't exist in the database.
  const resolvedUserId = userId || currentEmployeeContext?.id;
  const resolvedUserName = userName || currentEmployeeContext?.name;
  const resolvedUserRole = userRole || currentEmployeeContext?.role || 'Employee';
  if (!resolvedUserId || !resolvedUserName) {
    return null;
  }
  userId = resolvedUserId;
  userName = resolvedUserName;
  userRole = resolvedUserRole;
  try {
    // STEP 1: Check System Activity using Electron powerMonitor
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const isIdle = idleSeconds > 60;

    if (isIdle) {
      console.log(`[CaptureService] Employee ${userName} is IDLE (${idleSeconds}s > 60s). Skipping silent capture & logging idle event.`);
      
      // Log Idle Event to Renderer Windows
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('idle-event-logged', { userId, userName, idleSeconds, timestamp: new Date().toISOString() });
        }
      });

      return null;
    }

    // STEP 2: SILENT DESKTOP CAPTURE via Electron desktopCapturer (No Prompts/Alerts)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources || sources.length === 0) {
      console.warn('[CaptureService] No primary screen sources detected.');
      return null;
    }

    const primarySource = sources[0];
    const imageUrl = primarySource.thumbnail.toDataURL(); // Base64 PNG buffer
    const now = new Date();
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedDate = now.toISOString().split('T')[0];

    const todayUserCount = screenshotRecordsStore.filter(s => s.userId === userId && s.date === formattedDate).length + 1;

    const newRecord: ScreenshotRecord = {
      id: `shot-${Date.now()}`,
      userId,
      userName,
      userRole,
      timestamp: formattedTime,
      isoTimestamp: now.toISOString(),
      date: formattedDate,
      imageUrl,
      isIdle: false,
      activeWindowName: primarySource.name || 'Active Desktop Application (This PC)',
      screenshotNumber: todayUserCount,
      totalTodayCount: todayUserCount,
      syncStatus: 'ONLINE',
    };

    // STEP 3: TRANSMISSION & STORAGE LOGIC (Online POST to MongoDB vs Offline SQLite/Local Sync)
    await transmitAndStoreScreenshot(newRecord);

    // Broadcast to Manager Dashboard View (IPC / WebSocket)
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('screenshot-captured-event', newRecord);
      }
    });

    return newRecord;
  } catch (error) {
    console.error('[CaptureService] Failed silent desktop capture:', error);
    return null;
  }
}

function buildUploadUrl(): string | null {
  const settings = getLocalSettings();
  if (!settings.adminPcIp) return null; // not configured yet - see ManagerSettingsView's "Admin PC IP" field
  return `http://${settings.adminPcIp}:${settings.adminPcPort || 5000}/upload`;
}

async function postScreenshotToAdminPc(record: ScreenshotRecord): Promise<boolean> {
  const url = buildUploadUrl();
  if (!url) {
    // No "Admin PC IP" configured yet - treat exactly like unreachable
    // (throw, so the caller queues it for retry) rather than returning
    // false, which the caller's try/catch would otherwise silently read
    // as success and mark syncStatus 'ONLINE' without ever having sent
    // anything anywhere.
    throw new Error('Admin PC IP is not configured (see Settings)');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employeeId: record.userId,
      employeeName: record.userName,
      employeeRole: record.userRole,
      image: record.imageUrl,
      activeWindowName: record.activeWindowName,
      timestamp: record.isoTimestamp,
      date: record.date,
      isIdle: record.isIdle,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return true;
}

/**
 * STEP 3: TRANSMISSION & STORAGE LOGIC - POSTs directly to the admin PC's
 * local screenshot server over the LAN (see localScreenshotServer.ts on
 * the receiving end), replacing the old MongoDB Atlas upload. Failed
 * uploads (admin PC offline/unreachable, or "Admin PC IP" not configured
 * yet) are queued to disk and retried periodically by
 * retryOfflineQueuePeriodically() below, not just opportunistically on the
 * next successful capture like before - a screenshot captured on a day the
 * admin PC never comes back online must not just sit forever waiting for
 * a capture that also happens to succeed.
 */
async function transmitAndStoreScreenshot(record: ScreenshotRecord): Promise<void> {
  try {
    await postScreenshotToAdminPc(record);
    record.syncStatus = 'ONLINE';
    console.log(`[CaptureService] Transmission SUCCESS: sent to admin PC.`);
    void flushOfflineQueue(); // fast path - the network is evidently up again
  } catch (err) {
    console.warn('[CaptureService] Admin PC offline / unreachable / not configured. Queuing screenshot for retry...', err);
    record.syncStatus = 'QUEUED_OFFLINE';
    const queue = loadOfflineQueue();
    queue.push(record);
    saveOfflineQueue(queue);
  }

  // Prepend to memory store (drives the manager's live gallery feed via
  // get-team-screenshots - unrelated to the disk queue above).
  screenshotRecordsStore = [record, ...screenshotRecordsStore];
}

/**
 * Retries every disk-queued screenshot against the admin PC. Called
 * opportunistically right after any capture succeeds (fast path - the
 * network is evidently up again) AND on a fixed timer (see
 * retryOfflineQueuePeriodically) so a queue doesn't just sit untouched on
 * days with few/no successful captures to piggyback a retry on.
 */
async function flushOfflineQueue(): Promise<void> {
  const queue = loadOfflineQueue();
  if (queue.length === 0) return;

  console.log(`[CaptureService] Flushing ${queue.length} offline-queued screenshot(s) to the admin PC...`);
  const stillQueued: ScreenshotRecord[] = [];

  for (const record of queue) {
    try {
      await postScreenshotToAdminPc(record);
      record.syncStatus = 'ONLINE';
    } catch {
      stillQueued.push(record);
    }
  }

  saveOfflineQueue(stillQueued);
  if (stillQueued.length < queue.length) {
    console.log(`[CaptureService] Flushed ${queue.length - stillQueued.length} screenshot(s); ${stillQueued.length} still queued.`);
  }
}

function retryOfflineQueuePeriodically(): void {
  if (offlineQueueRetryTimer) clearInterval(offlineQueueRetryTimer);
  offlineQueueRetryTimer = setInterval(() => void flushOfflineQueue(), OFFLINE_QUEUE_RETRY_MS);
}

/**
 * STEP 1: AUTOMATIC TIMED TRIGGER (Every 5 Minutes)
 */
export function startAutomated5MinScreenCaptureLoop(intervalMinutes: number = 5): void {
  if (automatedCaptureTimer) {
    clearInterval(automatedCaptureTimer);
  }

  const ms = intervalMinutes * 60 * 1000;
  console.log(`[CaptureService] Starting 5-minute silent automated desktop screen capture loop (${ms}ms)...`);

  automatedCaptureTimer = setInterval(async () => {
    if (!currentEmployeeContext) return; // nobody logged in yet - nothing to attribute a capture to
    if (await isEmployeeOnBreak(currentEmployeeContext.id)) {
      console.log('[CaptureService] On break, skipping automated capture tick.');
      return;
    }
    console.log(`[CaptureService] 5-minute automated capture loop executing for ${currentEmployeeContext.name}...`);
    await captureDesktopScreen();
  }, ms);
}

/**
 * LIVE MONITOR VISION ANALYSIS - separate, faster capture loop feeding the
 * Manager Portal's Live Monitor page. Deliberately does NOT go through
 * transmitAndStoreScreenshot()/the Screenshot gallery table - persisting a
 * full screenshot every 25s (vs. the archival loop's 5 minutes) would
 * bloat that table ~12x for a page that only needs the latest live result,
 * not a permanent history. Posts straight to /monitor/analyze with
 * persist:false; the backend still broadcasts the result over WebSocket
 * for the Live Monitor page to pick up.
 */
const LIVE_VISION_INTERVAL_MS = 25000;

async function captureAndAnalyzeForLiveMonitor(): Promise<void> {
  if (!currentEmployeeContext) return;
  if (await isEmployeeOnBreak(currentEmployeeContext.id)) return;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (!sources || sources.length === 0) return;

    const imageBase64 = sources[0].thumbnail.toDataURL();
    const response = await fetch(`${BACKEND_URL}/api/v1/monitor/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: currentEmployeeContext.id,
        imageBase64,
        timestamp: new Date().toISOString(),
        persist: false,
      }),
    });
    if (!response.ok) {
      console.warn(`[CaptureService] Live vision analysis request failed: HTTP ${response.status}`);
    }
  } catch (err) {
    console.warn('[CaptureService] Live vision analysis capture failed:', err);
  }
}

function startLiveVisionMonitoring(): void {
  if (liveVisionCaptureTimer) clearInterval(liveVisionCaptureTimer);
  liveVisionCaptureTimer = setInterval(() => void captureAndAnalyzeForLiveMonitor(), LIVE_VISION_INTERVAL_MS);
  void captureAndAnalyzeForLiveMonitor(); // don't wait 25s for the first result
}

function stopLiveVisionMonitoring(): void {
  if (liveVisionCaptureTimer) {
    clearInterval(liveVisionCaptureTimer);
    liveVisionCaptureTimer = null;
  }
}

/**
 * STEP 4: REGISTER IPC HANDLERS FOR MANAGER DASHBOARD MANUAL OVERRIDE
 */
export function registerCaptureIpcHandlers(): void {
  // Called right after a real login (see dashboard.tsx) with the actual
  // MongoDB user id/name/role - both capture loops above were previously
  // hardcoded to a fake 'emp-101' user that doesn't exist in the database,
  // so every automated screenshot/analysis was silently attributed to
  // nobody real regardless of who was actually signed in.
  ipcMain.handle('set-monitor-employee-context', async (_event, employeeId: string, employeeName: string, employeeRole?: string) => {
    if (!employeeId || !employeeName) return { success: false };
    currentEmployeeContext = { id: employeeId, name: employeeName, role: employeeRole || 'Employee' };
    startLiveVisionMonitoring();
    return { success: true };
  });

  ipcMain.handle('clear-monitor-employee-context', async () => {
    currentEmployeeContext = null;
    stopLiveVisionMonitoring();
    return { success: true };
  });

  // Manual Override: Manager clicks "Capture Live Screen Now" -> Immediate silent capture within seconds
  ipcMain.handle('trigger-manual-capture', async (_event, targetUserId?: string, targetUserName?: string, targetUserRole?: string) => {
    console.log(`[CaptureService] Manager Manual Override triggered for ${targetUserName || currentEmployeeContext?.name || 'unknown'}`);
    const record = await captureDesktopScreen(targetUserId, targetUserName, targetUserRole);
    return { success: !!record, record, allRecords: screenshotRecordsStore };
  });

  // Fetch Team Screenshots Feed
  ipcMain.handle('get-team-screenshots', async (_event, filterUserId?: string, filterDate?: string) => {
    let results = [...screenshotRecordsStore];
    if (filterUserId && filterUserId !== 'ALL') {
      results = results.filter(r => r.userId === filterUserId);
    }
    if (filterDate) {
      results = results.filter(r => r.date === filterDate);
    }
    return results;
  });

  // Start 5-minute automated background loop (a no-op each tick until a
  // real employee context is set via set-monitor-employee-context)
  startAutomated5MinScreenCaptureLoop(5);

  // Retry any screenshots queued while the admin PC was unreachable, both
  // right now (in case some were already queued from a previous run) and
  // on a recurring timer from then on.
  void flushOfflineQueue();
  retryOfflineQueuePeriodically();
}

