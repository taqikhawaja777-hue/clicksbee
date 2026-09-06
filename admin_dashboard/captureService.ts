import { desktopCapturer, powerMonitor, ipcMain, BrowserWindow } from 'electron';

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

// In-memory store & Offline SQLite / Local Sync Queue
let screenshotRecordsStore: ScreenshotRecord[] = [];
let offlineSyncQueue: ScreenshotRecord[] = [];
let automatedCaptureTimer: NodeJS.Timeout | null = null;

/**
 * 1. AUTOMATIC TIMED TRIGGER & 2. SILENT DESKTOP CAPTURE
 */
export async function captureDesktopScreen(
  userId: string = 'emp-101', 
  userName: string = 'umer Sohail', 
  userRole: string = 'Full Stack Engineer'
): Promise<ScreenshotRecord | null> {
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

/**
 * STEP 3: TRANSMISSION & STORAGE LOGIC
 */
async function transmitAndStoreScreenshot(record: ScreenshotRecord): Promise<void> {
  try {
    // Attempt online transmission to NestJS backend -> MongoDB Atlas collection Screenshot
    const response = await fetch('http://localhost:3000/api/v1/screenshots/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: record.userName,
        userId: record.userId,
        userRole: record.userRole,
        imageUrl: record.imageUrl,
        activeWindowName: record.activeWindowName,
        timestamp: record.timestamp,
        date: record.date,
        isIdle: record.isIdle,
      }),
    });

    if (response.ok) {
      const savedDoc = await response.json();
      record.imageUrl = savedDoc.imageUrl || record.imageUrl;
      record.syncStatus = 'ONLINE';
      console.log(`[CaptureService] Transmission SUCCESS: Saved PNG on disk & document in MongoDB collection Screenshot! ID: ${savedDoc.id}`);
      
      // Process offline queue if connection restored
      await flushOfflineQueue();
    } else {
      throw new Error(`HTTP Error ${response.status}`);
    }
  } catch (err) {
    console.warn('[CaptureService] Backend offline / network un-reachable. Saving screenshot to offline sync queue...', err);
    record.syncStatus = 'QUEUED_OFFLINE';
    offlineSyncQueue.push(record);
  }

  // Prepend to memory store
  screenshotRecordsStore = [record, ...screenshotRecordsStore];
}

/**
 * Flush Offline Sync Queue when Network is Restored
 */
async function flushOfflineQueue(): Promise<void> {
  if (offlineSyncQueue.length === 0) return;

  console.log(`[CaptureService] Flushing ${offlineSyncQueue.length} offline queued screenshots to MongoDB Atlas...`);
  const queueCopy = [...offlineSyncQueue];
  offlineSyncQueue = [];

  for (const record of queueCopy) {
    try {
      await fetch('http://localhost:3000/api/v1/screenshots/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: record.userName,
          userId: record.userId,
          userRole: record.userRole,
          imageUrl: record.imageUrl,
          activeWindowName: record.activeWindowName,
          timestamp: record.timestamp,
          date: record.date,
          isIdle: record.isIdle,
        }),
      });
      record.syncStatus = 'ONLINE';
    } catch (e) {
      offlineSyncQueue.push(record);
    }
  }
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
    console.log('[CaptureService] 5-minute automated capture loop executing...');
    await captureDesktopScreen('emp-101', 'umer Sohail', 'Full Stack Engineer');
  }, ms);
}

/**
 * STEP 4: REGISTER IPC HANDLERS FOR MANAGER DASHBOARD MANUAL OVERRIDE
 */
export function registerCaptureIpcHandlers(): void {
  // Manual Override: Manager clicks "Capture Live Screen Now" -> Immediate silent capture within seconds
  ipcMain.handle('trigger-manual-capture', async (_event, targetUserId?: string, targetUserName?: string, targetUserRole?: string) => {
    console.log(`[CaptureService] Manager Manual Override triggered for ${targetUserName || 'umer Sohail'}`);
    const record = await captureDesktopScreen(targetUserId || 'emp-101', targetUserName || 'umer Sohail', targetUserRole || 'Full Stack Engineer');
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

  // Start 5-minute automated background loop
  startAutomated5MinScreenCaptureLoop(5);
}

