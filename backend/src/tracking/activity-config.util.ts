import { BadRequestException } from '@nestjs/common';

/** Same defaults as the desktop app (admin_dashboard/activityClassifier.ts). */
export const DEFAULT_UNPRODUCTIVE_KEYWORDS = [
  'youtube', 'netflix', 'facebook', 'instagram', 'tiktok', 'snapchat', 'twitter', 'reddit',
  'prime video', 'hotstar', 'dailymotion', 'twitch', 'spotify', 'steam', 'epic games',
  'roblox', 'minecraft', 'pubg', 'free fire', 'solitaire', 'candy crush',
];

export const ACTIVITY_STATES = ['ON_CALL', 'DIALING', 'OTHER_WORK', 'UNPRODUCTIVE', 'IDLE', 'SUSPICIOUS'] as const;

const BREAKDOWN_KEYS = [
  'callSeconds',
  'callCount',
  'dialingSeconds',
  'otherWorkSeconds',
  'unproductiveSeconds',
  'suspiciousSeconds',
  'longestNoCallGapSeconds',
  // Excel / Google Sheets in front with mouse or keyboard use - part of active time, not extra.
  'spreadsheetSeconds',
] as const;

export type ActivityBreakdown = Record<(typeof BREAKDOWN_KEYS)[number], number>;

/** Cleans a manager-entered keyword list: trimmed, lower-case, unique, bounded. */
export function sanitizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) throw new BadRequestException('unproductiveKeywords must be a list of words');
  const out = [...new Set(input.map((k) => String(k ?? '').trim().toLowerCase()).filter(Boolean))];
  if (out.length > 100) throw new BadRequestException('At most 100 keywords');
  if (out.some((k) => k.length > 60)) throw new BadRequestException('Each keyword can be at most 60 characters');
  return out;
}

/** Breakdown from the desktop app, as non-negative whole numbers (unknown keys dropped). */
export function sanitizeBreakdown(input: unknown): ActivityBreakdown | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, unknown>;
  const out = {} as ActivityBreakdown;
  for (const key of BREAKDOWN_KEYS) out[key] = Math.max(0, Math.round(Number(src[key]) || 0));
  return out;
}

/** Report fields for one IdleTimeLog row (zeros for days logged by an older app). */
export function activityFields(
  idle: { activityBreakdown?: unknown; lastState?: string | null; updatedAt?: Date; idleSince?: Date | null } | null | undefined,
  now: Date = new Date(),
) {
  const b = sanitizeBreakdown(idle?.activityBreakdown) || ({} as Partial<ActivityBreakdown>);
  const fresh = !!idle?.updatedAt && now.getTime() - idle.updatedAt.getTime() <= 240_000;
  return {
    hasCallTracking: !!idle?.activityBreakdown,
    callSeconds: b.callSeconds || 0,
    callCount: b.callCount || 0,
    dialingSeconds: b.dialingSeconds || 0,
    otherWorkSeconds: b.otherWorkSeconds || 0,
    unproductiveSeconds: b.unproductiveSeconds || 0,
    suspiciousSeconds: b.suspiciousSeconds || 0,
    longestNoCallGapSeconds: b.longestNoCallGapSeconds || 0,
    spreadsheetSeconds: b.spreadsheetSeconds || 0,
    // What the employee is doing right now (only while the app is reporting).
    activityState: fresh && idle?.lastState ? idle.lastState : null,
    // Start of the current idle period (Team Lead view flags long idles).
    idleSince: fresh && idle?.lastState === 'IDLE' && idle?.idleSince ? idle.idleSince : null,
  };
}
