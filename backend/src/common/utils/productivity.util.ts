/**
 * Shared Single-Source-of-Truth Productivity Calculation Engine
 * 
 * Formula:
 *   Overall Productivity = 90% x App Focus Score + 5% x Compliance Score + 5% x Attendance Ratio
 * 
 * Rules:
 *   - Each component is between 0 and 100.
 *   - Clamped to 0 - 100, no division by zero (returns 0 instead of NaN).
 *   - Rounded to 1 decimal place.
 *   - Interval-union merges overlapping active intervals so no minute is double-counted.
 *   - Break time and approved leave NEVER count as idle time.
 *   - Time outside shift window is excluded.
 */

export interface TimeInterval {
  start: number; // Unix timestamp in ms or seconds (consistent across call)
  end: number;
}

export interface ProductivityCalculationInput {
  activeSeconds: number;
  idleSeconds: number;
  jabberSeconds?: number;
  wildixSeconds?: number;
  yeastarSeconds?: number;
  dialerSeconds?: number;
  shiftDurationSeconds: number;
  breakSeconds?: number;
}

export interface ProductivityCalculationResult {
  attendanceRatio: number;
  appFocusScore: number;
  complianceScore: number;
  idlePenaltyPoints: number;
  overallProductivityPercentage: number;
  productivityPercentage: number; // Backward compatibility alias
  dialerSeconds: number;
  weightsUsed: {
    attendanceWeight: number;
    appFocusWeight: number;
    complianceWeight: number;
    callEfficiencyWeight: number;
  };
}

export const PRODUCTIVITY_WEIGHTS = {
  attendanceWeight: 5,
  appFocusWeight: 90,
  complianceWeight: 5,
  callEfficiencyWeight: 0,
} as const;

/**
 * Merge overlapping or contiguous intervals into a disjoint set of sorted intervals.
 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (!intervals || intervals.length === 0) return [];

  // Filter valid intervals and sort by start
  const valid = intervals
    .filter((inv) => inv && Number.isFinite(inv.start) && Number.isFinite(inv.end) && inv.end > inv.start)
    .map((inv) => ({ start: Math.floor(inv.start), end: Math.floor(inv.end) }))
    .sort((a, b) => a.start - b.start);

  if (valid.length === 0) return [];

  const merged: TimeInterval[] = [valid[0]];

  for (let i = 1; i < valid.length; i++) {
    const current = valid[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Overlapping or contiguous
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Compute the total duration (in units of interval start/end) of merged intervals.
 */
export function computeIntervalUnionDuration(intervals: TimeInterval[]): number {
  const merged = mergeIntervals(intervals);
  return merged.reduce((acc, inv) => acc + Math.max(0, inv.end - inv.start), 0);
}

/**
 * Subtract break intervals from idle intervals to guarantee break time NEVER counts as idle.
 */
export function subtractIntervals(sourceIntervals: TimeInterval[], subtractIntervalsList: TimeInterval[]): TimeInterval[] {
  const mergedSource = mergeIntervals(sourceIntervals);
  const mergedSub = mergeIntervals(subtractIntervalsList);

  if (mergedSource.length === 0) return [];
  if (mergedSub.length === 0) return mergedSource;

  const result: TimeInterval[] = [];

  for (const src of mergedSource) {
    let currentStart = src.start;

    for (const sub of mergedSub) {
      if (sub.end <= currentStart) {
        continue;
      }
      if (sub.start >= src.end) {
        break;
      }

      if (sub.start > currentStart) {
        result.push({ start: currentStart, end: Math.min(src.end, sub.start) });
      }
      currentStart = Math.max(currentStart, sub.end);
      if (currentStart >= src.end) break;
    }

    if (currentStart < src.end) {
      result.push({ start: currentStart, end: src.end });
    }
  }

  return result;
}

function clampScore(val: number): number {
  if (!Number.isFinite(val) || Number.isNaN(val)) return 0;
  return Math.min(100, Math.max(0, Math.round(val * 10) / 10));
}

/**
 * THE shared single-source-of-truth calculation for productivity metrics.
 */
export function computeProductivityMetrics(input: ProductivityCalculationInput): ProductivityCalculationResult {
  const activeSeconds = Math.max(0, Number(input.activeSeconds) || 0);
  const idleSeconds = Math.max(0, Number(input.idleSeconds) || 0);
  const shiftDurationSeconds = Math.max(0, Number(input.shiftDurationSeconds) || 0);

  const jabberSeconds = Math.max(0, Number(input.jabberSeconds) || 0);
  const wildixSeconds = Math.max(0, Number(input.wildixSeconds) || 0);
  const yeastarSeconds = Math.max(0, Number(input.yeastarSeconds) || 0);
  const dialerSeconds = input.dialerSeconds !== undefined
    ? Math.max(0, Number(input.dialerSeconds) || 0)
    : (jabberSeconds + wildixSeconds + yeastarSeconds);

  // 1. App Focus Score:
  // App Focus = (Dialer Seconds / Combined Active Seconds) * 100
  const appFocusScore = activeSeconds > 0
    ? clampScore((dialerSeconds / activeSeconds) * 100)
    : 0;

  // 2. Attendance Ratio:
  // Attendance Ratio = (Combined Active Seconds / Shift Duration Seconds) * 100
  const attendanceRatio = shiftDurationSeconds > 0
    ? clampScore((activeSeconds / shiftDurationSeconds) * 100)
    : 0;

  // 3. Compliance Score:
  // Idle Penalty: 5 min grace threshold (300s). Over 300s, 1 point per 60s, max 100 points.
  const idlePenaltyPoints = Math.min(100, Math.max(0, Math.round((Math.max(0, idleSeconds - 300) / 60) * 10) / 10));
  const complianceScore = clampScore(100 - idlePenaltyPoints);

  // 4. Overall Productivity:
  // 90% App Focus + 5% Compliance + 5% Attendance
  const overallProductivityPercentage = (activeSeconds > 0 || shiftDurationSeconds > 0)
    ? clampScore(
        appFocusScore * (PRODUCTIVITY_WEIGHTS.appFocusWeight / 100) +
        complianceScore * (PRODUCTIVITY_WEIGHTS.complianceWeight / 100) +
        attendanceRatio * (PRODUCTIVITY_WEIGHTS.attendanceWeight / 100)
      )
    : 0;

  return {
    attendanceRatio,
    appFocusScore,
    complianceScore,
    idlePenaltyPoints,
    overallProductivityPercentage,
    productivityPercentage: overallProductivityPercentage, // Keep backward compatibility
    dialerSeconds,
    weightsUsed: { ...PRODUCTIVITY_WEIGHTS },
  };
}
