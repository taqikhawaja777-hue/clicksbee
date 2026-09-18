/**
 * Shift-day boundary shared across the whole system.
 *
 * The org's single fixed shift is 10:00-19:00 Asia/Karachi. Every "what day
 * is this" computation - here, in productivity_service's shift_day()
 * (app/services/productivity.py), and in admin_dashboard's
 * getShiftDayKey() (idleTimeTracker.ts) - must roll over at the shift's
 * 19:00 end, not local midnight, or the same event can land in different
 * day buckets depending which of these three places computed "today".
 * Keep all three in sync if this ever changes.
 *
 * Asia/Karachi is a fixed UTC+5 offset year-round (Pakistan observes no
 * DST), so this is plain millisecond arithmetic rather than a timezone-
 * database lookup.
 */
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const SHIFT_END_MINUTES_OF_DAY = 19 * 60; // 19:00

/** The shift-day bucket (YYYY-MM-DD) a moment belongs to. */
export function getShiftDayString(d: Date = new Date()): string {
  const karachi = new Date(d.getTime() + KARACHI_OFFSET_MS);
  const minutesOfDay = karachi.getUTCHours() * 60 + karachi.getUTCMinutes();
  if (minutesOfDay >= SHIFT_END_MINUTES_OF_DAY) {
    karachi.setUTCDate(karachi.getUTCDate() + 1);
  }
  const year = karachi.getUTCFullYear();
  const month = String(karachi.getUTCMonth() + 1).padStart(2, '0');
  const day = String(karachi.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Whether a moment falls at/after the shift's 19:00 Asia/Karachi end - the
 * same boundary getShiftDayString() rolls the date over at, exposed as its
 * own check for call sites that need to flag "this happened past shift
 * end" (e.g. a post-7pm check-in counting as overtime) rather than bucket
 * it into a day.
 */
export function isPastShiftEnd(d: Date): boolean {
  const karachi = new Date(d.getTime() + KARACHI_OFFSET_MS);
  const minutesOfDay = karachi.getUTCHours() * 60 + karachi.getUTCMinutes();
  return minutesOfDay >= SHIFT_END_MINUTES_OF_DAY;
}

/**
 * Inclusive [start, end] window, in real UTC instants, for a given
 * shift-day bucket string ("YYYY-MM-DD" as returned by getShiftDayString):
 * 19:00 Asia/Karachi the previous calendar day through one millisecond
 * before 19:00 Asia/Karachi this calendar day. Use this instead of
 * midnight-to-midnight when filtering timestamped records by shift-day.
 */
export function getShiftDayWindow(dayStr: string): { start: Date; end: Date } {
  const [year, month, day] = dayStr.split('-').map(Number);
  const shiftEndUtcMs = (dayOfMonth: number) =>
    Date.UTC(year, month - 1, dayOfMonth, 0, 0, 0, 0) +
    SHIFT_END_MINUTES_OF_DAY * 60000 -
    KARACHI_OFFSET_MS;
  return {
    start: new Date(shiftEndUtcMs(day - 1)),
    end: new Date(shiftEndUtcMs(day) - 1),
  };
}
