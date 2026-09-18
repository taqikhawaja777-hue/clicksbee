import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getShiftDayString, getShiftDayWindow, isPastShiftEnd } from '../common/utils/shift-day.util';

// "Other actions" NotificationTypes with no dedicated source collection of
// their own - CHECK_IN/CHECK_OUT/TASK_ASSIGNED/TASK_COMPLETED also exist as
// NotificationType values, but those are sourced from Attendance/Task
// directly below (the real, always-written record of the action itself,
// not the alert about it) so they're deliberately excluded here to avoid
// showing the same action twice.
const NOTIFICATION_SOURCED_ACTIONS = [
  'IDLE_ALERT',
  'CAMERA_ANOMALY',
  'WASHROOM_LIMIT',
  'LATE_BREAK_RETURN',
  'TASK_OVERDUE',
  'MANUAL_MESSAGE',
];

export interface LogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  description: string;
  timestamp: Date;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async logAction(
    organizationId: string,
    userId: string | null,
    action: string,
    entityType: string,
    entityId?: string,
    metadata?: any,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return this.prisma.auditLog.create({
      data: {
        organizationId,
        userId,
        action,
        entityType,
        entityId,
        metadata: metadata || {},
        ipAddress,
        userAgent,
      },
    });
  }

  /**
   * The manager-portal Logs page's real data source. Deliberately does NOT
   * read from the `AuditLog` collection above - nothing in this codebase
   * actually writes to it (the AuditInterceptor/@Audit() pair that's
   * supposed to is never attached to any route), so it's permanently
   * empty. Every action a manager actually needs to see already has a
   * real, always-written home elsewhere - this merges those instead:
   * Attendance (check in/out), BreakSession (breaks), ActivityEvent
   * (login), Task (assigned/completed), Screenshot, and Notification (for
   * alert-style "other actions" with no dedicated table of their own -
   * idle, camera, washroom, late break, overdue task, manual message).
   * One shift-day window at a time, same 19:00 Asia/Karachi rollover as
   * everywhere else date-scoped in this app (see shift-day.util.ts).
   */
  async getLogs(
    organizationId: string,
    page = 1,
    limit = 50,
    date?: string,
    userId?: string,
    action?: string,
  ) {
    const dayStr = date || getShiftDayString();
    const { start, end } = getShiftDayWindow(dayStr);

    const baseWhere: any = { organizationId };
    if (userId) baseWhere.userId = userId;

    // No action filter -> query every source. An action filter narrows to
    // just the one (or two, for the shared attendance/break pair) source
    // queries that could ever produce it, instead of fetching everything
    // and throwing most of it away.
    const wants = (a: string) => !action || action === a;
    const wantsNotification = !action || NOTIFICATION_SOURCED_ACTIONS.includes(action);

    const [attendance, breaks, logins, tasksByCreated, tasksByCompleted, screenshots, notifications, users] =
      await Promise.all([
        wants('CHECK_IN') || wants('CHECK_OUT') || wants('OVERTIME_CHECK_IN')
          ? this.prisma.attendance.findMany({ where: { ...baseWhere, clockIn: { gte: start, lte: end } } })
          : Promise.resolve([]),
        wants('BREAK_START') || wants('BREAK_END')
          ? this.prisma.breakSession.findMany({ where: { ...baseWhere, startedAt: { gte: start, lte: end } } })
          : Promise.resolve([]),
        wants('LOGIN')
          ? this.prisma.activityEvent.findMany({
              where: { ...baseWhere, type: 'LOGIN', timestamp: { gte: start, lte: end } },
            })
          : Promise.resolve([]),
        wants('TASK_ASSIGNED')
          ? this.prisma.task.findMany({
              where: { organizationId, ...(userId ? { assignedTo: userId } : {}), createdAt: { gte: start, lte: end } },
            })
          : Promise.resolve([]),
        wants('TASK_COMPLETED')
          ? this.prisma.task.findMany({
              where: { organizationId, ...(userId ? { assignedTo: userId } : {}), completedAt: { gte: start, lte: end } },
            })
          : Promise.resolve([]),
        wants('SCREENSHOT_CAPTURED')
          ? this.prisma.screenshot.findMany({ where: { ...baseWhere, capturedAt: { gte: start, lte: end } } })
          : Promise.resolve([]),
        wantsNotification
          ? this.prisma.notification.findMany({
              where: {
                organizationId,
                recipientType: 'EMPLOYEE',
                userId: userId || { not: null },
                type: (action as any) || { in: NOTIFICATION_SOURCED_ACTIONS },
                createdAt: { gte: start, lte: end },
              },
            })
          : Promise.resolve([]),
        this.prisma.user.findMany({
          where: { organizationId, ...(userId ? { id: userId } : {}) },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);

    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const rows: LogEntry[] = [];

    attendance.forEach((a) => {
      const userName = nameOf.get(a.userId) || 'Unknown';
      if (a.clockIn) {
        // A check-in AT or AFTER the shift's own 19:00 end is arriving
        // after the shift should already be over, not a normal check-in -
        // relabeled as its own action instead of just "Checked in" so a
        // manager can filter specifically for it. Same boundary
        // getShiftDayString() rolls the calendar date over at, not a
        // second/different definition of "late".
        if (isPastShiftEnd(a.clockIn)) {
          if (wants('OVERTIME_CHECK_IN')) {
            rows.push({ id: `${a.id}-in`, userId: a.userId, userName, action: 'OVERTIME_CHECK_IN', description: 'Checked in after shift end (overtime)', timestamp: a.clockIn });
          }
        } else if (wants('CHECK_IN')) {
          rows.push({ id: `${a.id}-in`, userId: a.userId, userName, action: 'CHECK_IN', description: 'Checked in', timestamp: a.clockIn });
        }
      }
      if (a.clockOut && wants('CHECK_OUT')) {
        rows.push({ id: `${a.id}-out`, userId: a.userId, userName, action: 'CHECK_OUT', description: 'Checked out', timestamp: a.clockOut });
      }
    });

    breaks.forEach((b) => {
      const userName = nameOf.get(b.userId) || 'Unknown';
      const label = b.breakType.replace(/_/g, ' ').toLowerCase();
      if (b.startedAt && wants('BREAK_START')) {
        rows.push({ id: `${b.id}-start`, userId: b.userId, userName, action: 'BREAK_START', description: `Started ${label}`, timestamp: b.startedAt });
      }
      if (b.endedAt && wants('BREAK_END')) {
        rows.push({ id: `${b.id}-end`, userId: b.userId, userName, action: 'BREAK_END', description: `Ended ${label}`, timestamp: b.endedAt });
      }
    });

    logins.forEach((ev) => {
      rows.push({ id: ev.id, userId: ev.userId, userName: nameOf.get(ev.userId) || 'Unknown', action: 'LOGIN', description: 'Logged in', timestamp: ev.timestamp });
    });

    tasksByCreated.forEach((t) => {
      if (!t.assignedTo) return;
      rows.push({ id: `${t.id}-assigned`, userId: t.assignedTo, userName: nameOf.get(t.assignedTo) || 'Unknown', action: 'TASK_ASSIGNED', description: `Assigned task: ${t.title}`, timestamp: t.createdAt });
    });

    tasksByCompleted.forEach((t) => {
      if (!t.assignedTo || !t.completedAt) return;
      rows.push({ id: `${t.id}-completed`, userId: t.assignedTo, userName: nameOf.get(t.assignedTo) || 'Unknown', action: 'TASK_COMPLETED', description: `Completed task: ${t.title}`, timestamp: t.completedAt });
    });

    screenshots.forEach((s) => {
      rows.push({ id: s.id, userId: s.userId, userName: nameOf.get(s.userId) || 'Unknown', action: 'SCREENSHOT_CAPTURED', description: 'Screenshot captured', timestamp: s.capturedAt });
    });

    notifications.forEach((n) => {
      // The ADMIN-scoped copy of the same event (userId null, visible in
      // the org-wide notification feed) is skipped here - only the
      // EMPLOYEE-scoped copy (real userId) is attributable to one person.
      if (!n.userId) return;
      rows.push({ id: n.id, userId: n.userId, userName: nameOf.get(n.userId) || 'Unknown', action: n.type, description: n.message, timestamp: n.createdAt });
    });

    rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = rows.length;
    const skip = (page - 1) * limit;
    const data = rows.slice(skip, skip + limit);

    return {
      data,
      // date lives inside pagination, not as a sibling key - TransformInterceptor
      // special-cases any {data, pagination} return by flattening both to the
      // top level (success/data/pagination/message) rather than nesting the
      // whole object under one outer `data`, and it only carries those two
      // keys through - a third top-level key here would be silently dropped.
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        date: dayStr,
      },
    };
  }
}
