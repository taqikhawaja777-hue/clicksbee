/**
 * IPC Handlers — Electron Main Process
 *
 * Registers ipcMain handlers for controlling monitoring from the renderer process.
 * Handlers: start-monitoring, stop-monitoring, get-status, manual-screenshot
 */
import { ipcMain } from 'electron';
import { screenshotService } from './screenshot.service';
import { activityTrackerService } from './activity-tracker.service';

export function registerIpcHandlers(): void {
  console.log('[IPC] Registering IPC handlers for monitoring control...');

  /**
   * Start monitoring: begins screenshot capture + activity tracking
   */
  ipcMain.handle('start-monitoring', async (_event, args: {
    employeeId: string;
    apiBaseUrl?: string;
    token?: string;
  }) => {
    const { employeeId, apiBaseUrl = 'http://localhost:3000', token = '' } = args;

    if (!employeeId) {
      return { success: false, error: 'employeeId is required' };
    }

    try {
      // Start screenshot capture (60s interval)
      screenshotService.startCapture(employeeId, apiBaseUrl);

      // Start activity tracking (window polling + heartbeat)
      activityTrackerService.start(employeeId, apiBaseUrl, token);

      console.log(`[IPC] Monitoring started for employeeId: ${employeeId}`);
      return { success: true, employeeId };
    } catch (err) {
      console.error('[IPC] start-monitoring error:', err);
      return { success: false, error: String(err) };
    }
  });

  /**
   * Stop monitoring: stops screenshot capture + activity tracking
   */
  ipcMain.handle('stop-monitoring', async (_event, args: {
    employeeId: string;
  }) => {
    const { employeeId } = args;

    try {
      // Stop screenshot capture
      if (employeeId) {
        screenshotService.stopCapture(employeeId);
      } else {
        screenshotService.stopAll();
      }

      // Stop activity tracking
      activityTrackerService.stop();

      console.log(`[IPC] Monitoring stopped for employeeId: ${employeeId || 'all'}`);
      return { success: true };
    } catch (err) {
      console.error('[IPC] stop-monitoring error:', err);
      return { success: false, error: String(err) };
    }
  });

  /**
   * Get current monitoring status
   */
  ipcMain.handle('get-status', async () => {
    try {
      const trackerStatus = activityTrackerService.getStatus();
      return {
        success: true,
        ...trackerStatus,
      };
    } catch (err) {
      console.error('[IPC] get-status error:', err);
      return { success: false, error: String(err) };
    }
  });

  /**
   * Trigger a manual screenshot capture immediately
   */
  ipcMain.handle('manual-screenshot', async (_event, args: {
    employeeId: string;
    apiBaseUrl?: string;
  }) => {
    const { employeeId, apiBaseUrl = 'http://localhost:3000' } = args;

    if (!employeeId) {
      return { success: false, error: 'employeeId is required' };
    }

    try {
      // Stop existing interval, trigger one-shot, then restart
      screenshotService.stopCapture(employeeId);
      screenshotService.startCapture(employeeId, apiBaseUrl);

      console.log(`[IPC] Manual screenshot triggered for employeeId: ${employeeId}`);
      return { success: true, employeeId };
    } catch (err) {
      console.error('[IPC] manual-screenshot error:', err);
      return { success: false, error: String(err) };
    }
  });

  console.log('[IPC] All monitoring IPC handlers registered successfully.');
}
