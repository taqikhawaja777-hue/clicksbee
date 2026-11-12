import { TaskPriority } from '@prisma/client';

/**
 * Task-based productivity for non-employee team members (manager, HR, SM,
 * team lead, CSR) who are not covered by the dialer/idle tracker.
 *
 *   score = 40% on-time rate + 30% throughput + 20% estimate accuracy + 10% overdue hygiene
 */
export const TASK_PRODUCTIVITY_CONFIG = {
  weights: { onTime: 40, throughput: 30, accuracy: 20, overdue: 10 },
  // Estimated minutes of work the member's tasks should complete per day for full throughput marks.
  targetMinutesPerDay: 240,
  overduePenaltyPerTask: 20,
  defaultEstimatedMinutes: 30,
  // A task is on time if completed by the end of its due date.
  dueDateGraceMs: 24 * 60 * 60 * 1000,
  priorityWeights: { LOW: 0.75, MEDIUM: 1, HIGH: 1.25, URGENT: 1.5 } as Record<TaskPriority, number>,
};

export interface MemberTaskStats {
  tasksCreated: number;
  teamCompleted: number;
  ownCompleted: number;
  completedWithDueDate: number;
  completedOnTime: number;
  completedWeightedMinutes: number;
  estimateAccuracies: number[];
  overdueOpen: number;
  periodDays: number;
}

export interface TaskProductivityResult {
  onTimeRate: number;
  throughputScore: number;
  accuracyScore: number;
  overdueScore: number;
  score: number;
  hasActivity: boolean;
}

const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value * 10) / 10)) : 0;

export function weightedMinutes(estimatedMinutes: number, priority: TaskPriority): number {
  const { defaultEstimatedMinutes, priorityWeights } = TASK_PRODUCTIVITY_CONFIG;
  const estimate = estimatedMinutes > 0 ? estimatedMinutes : defaultEstimatedMinutes;
  return estimate * (priorityWeights[priority] ?? 1);
}

/** 100 = actual matched the estimate; 0 = off by the whole estimate or more. null = no usable timing. */
export function estimateAccuracy(estimatedMinutes: number, actualMinutes: number): number | null {
  if (!(estimatedMinutes > 0) || !(actualMinutes > 0)) return null;
  return clamp((1 - Math.abs(actualMinutes - estimatedMinutes) / estimatedMinutes) * 100);
}

export function isOnTime(completedAt: Date, dueDate: Date | null | undefined): boolean | null {
  if (!dueDate) return null;
  return completedAt.getTime() <= dueDate.getTime() + TASK_PRODUCTIVITY_CONFIG.dueDateGraceMs;
}

export function computeTaskProductivity(stats: MemberTaskStats): TaskProductivityResult {
  const { weights, targetMinutesPerDay, overduePenaltyPerTask } = TASK_PRODUCTIVITY_CONFIG;
  const completed = stats.teamCompleted + stats.ownCompleted;
  const hasActivity = stats.tasksCreated + completed + stats.overdueOpen > 0;
  if (!hasActivity) {
    return { onTimeRate: 0, throughputScore: 0, accuracyScore: 0, overdueScore: 0, score: 0, hasActivity };
  }

  const onTimeRate =
    stats.completedWithDueDate > 0
      ? clamp((stats.completedOnTime / stats.completedWithDueDate) * 100)
      : completed > 0
      ? 100
      : 0;

  const targetMinutes = targetMinutesPerDay * Math.max(1, stats.periodDays);
  const throughputScore = clamp((stats.completedWeightedMinutes / targetMinutes) * 100);

  const accuracyScore = stats.estimateAccuracies.length
    ? clamp(stats.estimateAccuracies.reduce((sum, v) => sum + v, 0) / stats.estimateAccuracies.length)
    : completed > 0
    ? 100
    : 0;

  const overdueScore = clamp(100 - stats.overdueOpen * overduePenaltyPerTask);

  const score = clamp(
    (onTimeRate * weights.onTime +
      throughputScore * weights.throughput +
      accuracyScore * weights.accuracy +
      overdueScore * weights.overdue) /
      100,
  );

  return { onTimeRate, throughputScore, accuracyScore, overdueScore, score, hasActivity };
}
