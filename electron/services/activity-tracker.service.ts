/**
 * ActivityTrackerService — Electron Main Process
 *
 * Tracks the active window title every 5 seconds, batches activity logs,
 * and POSTs them to the backend every 30 seconds.
 * Sends heartbeat to /monitor/heartbeat every 30 seconds.
 * Detects IDLE after 5 minutes of no window change.
 */

interface ActivityEntry {
  windowTitle: string;
  appName: string;
  startTime: number;
  duration: number;
}

export class ActivityTrackerService {
  private isTracking = false;
  private employeeId: string = '';
  private apiBaseUrl: string = 'http://localhost:3000';
  private authToken: string = '';

  // Intervals
  private windowPollInterval: NodeJS.Timeout | null = null;
  private batchSendInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Activity buffer
  private activityBuffer: ActivityEntry[] = [];
  private lastActiveWindow: string = '';
  private lastInputTime: number = Date.now();
  private currentEntryStart: number = Date.now();
  private idleThresholdMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Start all tracking loops
   */
  public start(employeeId: string, apiBaseUrl: string = 'http://localhost:3000', token: string = ''): void {
    if (this.isTracking) {
      console.log('[ActivityTracker] Already tracking, ignoring duplicate start.');
      return;
    }

    this.employeeId = employeeId;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.authToken = token;
    this.isTracking = true;
    this.lastInputTime = Date.now();

    console.log(`[ActivityTracker] Starting tracking for employeeId: ${employeeId}`);

    // 1. Poll active window every 5 seconds
    this.windowPollInterval = setInterval(() => this.pollActiveWindow(), 5000);

    // 2. Batch send activity logs every 30 seconds
    this.batchSendInterval = setInterval(() => this.sendActivityBatch(), 30000);

    // 3. Heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 30000);

    // Send initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Stop all tracking loops
   */
  public stop(): void {
    console.log(`[ActivityTracker] Stopping tracking for employeeId: ${this.employeeId}`);
    this.isTracking = false;

    if (this.windowPollInterval) clearInterval(this.windowPollInterval);
    if (this.batchSendInterval) clearInterval(this.batchSendInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.windowPollInterval = null;
    this.batchSendInterval = null;
    this.heartbeatInterval = null;

    // Flush remaining buffer
    this.sendActivityBatch();

    // Send offline heartbeat
    this.sendHeartbeat('OFFLINE');
  }

  /**
   * Get current tracking status
   */
  public getStatus(): { isTracking: boolean; employeeId: string; bufferSize: number; isIdle: boolean } {
    return {
      isTracking: this.isTracking,
      employeeId: this.employeeId,
      bufferSize: this.activityBuffer.length,
      isIdle: this.isCurrentlyIdle(),
    };
  }

  /**
   * Poll the active window title (cross-platform)
   */
  private async pollActiveWindow(): Promise<void> {
    try {
      let windowTitle = 'Unknown Window';
      let appName = 'Unknown App';

      // Use Electron's BrowserWindow to detect focused window
      // In production, use packages like 'active-win' for native OS-level tracking
      try {
        const { BrowserWindow } = require('electron');
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) {
          windowTitle = focusedWindow.getTitle() || 'Electron App';
          appName = 'Electron';
        }
      } catch {
        // Fallback: desktop environment detection
        windowTitle = `Desktop Workstation — ${new Date().toLocaleTimeString()}`;
        appName = 'Desktop';
      }

      // Check if window changed
      if (windowTitle !== this.lastActiveWindow) {
        // Record duration for previous window
        if (this.lastActiveWindow) {
          const duration = Math.floor((Date.now() - this.currentEntryStart) / 1000);
          this.activityBuffer.push({
            windowTitle: this.lastActiveWindow,
            appName,
            startTime: this.currentEntryStart,
            duration,
          });
        }

        this.lastActiveWindow = windowTitle;
        this.currentEntryStart = Date.now();
        this.lastInputTime = Date.now(); // Window change = user input
      }
    } catch (err) {
      console.warn('[ActivityTracker] Window poll error:', err);
    }
  }

  /**
   * Send buffered activity logs to backend
   */
  private async sendActivityBatch(): Promise<void> {
    if (this.activityBuffer.length === 0) return;

    const batch = [...this.activityBuffer];
    this.activityBuffer = [];

    for (const entry of batch) {
      try {
        const endpoint = `${this.apiBaseUrl}/api/v1/monitor/activity/log`;
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          },
          body: JSON.stringify({
            employeeId: this.employeeId,
            windowTitle: entry.windowTitle,
            appName: entry.appName,
            duration: entry.duration,
            timestamp: new Date(entry.startTime).toISOString(),
          }),
        });
      } catch (err) {
        console.warn('[ActivityTracker] Activity log POST error:', err);
        // Re-queue failed entry
        this.activityBuffer.push(entry);
      }
    }
  }

  /**
   * Send heartbeat to backend
   */
  private async sendHeartbeat(overrideStatus?: string): Promise<void> {
    try {
      const status = overrideStatus || (this.isCurrentlyIdle() ? 'IDLE' : 'ACTIVE');
      const endpoint = `${this.apiBaseUrl}/api/v1/monitor/heartbeat`;

      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: JSON.stringify({
          employeeId: this.employeeId,
          status,
          activeWindow: this.lastActiveWindow || undefined,
        }),
      });
    } catch (err) {
      console.warn('[ActivityTracker] Heartbeat POST error:', err);
    }
  }

  /**
   * Check if user has been idle (no window changes for 5 minutes)
   */
  private isCurrentlyIdle(): boolean {
    return (Date.now() - this.lastInputTime) > this.idleThresholdMs;
  }
}

export const activityTrackerService = new ActivityTrackerService();
