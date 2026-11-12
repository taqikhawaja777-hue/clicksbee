import {
  computeTaskProductivity,
  estimateAccuracy,
  isOnTime,
  weightedMinutes,
  MemberTaskStats,
  TASK_PRODUCTIVITY_CONFIG,
} from './task-productivity.util';

const base: MemberTaskStats = {
  tasksCreated: 0,
  teamCompleted: 0,
  ownCompleted: 0,
  completedWithDueDate: 0,
  completedOnTime: 0,
  completedWeightedMinutes: 0,
  estimateAccuracies: [],
  overdueOpen: 0,
  periodDays: 1,
};

describe('computeTaskProductivity', () => {
  it('scores 0 with no activity', () => {
    const r = computeTaskProductivity(base);
    expect(r.hasActivity).toBe(false);
    expect(r.score).toBe(0);
  });

  it('scores 100 for a perfect day', () => {
    const r = computeTaskProductivity({
      ...base,
      tasksCreated: 2,
      teamCompleted: 2,
      completedWithDueDate: 2,
      completedOnTime: 2,
      completedWeightedMinutes: TASK_PRODUCTIVITY_CONFIG.targetMinutesPerDay,
      estimateAccuracies: [100, 100],
    });
    expect(r).toMatchObject({ onTimeRate: 100, throughputScore: 100, accuracyScore: 100, overdueScore: 100, score: 100 });
  });

  it('weights components 40/30/20/10', () => {
    const r = computeTaskProductivity({
      ...base,
      teamCompleted: 4,
      completedWithDueDate: 4,
      completedOnTime: 2, // 50% on time
      completedWeightedMinutes: TASK_PRODUCTIVITY_CONFIG.targetMinutesPerDay / 2, // 50% throughput
      estimateAccuracies: [50], // 50% accuracy
      overdueOpen: 0, // 100
    });
    expect(r.score).toBe(50 * 0.4 + 50 * 0.3 + 50 * 0.2 + 100 * 0.1);
  });

  it('caps throughput at 100 and penalises overdue tasks', () => {
    const r = computeTaskProductivity({
      ...base,
      teamCompleted: 1,
      completedWeightedMinutes: 10_000,
      overdueOpen: 3,
    });
    expect(r.throughputScore).toBe(100);
    expect(r.overdueScore).toBe(100 - 3 * TASK_PRODUCTIVITY_CONFIG.overduePenaltyPerTask);
  });

  it('treats completed tasks without due dates or timing as neutral, not failing', () => {
    const r = computeTaskProductivity({ ...base, ownCompleted: 1, completedWeightedMinutes: 30 });
    expect(r.onTimeRate).toBe(100);
    expect(r.accuracyScore).toBe(100);
  });

  it('scales the throughput target by period length', () => {
    const oneDay = computeTaskProductivity({ ...base, teamCompleted: 1, completedWeightedMinutes: 240, periodDays: 1 });
    const twoDays = computeTaskProductivity({ ...base, teamCompleted: 1, completedWeightedMinutes: 240, periodDays: 2 });
    expect(oneDay.throughputScore).toBe(100);
    expect(twoDays.throughputScore).toBe(50);
  });
});

describe('helpers', () => {
  it('estimateAccuracy', () => {
    expect(estimateAccuracy(60, 60)).toBe(100);
    expect(estimateAccuracy(60, 90)).toBe(50);
    expect(estimateAccuracy(60, 200)).toBe(0);
    expect(estimateAccuracy(0, 30)).toBeNull();
    expect(estimateAccuracy(30, 0)).toBeNull();
  });

  it('isOnTime allows completion until the end of the due day', () => {
    const due = new Date('2026-11-10T00:00:00.000Z');
    expect(isOnTime(new Date('2026-11-10T20:00:00.000Z'), due)).toBe(true);
    expect(isOnTime(new Date('2026-11-11T01:00:00.000Z'), due)).toBe(false);
    expect(isOnTime(new Date(), null)).toBeNull();
  });

  it('weightedMinutes applies priority and a default estimate', () => {
    expect(weightedMinutes(60, 'URGENT')).toBe(90);
    expect(weightedMinutes(0, 'MEDIUM')).toBe(TASK_PRODUCTIVITY_CONFIG.defaultEstimatedMinutes);
  });
});
