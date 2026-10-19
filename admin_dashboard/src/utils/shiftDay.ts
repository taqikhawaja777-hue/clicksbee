/**
 * Shift records belong to their actual Asia/Karachi calendar date. Work is
 * accepted only from 10:00 to 19:00; after 19:00 there is no next-day
 * record until the next calendar morning's shift begins.
 */
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

export function getShiftDayKey(date: Date = new Date()): string {
  const karachi = new Date(date.getTime() + KARACHI_OFFSET_MS);
  return `${karachi.getUTCFullYear()}-${String(karachi.getUTCMonth() + 1).padStart(2, '0')}-${String(karachi.getUTCDate()).padStart(2, '0')}`;
}
