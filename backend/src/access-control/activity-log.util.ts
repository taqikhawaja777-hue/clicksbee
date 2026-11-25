/**
 * Full-day app/window activity log entries (sent by the desktop app,
 * stored in ApplicationUsage). Only app/window NAMES and times are kept -
 * never keystrokes, passwords or message content.
 */

export interface ActivityLogEntryInput {
  id: string;
  app: string;
  process?: string | null;
  title?: string | null;
  startedAt: string;
  endedAt: string;
  idle?: boolean;
}

export interface CleanEntry {
  eventId: string;
  applicationName: string;
  processName: string;
  windowTitle: string | null;
  startedAt: Date;
  endedAt: Date;
  duration: number;
  category: 'Active' | 'Idle';
  isProductive: boolean;
}

export const MAX_ENTRIES_PER_BATCH = 500;
const MAX_TITLE = 300;

/** Validates and normalizes one upload batch; invalid entries are dropped, never stored. */
export function cleanEntries(entries: unknown, now: Date = new Date()): CleanEntry[] {
  if (!Array.isArray(entries)) return [];
  const out: CleanEntry[] = [];
  for (const raw of entries.slice(0, MAX_ENTRIES_PER_BATCH)) {
    const e = raw as ActivityLogEntryInput;
    if (!e || typeof e.id !== 'string' || !/^[\w-]{8,64}$/.test(e.id)) continue;
    const start = new Date(e.startedAt);
    const end = new Date(e.endedAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) continue;
    if (end.getTime() > now.getTime() + 5 * 60_000) continue; // not in the future
    if (now.getTime() - start.getTime() > 14 * 86_400_000) continue; // offline backlog up to 14 days
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);
    if (duration > 12 * 3600) continue;
    const app = String(e.app || '').trim().slice(0, 120) || 'Unknown';
    out.push({
      eventId: `actlog-${e.id}`,
      applicationName: app,
      processName: String(e.process || app).trim().slice(0, 120),
      windowTitle: e.title ? String(e.title).trim().slice(0, MAX_TITLE) : null,
      startedAt: start,
      endedAt: end,
      duration,
      category: e.idle ? 'Idle' : 'Active',
      isProductive: !e.idle,
    });
  }
  return out;
}

export interface StoredEntry {
  applicationName: string;
  windowTitle: string | null;
  startedAt: Date;
  endedAt: Date;
  duration: number;
  category: string;
}

/** Per-app totals + day totals for the log screen. */
export function summarize(entries: StoredEntry[]) {
  const byApp = new Map<string, { app: string; activeSeconds: number; idleSeconds: number; sessions: number }>();
  let activeSeconds = 0;
  let idleSeconds = 0;
  for (const e of entries) {
    const row = byApp.get(e.applicationName) || { app: e.applicationName, activeSeconds: 0, idleSeconds: 0, sessions: 0 };
    if (e.category === 'Idle') {
      row.idleSeconds += e.duration;
      idleSeconds += e.duration;
    } else {
      row.activeSeconds += e.duration;
      activeSeconds += e.duration;
    }
    row.sessions++;
    byApp.set(e.applicationName, row);
  }
  const first = entries.length ? entries.reduce((a, b) => (a.startedAt < b.startedAt ? a : b)).startedAt : null;
  const last = entries.length ? entries.reduce((a, b) => (a.endedAt > b.endedAt ? a : b)).endedAt : null;
  return {
    activeSeconds,
    idleSeconds,
    firstActivityAt: first,
    lastActivityAt: last,
    apps: [...byApp.values()].sort((a, b) => b.activeSeconds - a.activeSeconds),
  };
}
