/**
 * Full-day app/window log for auto-tracked roles (Back Office, Validator,
 * Closer, Team Lead): which app/window is in front (e.g. "Leads.xlsx -
 * Excel", WhatsApp, a browser tab title), from when to when, and whether the
 * person was idle or the screen was locked.
 *
 * Records app and window NAMES and times only - never keystrokes, passwords
 * or message content. Runs all day (not just shift hours) while the user is
 * signed in. Stored on disk first, so nothing is lost offline; uploaded every
 * minute when the internet is available.
 */
import { app, powerMonitor } from 'electron';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { authHeaders } from './authSession';

const POLL_MS = 5_000;
const SYNC_MS = 60_000;
const IDLE_SECONDS = 120;
/** Long segments are split so a crash never loses more than this. */
const MAX_SEGMENT_MS = 10 * 60_000;
const MAX_QUEUE = 20_000;
const BATCH = 500;

interface Segment {
  id: string;
  app: string;
  process: string | null;
  title: string | null;
  idle: boolean;
  startedAt: string;
  endedAt: string;
}

interface OpenSegment {
  key: string;
  app: string;
  process: string | null;
  title: string | null;
  idle: boolean;
  startedAt: number;
}

/** Friendly app name from the window owner (e.g. "EXCEL.EXE" -> "Excel"). */
export function appNameFor(owner: string | undefined, title: string | undefined): string {
  const name = (owner || '').replace(/\.exe$/i, '').trim();
  const known: Record<string, string> = {
    excel: 'Excel',
    winword: 'Word',
    powerpnt: 'PowerPoint',
    outlook: 'Outlook',
    chrome: 'Google Chrome',
    msedge: 'Microsoft Edge',
    firefox: 'Firefox',
    opera: 'Opera',
    whatsapp: 'WhatsApp',
    explorer: 'File Explorer',
    teams: 'Microsoft Teams',
    'ms-teams': 'Microsoft Teams',
    notepad: 'Notepad',
  };
  const lower = name.toLowerCase();
  if (known[lower]) return known[lower];
  if (/whatsapp/i.test(name) || /whatsapp/i.test(title || '')) return 'WhatsApp';
  return name || 'Unknown';
}

class AppUsageLogger {
  private userId: string | null = null;
  private apiBaseUrl = '';
  private pollTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private current: OpenSegment | null = null;
  private syncing = false;

  private queueFile(): string {
    return path.join(app.getPath('userData'), 'worktrackpro_activity_log_queue.json');
  }

  private loadQueue(): Segment[] {
    try {
      const f = this.queueFile();
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) || [] : [];
    } catch {
      return [];
    }
  }

  private saveQueue(queue: Segment[]): void {
    try {
      fs.writeFileSync(this.queueFile(), JSON.stringify(queue.slice(-MAX_QUEUE)), 'utf-8');
    } catch (err) {
      console.warn('[AppUsageLogger] Could not save the offline log:', err);
    }
  }

  isRunning(): boolean {
    return !!this.pollTimer;
  }

  start(userId: string, apiBaseUrl: string): void {
    if (this.pollTimer && this.userId === userId) return;
    this.stop();
    this.userId = userId;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    this.syncTimer = setInterval(() => void this.sync(), SYNC_MS);
    powerMonitor.on('suspend', this.onSuspend);
    void this.poll();
    void this.sync();
    console.log(`[AppUsageLogger] Full-day activity log started for ${userId}`);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.pollTimer = null;
    this.syncTimer = null;
    powerMonitor.removeListener('suspend', this.onSuspend);
    this.closeCurrent(Date.now());
    void this.sync();
  }

  private onSuspend = () => this.closeCurrent(Date.now());

  private closeCurrent(endedAt: number): void {
    const seg = this.current;
    this.current = null;
    if (!seg || endedAt - seg.startedAt < 1_000) return;
    const queue = this.loadQueue();
    queue.push({
      id: randomUUID(),
      app: seg.app,
      process: seg.process,
      title: seg.title,
      idle: seg.idle,
      startedAt: new Date(seg.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
    });
    this.saveQueue(queue);
  }

  private async poll(): Promise<void> {
    if (!this.userId) return;
    const now = Date.now();
    const state = powerMonitor.getSystemIdleState(IDLE_SECONDS); // 'active' | 'idle' | 'locked' | 'unknown'
    let next: Omit<OpenSegment, 'startedAt'>;
    if (state === 'locked') {
      next = { key: 'LOCKED', app: 'Screen locked', process: null, title: null, idle: true };
    } else if (state === 'idle') {
      next = { key: 'IDLE', app: 'Idle (no mouse/keyboard)', process: null, title: null, idle: true };
    } else {
      let win: { owner?: { name?: string }; title?: string } | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        win = await require('active-win')();
      } catch {
        win = null;
      }
      const owner = win?.owner?.name || '';
      const title = (win?.title || '').slice(0, 300) || null;
      next = { key: `${owner}|${title || ''}`, app: appNameFor(owner, title || ''), process: owner || null, title, idle: false };
    }

    const cur = this.current;
    if (!cur || cur.key !== next.key || now - cur.startedAt >= MAX_SEGMENT_MS) {
      // An idle period really started when input stopped, not at detection.
      const idleSince = next.idle && state === 'idle' ? now - powerMonitor.getSystemIdleTime() * 1000 : now;
      const boundary = cur && cur.key !== next.key ? Math.max(cur.startedAt, Math.min(now, idleSince)) : now;
      this.closeCurrent(boundary);
      this.current = { ...next, startedAt: boundary };
    }
  }

  async sync(): Promise<void> {
    if (this.syncing || !this.userId || !this.apiBaseUrl) return;
    this.syncing = true;
    try {
      let queue = this.loadQueue();
      while (queue.length > 0) {
        const batch = queue.slice(0, BATCH);
        const res = await fetch(`${this.apiBaseUrl}/api/v1/activity-log/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ userId: this.userId, entries: batch }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        queue = this.loadQueue().slice(batch.length);
        this.saveQueue(queue);
      }
    } catch (err) {
      // Offline or server busy - everything stays in the local queue for the next try.
      console.warn('[AppUsageLogger] Upload postponed:', (err as Error).message);
    } finally {
      this.syncing = false;
    }
  }
}

export const appUsageLogger = new AppUsageLogger();
