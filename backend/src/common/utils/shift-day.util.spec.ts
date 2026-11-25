import { getScheduledBreakSeconds, getShiftDayWindow, isScheduledBreakTime, isWithinShift } from './shift-day.util';

// Asia/Karachi is UTC+5: 14:00 Karachi = 09:00 UTC.
const karachi = (hhmm: string) => new Date(`2026-11-25T${hhmm}:00+05:00`);

describe('shift-day schedule', () => {
  it('the only break is 2:00 PM - 3:00 PM', () => {
    expect(isScheduledBreakTime(karachi('14:00'))).toBe(true);
    expect(isScheduledBreakTime(karachi('14:59'))).toBe(true);
    expect(isScheduledBreakTime(karachi('15:00'))).toBe(false);
    expect(isScheduledBreakTime(karachi('13:59'))).toBe(false);
  });

  it('the old lunch (1:30-2:10) and tea/Asar (5:00-5:20) times are working time now', () => {
    expect(isScheduledBreakTime(karachi('13:45'))).toBe(false);
    expect(isScheduledBreakTime(karachi('17:10'))).toBe(false);
    expect(isWithinShift(karachi('17:10'))).toBe(true);
  });

  it('a full shift (10:00-19:00) contains exactly one hour of break', () => {
    const { start, end } = getShiftDayWindow('2026-11-25');
    expect(getScheduledBreakSeconds('2026-11-25', start, end)).toBe(3600);
    // Worked 13:00-14:30 -> only 30 min of it was break.
    expect(getScheduledBreakSeconds('2026-11-25', karachi('13:00'), karachi('14:30'))).toBe(1800);
  });
});
