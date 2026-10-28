import {
  computeProductivityMetrics,
  mergeIntervals,
  computeIntervalUnionDuration,
  subtractIntervals,
} from './productivity.util';

describe('Productivity Calculation Engine', () => {
  describe('Haider ALI 2026-10-26 Reproduction', () => {
    it('should correctly calculate Haider ALI metrics with the new single-source formula', () => {
      // Haider ALI 2026-10-26:
      // Combined active: 3h 33m = 3 * 3600 + 33 * 60 = 12780s
      // Cisco Jabber: 1h 8m = 1 * 3600 + 8 * 60 = 4080s
      // Idle: 1h 18m = 1 * 3600 + 18 * 60 = 4680s
      // Attendance ratio: 73% (shift duration = 17500s)
      const activeSeconds = 12780;
      const jabberSeconds = 4080;
      const idleSeconds = 4680;
      const shiftDurationSeconds = 17500;

      const result = computeProductivityMetrics({
        activeSeconds,
        idleSeconds,
        jabberSeconds,
        shiftDurationSeconds,
      });

      // App Focus Score = (4080 / 12780) * 100 = 31.9248 -> 31.9%
      expect(result.appFocusScore).toBe(31.9);

      // Attendance Ratio = (12780 / 17500) * 100 = 73.028 -> 73%
      expect(result.attendanceRatio).toBe(73);

      // Idle penalty: max(0, 4680 - 300) / 60 = 4380 / 60 = 73 points
      // Compliance Score = 100 - 73 = 27%
      expect(result.idlePenaltyPoints).toBe(73);
      expect(result.complianceScore).toBe(27);

      // New Formula: 90% App Focus + 5% Compliance + 5% Attendance
      // 0.90 * 31.9 + 0.05 * 27 + 0.05 * 73 = 28.71 + 1.35 + 3.65 = 33.71 -> 33.7%
      expect(result.overallProductivityPercentage).toBe(33.7);
      expect(result.productivityPercentage).toBe(33.7);
      expect(result.weightsUsed).toEqual({
        attendanceWeight: 5,
        appFocusWeight: 90,
        complianceWeight: 5,
        callEfficiencyWeight: 0,
      });
    });
  });

  describe('Employee with no Jabber data', () => {
    it('should calculate 0% App Focus when no dialer time was spent', () => {
      const result = computeProductivityMetrics({
        activeSeconds: 7200, // 2 hours
        idleSeconds: 300,
        jabberSeconds: 0,
        wildixSeconds: 0,
        yeastarSeconds: 0,
        shiftDurationSeconds: 14400, // 4 hours
      });

      expect(result.appFocusScore).toBe(0);
      expect(result.attendanceRatio).toBe(50);
      expect(result.complianceScore).toBe(100);
      // 90% * 0 + 5% * 100 + 5% * 50 = 0 + 5 + 2.5 = 7.5%
      expect(result.overallProductivityPercentage).toBe(7.5);
    });
  });

  describe('Zero shift time / zero active time', () => {
    it('should return 0 without division by zero or NaN', () => {
      const result = computeProductivityMetrics({
        activeSeconds: 0,
        idleSeconds: 0,
        jabberSeconds: 0,
        shiftDurationSeconds: 0,
      });

      expect(result.appFocusScore).toBe(0);
      expect(result.attendanceRatio).toBe(0);
      expect(result.complianceScore).toBe(100);
      expect(result.overallProductivityPercentage).toBe(0);
      expect(Number.isNaN(result.overallProductivityPercentage)).toBe(false);
    });
  });

  describe('Overlapping app intervals (Interval Union)', () => {
    it('should merge overlapping intervals so the same minute is never double counted', () => {
      // App A active from t=0 to t=1800 (30 min)
      // App B active from t=900 to t=2700 (30 min, overlaps 15 min with App A)
      const intervals = [
        { start: 0, end: 1800 },
        { start: 900, end: 2700 },
      ];

      const merged = mergeIntervals(intervals);
      expect(merged).toEqual([{ start: 0, end: 2700 }]);

      const unionDuration = computeIntervalUnionDuration(intervals);
      expect(unionDuration).toBe(2700); // 45 minutes, NOT 60 minutes
    });

    it('should merge multiple disjoint and overlapping intervals correctly', () => {
      const intervals = [
        { start: 100, end: 200 },
        { start: 150, end: 300 },
        { start: 500, end: 600 },
        { start: 550, end: 700 },
        { start: 650, end: 800 },
      ];

      const merged = mergeIntervals(intervals);
      expect(merged).toEqual([
        { start: 100, end: 300 },
        { start: 500, end: 800 },
      ]);
      expect(computeIntervalUnionDuration(intervals)).toBe(200 + 300);
    });
  });

  describe('Break during shift', () => {
    it('should never count break time as idle time', () => {
      // Idle interval detected between 13:00 and 14:30 (5400s)
      // But scheduled break was 13:30 to 14:10 (2400s)
      const idleIntervals = [{ start: 13 * 3600, end: 14.5 * 3600 }];
      const breakIntervals = [{ start: 13.5 * 3600, end: 14.166666 * 3600 }];

      const netIdle = subtractIntervals(idleIntervals, breakIntervals);
      const netIdleSeconds = computeIntervalUnionDuration(netIdle);

      // Net idle should exclude the 40 min break
      expect(netIdleSeconds).toBeLessThan(5400);
    });
  });

  describe('Shift crossing midnight or bounds', () => {
    it('should correctly clamp scores to 0-100 even with high numbers', () => {
      const result = computeProductivityMetrics({
        activeSeconds: 50000,
        idleSeconds: 80000, // Large idle
        jabberSeconds: 60000, // Larger than active (bad raw data)
        shiftDurationSeconds: 10000,
      });

      expect(result.appFocusScore).toBeLessThanOrEqual(100);
      expect(result.attendanceRatio).toBeLessThanOrEqual(100);
      expect(result.complianceScore).toBe(0);
      expect(result.overallProductivityPercentage).toBeLessThanOrEqual(100);
      expect(result.overallProductivityPercentage).toBeGreaterThanOrEqual(0);
    });
  });
});
