import { app, desktopCapturer, powerMonitor, ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLocalSettings } from './localSettings';
import { BACKEND_URL } from './serverConfig';
import { isBeforeShiftEnd, isScheduledBreakNow } from './idleTimeTracker';

const ARCHIVE_CAPTURE_INTERVAL_MS = 60 * 1000;
const ARCHIVE_JPEG_QUALITY = 0.75;

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

/** Scheduled breaks are fixed windows (see idleTimeTracker.ts); no network call needed. */
async function isEmployeeOnBreak(_employeeId: string): Promise<boolean> {
  return isScheduledBreakNow();
}

function karachiTimestampLabel(d: Date): string {
  const k = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())}`;
}

// Hidden window used only as a canvas to burn the name + date/time into the
// frame; the main process has no 2D drawing API of its own.
let stampWindow: BrowserWindow | null = null;

async function stampImage(pngDataUrl: string, label: string): Promise<string> {
  if (!stampWindow || stampWindow.isDestroyed()) {
    stampWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await stampWindow.loadURL('data:text/html,<canvas id="c"></canvas>');
  }
  return stampWindow.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(pngDataUrl)};
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const label = ${JSON.stringify(label)};
    ctx.font = 'bold 26px Arial, sans-serif';
    const padX = 18, h = 46, w = ctx.measureText(label).width + padX * 2;
    const x = c.width - w - 24, y = c.height - h - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, y + h / 2);
    return c.toDataURL('image/jpeg', ${ARCHIVE_JPEG_QUALITY});
  })()`);
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
    // Idle employees are still captured (the frame is the evidence); the
    // flag just travels with the record.
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const isIdle = idleSeconds >= 120;
    if (isIdle) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('idle-event-logged', { userId, userName, idleSeconds, timestamp: new Date().toISOString() });
        }
      });
    }

    // SILENT DESKTOP CAPTURE via Electron desktopCapturer (No Prompts/Alerts)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources || sources.length === 0) {
      console.warn('[CaptureService] No primary screen sources detected.');
      return null;
    }

    const primarySource = sources[0];
    const now = new Date();
    const label = `${userName}  •  ${karachiTimestampLabel(now)}`;
    let imageUrl = primarySource.thumbnail.toDataURL();
    try {
      imageUrl = await stampImage(imageUrl, label);
    } catch (err) {
      console.warn('[CaptureService] Could not stamp timestamp onto frame, sending unstamped PNG:', err);
    }
    const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
    const formattedDate = karachiTimestampLabel(now).slice(0, 10);

    const todayUserCount = screenshotRecordsStore.filter(s => s.userId === userId && s.date === formattedDate).length + 1;

    const newRecord: ScreenshotRecord = {
      id: `shot-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      userName,
      userRole,
      timestamp: formattedTime,
      isoTimestamp: now.toISOString(),
      date: formattedDate,
      imageUrl,
      isIdle,
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

/**
 * POSTs the frame over the LAN to the manager PC's WorkTrackPro app
 * (localScreenshotServer.ts), which saves it as
 * <storage folder>/<Employee Name>/<date>/<date_time>.jpg. The address comes
 * from the org-wide setting applied at login (dashboard.tsx), or a manual
 * "Admin PC IP" override in Settings.
 */
async function postScreenshotToAdminPc(record: ScreenshotRecord): Promise<boolean> {
  const settings = getLocalSettings();
  if (!settings.adminPcIp) {
    // Throw so the frame is queued for retry rather than silently dropped.
    throw new Error('Screenshot destination is not configured (Manager Settings -> Local Screenshot Server)');
  }
  const response = await fetch(`http://${settings.adminPcIp}:${settings.adminPcPort || 5000}/upload`, {
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
 * Failed uploads (manager PC off/unreachable, or destination not configured)
 * are queued to disk and retried by retryOfflineQueuePeriodically() - a
 * screenshot captured while offline must not be lost if the app restarts.
 */
async function transmitAndStoreScreenshot(record: ScreenshotRecord): Promise<void> {
  try {
    await postScreenshotToAdminPc(record);
    record.syncStatus = 'ONLINE';
    console.log(`[CaptureService] Archived screenshot for ${record.userName} at ${record.date} ${record.timestamp}.`);
    void flushOfflineQueue(); // fast path - the network is evidently up again
  } catch (err) {
    console.warn('[CaptureService] Manager PC unreachable or not configured. Queuing screenshot for retry...', err);
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

  console.log(`[CaptureService] Flushing ${queue.length} offline-queued screenshot(s) to the manager PC...`);
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
 * ARCHIVE LOOP: one screenshot a minute from employee login until the
 * 19:00 Asia/Karachi shift end, skipping scheduled breaks. A no-op tick
 * until a real employee context is set via set-monitor-employee-context.
 */
async function archiveCaptureTick(): Promise<void> {
  if (!currentEmployeeContext) return;
  if (!isBeforeShiftEnd()) return; // shift over - resumes automatically on the next login/day
  if (await isEmployeeOnBreak(currentEmployeeContext.id)) return;
  await captureDesktopScreen();
}

export function startAutomatedScreenCaptureLoop(intervalMs: number = ARCHIVE_CAPTURE_INTERVAL_MS): void {
  if (automatedCaptureTimer) {
    clearInterval(automatedCaptureTimer);
  }
  console.log(`[CaptureService] Starting ${Math.round(intervalMs / 1000)}s silent desktop screen capture loop...`);
  automatedCaptureTimer = setInterval(() => void archiveCaptureTick(), intervalMs);
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
// Capture screenshot and request LLM Vision analysis every 2 minutes (120,000 ms)
const LIVE_VISION_INTERVAL_MS = 2 * 60 * 1000;

async function captureAndAnalyzeForLiveMonitor(forceEmployeeId?: string): Promise<void> {
  const targetId = forceEmployeeId || currentEmployeeContext?.id;
  if (!targetId) return;
  if (await isEmployeeOnBreak(targetId)) return;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (!sources || sources.length === 0) return;

    const imageBase64 = sources[0].thumbnail.toDataURL();
    console.log(`[CaptureService] Requesting on-demand LLM Vision analysis for ${targetId}...`);
    const response = await fetch(`${BACKEND_URL}/api/v1/monitor/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: targetId,
        imageBase64,
        timestamp: new Date().toISOString(),
        persist: false,
      }),
    });
    if (!response.ok) {
      console.warn(`[CaptureService] Live vision analysis request failed: HTTP ${response.status}`);
    } else {
      console.log(`[CaptureService] Live vision analysis completed successfully for ${targetId}`);
    }
  } catch (err) {
    console.warn('[CaptureService] Live vision analysis capture failed:', err);
  }
}

export function startLiveVisionMonitoring(targetEmployeeId?: string): void {
  if (liveVisionCaptureTimer) {
    clearInterval(liveVisionCaptureTimer);
    liveVisionCaptureTimer = null;
  }
  const empId = targetEmployeeId || currentEmployeeContext?.id;
  console.log(`[CaptureService] Starting on-demand 2-minute live vision monitoring for ${empId}...`);
  // Immediate analysis at the exact moment manager selects the employee
  void captureAndAnalyzeForLiveMonitor(empId);
  // Schedule subsequent captures after every 2 minutes
  liveVisionCaptureTimer = setInterval(() => void captureAndAnalyzeForLiveMonitor(empId), LIVE_VISION_INTERVAL_MS);
}

export function stopLiveVisionMonitoring(): void {
  if (liveVisionCaptureTimer) {
    console.log('[CaptureService] Stopped live vision monitoring.');
    clearInterval(liveVisionCaptureTimer);
    liveVisionCaptureTimer = null;
  }
}

/**
 * STEP 4: REGISTER IPC HANDLERS FOR MANAGER DASHBOARD MANUAL OVERRIDE
 */
export function registerCaptureIpcHandlers(): void {
  // Called right after a real login (see dashboard.tsx) with the actual
  // MongoDB user id/name/role
  ipcMain.handle('set-monitor-employee-context', async (_event, employeeId: string, employeeName: string, employeeRole?: string) => {
    if (!employeeId || !employeeName) return { success: false };
    const isNewLogin = currentEmployeeContext?.id !== employeeId;
    currentEmployeeContext = { id: employeeId, name: employeeName, role: employeeRole || 'Employee' };
    // First archive frame right at login; the loop takes over every minute after.
    if (isNewLogin) void archiveCaptureTick();
    // NOTE: Do NOT automatically start live vision monitoring here.
    // Live vision monitoring is on-demand: it triggers ONLY when a manager selects
    // this specific employee on the Live Monitoring page.
    return { success: true };
  });

  // On-demand manager trigger: start 2-minute capture loop for specific employee
  ipcMain.handle('start-live-vision-monitoring', async (_event, targetEmployeeId?: string) => {
    startLiveVisionMonitoring(targetEmployeeId);
    return { success: true };
  });

  // Stop 2-minute capture loop when manager navigates away or switches employee
  ipcMain.handle('stop-live-vision-monitoring', async () => {
    stopLiveVisionMonitoring();
    return { success: true };
  });

  // Immediate single capture on-demand
  ipcMain.handle('trigger-live-vision-capture-now', async (_event, targetEmployeeId?: string) => {
    await captureAndAnalyzeForLiveMonitor(targetEmployeeId);
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

  startAutomatedScreenCaptureLoop();

  // Retry any screenshots queued while the backend was unreachable, both
  // right now (in case some were already queued from a previous run) and
  // on a recurring timer from then on.
  void flushOfflineQueue();
  retryOfflineQueuePeriodically();
}

