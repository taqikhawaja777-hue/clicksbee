/**
 * ProductivityCaptureService — Electron Main Process
 *
 * Tracks active-window vs idle time for a single task session:
 * - Polls `powerMonitor.getSystemIdleTime()` every 5s to detect idle.
 * - Polls the active window's app name every 5s via the optional
 *   `active-win` package (falls back to Electron's own focused window,
 *   same approach as captureService.ts, if `active-win` isn't installed).
 * - Buffers contiguous segments locally and POSTs them as a batch to the
 *   productivity-tracking FastAPI service every 45s — never one request
 *   per raw event.
 */
import { powerMonitor, ipcMain, BrowserWindow } from 'electron';

interface ActivitySegment {
  appName: string | null;
  isIdle: boolean;
  startedAt: number;
}

interface BufferedActivityEvent {
  taskId: string;
  employeeId: string;
  appName: string | null;
  isIdle: boolean;
  eventStart: string;
  eventEnd: string;
}

const IDLE_THRESHOLD_SECONDS = 60;
const POLL_INTERVAL_MS = 5000;
const BATCH_INTERVAL_MS = 45000;

class ProductivityCaptureService {
  private isCapturing = false;
  private taskId = '';
  private employeeId = '';
  private apiBaseUrl = 'http://localhost:8000';

  private pollTimer: NodeJS.Timeout | null = null;
  private batchTimer: NodeJS.Timeout | null = null;

  private buffer: BufferedActivityEvent[] = [];
  private currentSegment: ActivitySegment | null = null;

  /**
   * Start capturing activity for a task session.
   */
  public start(taskId: string, employeeId: string, apiBaseUrl: string = 'http://localhost:8000'): void {
    if (this.isCapturing) {
      console.log('[ProductivityCapture] Already capturing, ignoring duplicate start.');
      return;
    }

    this.taskId = taskId;
    this.employeeId = employeeId;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.isCapturing = true;
    this.currentSegment = null;

    console.log(`[ProductivityCapture] Starting capture for taskId=${taskId} employeeId=${employeeId}`);

    this.pollTimer = setInterval(() => this.pollActivity(), POLL_INTERVAL_MS);
    this.batchTimer = setInterval(() => this.flushBatch(), BATCH_INTERVAL_MS);
  }

  /**
   * Stop capturing, closing out and flushing any buffered activity.
   */
  public stop(): void {
    if (!this.isCapturing) return;
    console.log(`[ProductivityCapture] Stopping capture for taskId=${this.taskId}`);
    this.isCapturing = false;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.batchTimer) clearInterval(this.batchTimer);
    this.pollTimer = null;
    this.batchTimer = null;

    this.closeCurrentSegment();
    void this.flushBatch();
  }

  public getStatus(): { isCapturing: boolean; taskId: string; employeeId: string; bufferSize: number } {
    return {
      isCapturing: this.isCapturing,
      taskId: this.taskId,
      employeeId: this.employeeId,
      bufferSize: this.buffer.length,
    };
  }

  /**
   * Resolve the current foreground app name (cross-platform if `active-win`
   * is installed; otherwise Electron's own focused window as a fallback).
   */
  private async getActiveAppName(): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const activeWin = require('active-win');
      const result = await activeWin();
      if (result?.owner?.name) return result.owner.name;
    } catch {
      // `active-win` not installed (or unsupported platform) — fall through.
    }

    try {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !focused.isDestroyed()) {
        return focused.getTitle() || 'WorkTrackPro';
      }
    } catch {
      // ignore
    }

    return null;
  }

  private async pollActivity(): Promise<void> {
    if (!this.isCapturing) return;

    const idleSeconds = powerMonitor.getSystemIdleTime();
    const isIdle = idleSeconds >= IDLE_THRESHOLD_SECONDS;
    const appName = isIdle ? null : await this.getActiveAppName();

    if (!this.currentSegment) {
      this.currentSegment = { appName, isIdle, startedAt: Date.now() };
      return;
    }

    const segmentChanged =
      this.currentSegment.isIdle !== isIdle || this.currentSegment.appName !== appName;

    if (segmentChanged) {
      this.closeCurrentSegment();
      this.currentSegment = { appName, isIdle, startedAt: Date.now() };
    }
  }

  private closeCurrentSegment(): void {
    if (!this.currentSegment) return;
    const now = Date.now();
    if (now <= this.currentSegment.startedAt) {
      this.currentSegment = null;
      return;
    }

    this.buffer.push({
      taskId: this.taskId,
      employeeId: this.employeeId,
      appName: this.currentSegment.appName,
      isIdle: this.currentSegment.isIdle,
      eventStart: new Date(this.currentSegment.startedAt).toISOString(),
      eventEnd: new Date(now).toISOString(),
    });
    this.currentSegment = null;
  }

  private async flushBatch(): Promise<void> {
    // Close out the in-progress segment so its elapsed time isn't lost on
    // this flush, then immediately reopen an identical one so tracking
    // continues seamlessly across batch boundaries.
    if (this.currentSegment && this.isCapturing) {
      const reopened: ActivitySegment = { ...this.currentSegment };
      this.closeCurrentSegment();
      this.currentSegment = { ...reopened, startedAt: Date.now() };
    } else {
      this.closeCurrentSegment();
    }

    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/activity/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      console.log(`[ProductivityCapture] Sent ${batch.length} activity events.`);
    } catch (err) {
      console.warn('[ProductivityCapture] Failed to send activity batch, re-queueing:', err);
      this.buffer = [...batch, ...this.buffer];
    }
  }
}

export const productivityCaptureService = new ProductivityCaptureService();

/**
 * Register IPC handlers so the renderer can start/stop capture for a task.
 */
export function registerProductivityCaptureIpcHandlers(): void {
  ipcMain.handle(
    'start-productivity-capture',
    async (_event, args: { taskId: string; employeeId: string; apiBaseUrl?: string }) => {
      const { taskId, employeeId, apiBaseUrl } = args || ({} as typeof args);
      if (!taskId || !employeeId) {
        return { success: false, error: 'taskId and employeeId are required' };
      }
      try {
        productivityCaptureService.start(taskId, employeeId, apiBaseUrl);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle('stop-productivity-capture', async () => {
    try {
      productivityCaptureService.stop();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('get-productivity-capture-status', async () => {
    return { success: true, ...productivityCaptureService.getStatus() };
  });

  console.log('[ProductivityCapture] IPC handlers registered.');
}
