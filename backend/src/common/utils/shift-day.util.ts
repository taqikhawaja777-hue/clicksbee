/** Shared 10:00-19:00 Asia/Karachi work-schedule rules. */
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
export const SHIFT_START_MINUTES_OF_DAY = 10 * 60;
export const SHIFT_END_MINUTES_OF_DAY = 19 * 60;

// The paid schedule is nine clock hours, with one hour of automatic breaks.
export const SCHEDULED_BREAKS = [
  { label: 'Lunch & Zuhr Prayer', startMinutes: 13 * 60 + 30, endMinutes: 14 * 60 + 10 },
  { label: 'Tea & Asar Prayer', startMinutes: 17 * 60, endMinutes: 17 * 60 + 20 },
] as const;

function karachiWallClock(d: Date): Date {
  return new Date(d.getTime() + KARACHI_OFFSET_MS);
}

function dayKeyFromKarachi(karachi: Date): string {
  return `${karachi.getUTCFullYear()}-${String(karachi.getUTCMonth() + 1).padStart(2, '0')}-${String(karachi.getUTCDate()).padStart(2, '0')}`;
}

function utcForKarachiDayMinute(dayStr: string, minute: number): Date {
  const [year, month, day] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, minute, 0, 0) - KARACHI_OFFSET_MS);
}

/** A shift is assigned to its actual Karachi calendar date, never tomorrow. */
export function getShiftDayString(d: Date = new Date()): string {
  return dayKeyFromKarachi(karachiWallClock(d));
}

export function getKarachiMinutesOfDay(d: Date = new Date()): number {
  const karachi = karachiWallClock(d);
  return karachi.getUTCHours() * 60 + karachi.getUTCMinutes();
}

export function isWithinShift(d: Date = new Date()): boolean {
  const minutes = getKarachiMinutesOfDay(d);
  return minutes >= SHIFT_START_MINUTES_OF_DAY && minutes < SHIFT_END_MINUTES_OF_DAY;
}

export function isPastShiftEnd(d: Date = new Date()): boolean {
  return getKarachiMinutesOfDay(d) >= SHIFT_END_MINUTES_OF_DAY;
}

export function isScheduledBreakTime(d: Date = new Date()): boolean {
  const minutes = getKarachiMinutesOfDay(d);
  return SCHEDULED_BREAKS.some((period) => minutes >= period.startMinutes && minutes < period.endMinutes);
}

/** Real UTC interval for the one shift on a Karachi calendar date. */
export function getShiftDayWindow(dayStr: string): { start: Date; end: Date } {
  return {
    start: utcForKarachiDayMinute(dayStr, SHIFT_START_MINUTES_OF_DAY),
    end: new Date(utcForKarachiDayMinute(dayStr, SHIFT_END_MINUTES_OF_DAY).getTime() - 1),
  };
}

/** Counts scheduled-break seconds that overlap an actual interval. */
export function getScheduledBreakSeconds(dayStr: string, from: Date, to: Date): number {
  if (to <= from) return 0;
  return SCHEDULED_BREAKS.reduce((total, period) => {
    const start = utcForKarachiDayMinute(dayStr, period.startMinutes);
    const end = utcForKarachiDayMinute(dayStr, period.endMinutes);
    const overlapStart = Math.max(from.getTime(), start.getTime());
    const overlapEnd = Math.min(to.getTime(), end.getTime());
    return total + Math.max(0, Math.floor((overlapEnd - overlapStart) / 1000));
  }, 0);
}
