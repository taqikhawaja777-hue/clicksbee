import screenshot from 'screenshot-desktop';

export class ScreenshotService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start silent desktop screenshot capture every 60 seconds (60000ms) for an employee
   */
  public startCapture(employeeId: string, apiBaseUrl: string = 'http://localhost:3000'): void {
    if (!employeeId) return;

    // Prevent duplicate intervals for same employee
    if (this.intervals.has(employeeId)) {
      console.log(`[ScreenshotService] Capture interval already running for employeeId: ${employeeId}`);
      return;
    }

    console.log(`[ScreenshotService] Starting 60s silent capture for employeeId: ${employeeId}`);

    const captureTask = async () => {
      try {
        let base64Image = '';

        try {
          const imgBuffer = await screenshot({ format: 'jpeg' });
          base64Image = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
        } catch (err) {
          console.warn('[ScreenshotService] screenshot-desktop fallback:', err);
        }

        if (!base64Image) {
          console.warn('[ScreenshotService] Screenshot capture produced empty buffer, skipping upload.');
          return;
        }

        const timestamp = new Date().toISOString();
        const endpoint = `${apiBaseUrl.replace(/\/+$/, '')}/api/v1/monitor/analyze`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId,
            imageBase64: base64Image,
            timestamp,
          }),
        });

        if (response.ok) {
          console.log(`[ScreenshotService] Screenshot analyzed & broadcasted for employeeId: ${employeeId}`);
        } else {
          console.warn(`[ScreenshotService] POST /monitor/analyze failed with status ${response.status}`);
        }
      } catch (error) {
        console.error('[ScreenshotService] Error capturing desktop screenshot:', error);
      }
    };

    // Run first capture immediately
    captureTask();

    // Set 60-second interval (60000 ms)
    const timer = setInterval(captureTask, 60000);
    this.intervals.set(employeeId, timer);
  }

  /**
   * Stop capture interval for a specific employee
   */
  public stopCapture(employeeId: string): void {
    const timer = this.intervals.get(employeeId);
    if (timer) {
      clearInterval(timer);
      this.intervals.delete(employeeId);
      console.log(`[ScreenshotService] Stopped screenshot capture for employeeId: ${employeeId}`);
    }
  }

  /**
   * Stop all capture intervals across all employees
   */
  public stopAll(): void {
    this.intervals.forEach((timer, employeeId) => {
      clearInterval(timer);
      console.log(`[ScreenshotService] Stopped screenshot capture for employeeId: ${employeeId}`);
    });
    this.intervals.clear();
  }
}

export const screenshotService = new ScreenshotService();
