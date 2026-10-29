import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getScheduledBreakSeconds, getShiftDayString, getShiftDayWindow, isScheduledBreakTime, isWithinShift } from '../common/utils/shift-day.util';
import { computeProductivityMetrics } from '../common/utils/productivity.util';

export interface IdleSnapshotInput {
  userId: string;
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  appFocusSeconds?: Record<string, number>;
  lastActiveApp?: string | null;
  lastIsIdle?: boolean;
}

type AppFocus = Record<string, number>;

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getCameraConfig() {
    const raw = await this.redis.get('config:camera');
    if (!raw) {
      return { globallyEnabled: true, employeeConfigs: {} };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return { globallyEnabled: true, employeeConfigs: {} };
    }
  }

  async updateCameraConfig(dto: { globallyEnabled?: boolean; employeeConfigs?: Record<string, boolean> }) {
    const current = await this.getCameraConfig();
    const next = {
      globallyEnabled: dto.globallyEnabled !== undefined ? dto.globallyEnabled : current.globallyEnabled,
      employeeConfigs: { ...current.employeeConfigs, ...(dto.employeeConfigs || {}) },
    };
    await this.redis.set('config:camera', JSON.stringify(next));
    return next;
  }

  async upsertIdleSnapshot(input: IdleSnapshotInput) {
    this.assertDate(input.date);
    if (input.date > getShiftDayString()) {
      throw new BadRequestException('Activity snapshot date cannot be in the future');
    }
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new NotFoundException('Employee not found');
    const cleanSeconds = (value: number) => Math.max(0, Math.round(Number(value) || 0));

    const result = await this.prisma.idleTimeLog.upsert({
      where: { userId_date: { userId: user.id, date: input.date } },
      create: {
        organizationId: user.organizationId, userId: user.id, date: input.date,
        activeSeconds: cleanSeconds(input.activeSeconds), idleSeconds: cleanSeconds(input.idleSeconds),
        appFocusSeconds: input.appFocusSeconds || {}, lastActiveApp: input.lastActiveApp || null,
        lastIsIdle: !!input.lastIsIdle,
      },
      update: {
        activeSeconds: cleanSeconds(input.activeSeconds), idleSeconds: cleanSeconds(input.idleSeconds),
        appFocusSeconds: input.appFocusSeconds || {}, lastActiveApp: input.lastActiveApp || null,
        lastIsIdle: !!input.lastIsIdle,
      },
    });

    // Invalidate cached summaries for this date
    await Promise.allSettled([
      this.redis.del(`cache:summary:${user.organizationId}:${input.date}`),
      this.redis.del(`cache:shiftsummary:${user.organizationId}:${user.id}:${input.date}`),
    ]);

    return result;
  }

  async getSummary(organizationId: string, date: string) {
    const cacheKey = `cache:summary:${organizationId}:${date}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore parsing error */ }
    }

    const employees = await this.getDailyRows(organizationId, date);
    const avgProductivityPercentage = employees.length
      ? Math.round(employees.reduce((sum, row) => sum + row.productivityPercentage, 0) / employees.length)
      : 0;
    const result = { employees, avgProductivityPercentage };
    await this.redis.set(cacheKey, JSON.stringify(result), 10);
    return result;
  }

  async getAttendanceReport(organizationId: string, startDate?: string, endDate?: string) {
    const { start, end } = this.getDateRange(startDate, endDate);
    const dates = this.listDates(start, end);
    if (dates.length === 1) {
      const rows = await this.getDailyRows(organizationId, dates[0]);
      return { rows };
    }
    const rows = await this.getBatchedDailyRows(organizationId, dates);
    return { rows };
  }

  async getProductivityReport(organizationId: string, startDate?: string, endDate?: string) {
    return this.getAttendanceReport(organizationId, startDate, endDate);
  }

  async getShiftSummary(organizationId: string, userId: string, date?: string) {
    const targetDate = date || getShiftDayString();
    this.assertDate(targetDate);
    const cacheKey = `cache:shiftsummary:${organizationId}:${userId}:${targetDate}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new NotFoundException('Employee not found');

    const window = getShiftDayWindow(targetDate);
    const now = new Date();
    const [attendanceRow, idle, breaks] = await Promise.all([
      this.prisma.attendance.findUnique({
        where: { userId_date: { userId, date: targetDate } },
        select: { clockIn: true, clockOut: true },
      }),
      this.prisma.idleTimeLog.findUnique({
        where: { userId_date: { userId, date: targetDate } },
        select: { activeSeconds: true, idleSeconds: true, appFocusSeconds: true, lastIsIdle: true, updatedAt: true },
      }),
      this.prisma.breakSession.findMany({
        where: { userId, startedAt: { gte: window.start, lte: window.end } },
        select: { startedAt: true, endedAt: true, duration: true },
      }),
    ]);

    let breakSecondsSum = 0;
    let isOnBreak = false;
    for (const b of breaks) {
      breakSecondsSum += b.endedAt
        ? b.duration || Math.max(0, Math.floor((b.endedAt.getTime() - b.startedAt.getTime()) / 1000))
        : Math.max(0, Math.floor((now.getTime() - b.startedAt.getTime()) / 1000));
      isOnBreak ||= !b.endedAt;
    }

    const activeSeconds = idle?.activeSeconds || 0;
    const idleSeconds = idle?.idleSeconds || 0;
    const focus = (idle?.appFocusSeconds || {}) as AppFocus;
    const jabberSeconds = this.getAppSeconds(focus, ['jabber', 'ciscojabber', 'ciscocollabhost']);
    const wildixSeconds = this.getAppSeconds(focus, ['wildix', 'x-bees', 'wixphone']);
    const yeastarSeconds = this.getAppSeconds(focus, ['yeastar', 'yeaster', 'linkus']);
    const isCheckedIn = !!attendanceRow?.clockIn && !attendanceRow.clockOut;
    const shiftEnd = attendanceRow?.clockOut || (isCheckedIn ? now : null);
    const elapsedSeconds = attendanceRow?.clockIn && shiftEnd
      ? Math.max(0, Math.floor((shiftEnd.getTime() - attendanceRow.clockIn.getTime()) / 1000)) : 0;
    const scheduledBreakSeconds = attendanceRow?.clockIn && shiftEnd
      ? getScheduledBreakSeconds(targetDate, attendanceRow.clockIn, shiftEnd)
      : 0;
    const breakSeconds = Math.max(breakSecondsSum, scheduledBreakSeconds);
    const shiftDurationSeconds = Math.max(0, elapsedSeconds - breakSeconds);
    const ageSeconds = idle ? Math.max(0, (now.getTime() - idle.updatedAt.getTime()) / 1000) : Infinity;
    const status = !attendanceRow ? 'NOT_CHECKED_IN' : attendanceRow.clockOut ? 'CHECKED_OUT'
      : isOnBreak ? 'ON_BREAK' : !idle || ageSeconds > 240 ? 'AWAY'
        : idle.lastIsIdle ? 'IDLE' : 'ACTIVE';

    const metrics = computeProductivityMetrics({
      activeSeconds,
      idleSeconds,
      jabberSeconds,
      wildixSeconds,
      yeastarSeconds,
      shiftDurationSeconds,
    });

    const result = {
      employeeId: user.id, userId: user.id, employeeName: `${user.firstName} ${user.lastName}`.trim(), email: user.email,
      date: targetDate, checkInAt: attendanceRow?.clockIn || null, checkOutAt: attendanceRow?.clockOut || null,
      stillCheckedIn: isCheckedIn, attendanceStatus: (attendanceRow ? 'PRESENT' : 'ABSENT') as 'PRESENT' | 'ABSENT',
      isCheckedIn,
      isOnBreak: isOnBreak || (targetDate === getShiftDayString(now) && isScheduledBreakTime(now)),
      breakSeconds,
      shiftDurationSeconds,
      activeSeconds, idleSeconds, jabberSeconds, wildixSeconds, yeastarSeconds, cameraActiveSeconds: 0,
      hasActivitySnapshot: !!idle,
      productivityPercentage: metrics.overallProductivityPercentage,
      status, updatedAt: idle?.updatedAt || attendanceRow?.clockIn || null,
      combinedActiveSeconds: activeSeconds,
      attendanceRatio: metrics.attendanceRatio,
      appFocusScore: metrics.appFocusScore,
      complianceScore: metrics.complianceScore,
      complianceBreakdown: {
        idlePenaltyPoints: metrics.idlePenaltyPoints, lateReturnPenaltyPoints: 0, washroomPenaltyPoints: 0,
        idleSeconds, idleThresholdSeconds: 300, lateReturnCount: 0,
        washroomBreakCount: 0, washroomOverLimitCount: 0, washroomOverDurationCount: 0,
      },
      weightsUsed: metrics.weightsUsed,
      inputActiveSeconds: activeSeconds,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 10);
    return result;
  }

  async getSnapshotRange(userId: string, startDate: string, endDate: string) {
    this.assertDate(startDate);
    this.assertDate(endDate);
    return this.prisma.idleTimeLog.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } }, orderBy: { date: 'asc' },
    });
  }

  /** One MongoDB projection shared by Directory, Attendance and Productivity for a single day. */
  private async getDailyRows(organizationId: string, date: string) {
    this.assertDate(date);
    const window = getShiftDayWindow(date);
    const [users, attendance, idleLogs, breaks] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId, role: 'EMPLOYEE', isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true }, orderBy: { firstName: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { organizationId, date },
        select: { userId: true, clockIn: true, clockOut: true },
      }),
      this.prisma.idleTimeLog.findMany({
        where: { organizationId, date },
        select: { userId: true, activeSeconds: true, idleSeconds: true, appFocusSeconds: true, lastIsIdle: true, updatedAt: true },
      }),
      this.prisma.breakSession.findMany({
        where: { organizationId, startedAt: { gte: window.start, lte: window.end } },
        select: { userId: true, startedAt: true, endedAt: true, duration: true },
      }),
    ]);
    const attendanceByUser = new Map(attendance.map((row) => [row.userId, row]));
    const idleByUser = new Map(idleLogs.map((row) => [row.userId, row]));
    const breakByUser = new Map<string, { seconds: number; isOnBreak: boolean }>();
    const now = new Date();
    for (const row of breaks) {
      const current = breakByUser.get(row.userId) || { seconds: 0, isOnBreak: false };
      current.seconds += row.endedAt
        ? row.duration || Math.max(0, Math.floor((row.endedAt.getTime() - row.startedAt.getTime()) / 1000))
        : Math.max(0, Math.floor((now.getTime() - row.startedAt.getTime()) / 1000));
      current.isOnBreak ||= !row.endedAt;
      breakByUser.set(row.userId, current);
    }

    return users.map((user) => {
      const attendanceRow = attendanceByUser.get(user.id);
      const idle = idleByUser.get(user.id);
      const breakState = breakByUser.get(user.id) || { seconds: 0, isOnBreak: false };
      const activeSeconds = idle?.activeSeconds || 0;
      const idleSeconds = idle?.idleSeconds || 0;
      const focus = (idle?.appFocusSeconds || {}) as AppFocus;
      const jabberSeconds = this.getAppSeconds(focus, ['jabber', 'ciscojabber', 'ciscocollabhost']);
      const wildixSeconds = this.getAppSeconds(focus, ['wildix', 'x-bees', 'wixphone']);
      const yeastarSeconds = this.getAppSeconds(focus, ['yeastar', 'yeaster', 'linkus']);
      const isCheckedIn = !!attendanceRow?.clockIn && !attendanceRow.clockOut;
      const shiftEnd = attendanceRow?.clockOut || (isCheckedIn ? now : null);
      const elapsedSeconds = attendanceRow?.clockIn && shiftEnd
        ? Math.max(0, Math.floor((shiftEnd.getTime() - attendanceRow.clockIn.getTime()) / 1000)) : 0;
      const scheduledBreakSeconds = attendanceRow?.clockIn && shiftEnd
        ? getScheduledBreakSeconds(date, attendanceRow.clockIn, shiftEnd)
        : 0;
      const breakSeconds = Math.max(breakState.seconds, scheduledBreakSeconds);
      const shiftDurationSeconds = Math.max(0, elapsedSeconds - breakSeconds);
      const ageSeconds = idle ? Math.max(0, (now.getTime() - idle.updatedAt.getTime()) / 1000) : Infinity;
      const status = !attendanceRow ? 'NOT_CHECKED_IN' : attendanceRow.clockOut ? 'CHECKED_OUT'
        : breakState.isOnBreak ? 'ON_BREAK' : !idle || ageSeconds > 240 ? 'AWAY'
          : idle.lastIsIdle ? 'IDLE' : 'ACTIVE';

      const metrics = computeProductivityMetrics({
        activeSeconds,
        idleSeconds,
        jabberSeconds,
        wildixSeconds,
        yeastarSeconds,
        shiftDurationSeconds,
      });

      return {
        employeeId: user.id, userId: user.id, employeeName: `${user.firstName} ${user.lastName}`.trim(), email: user.email,
        date, checkInAt: attendanceRow?.clockIn || null, checkOutAt: attendanceRow?.clockOut || null,
        stillCheckedIn: isCheckedIn, attendanceStatus: attendanceRow ? 'PRESENT' : 'ABSENT',
        isCheckedIn,
        isOnBreak: breakState.isOnBreak || (date === getShiftDayString(now) && isScheduledBreakTime(now)),
        breakSeconds,
        shiftDurationSeconds,
        activeSeconds, idleSeconds, jabberSeconds, wildixSeconds, yeastarSeconds, cameraActiveSeconds: 0,
        hasActivitySnapshot: !!idle,
        productivityPercentage: metrics.overallProductivityPercentage,
        status, updatedAt: idle?.updatedAt || attendanceRow?.clockIn || null,
      };
    });
  }

  /** Batched fetch across multiple days to eliminate N+1 database roundtrips. */
  private async getBatchedDailyRows(organizationId: string, dates: string[]) {
    const firstWindow = getShiftDayWindow(dates[0]);
    const lastWindow = getShiftDayWindow(dates[dates.length - 1]);
    const windowStart = firstWindow.start < lastWindow.start ? firstWindow.start : lastWindow.start;
    const windowEnd = firstWindow.end > lastWindow.end ? firstWindow.end : lastWindow.end;

    const [users, attendanceList, idleList, breakList] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId, role: 'EMPLOYEE', isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { organizationId, date: { in: dates } },
        select: { userId: true, date: true, clockIn: true, clockOut: true },
      }),
      this.prisma.idleTimeLog.findMany({
        where: { organizationId, date: { in: dates } },
        select: { userId: true, date: true, activeSeconds: true, idleSeconds: true, appFocusSeconds: true, lastIsIdle: true, updatedAt: true },
      }),
      this.prisma.breakSession.findMany({
        where: { organizationId, startedAt: { gte: windowStart, lte: windowEnd } },
        select: { userId: true, startedAt: true, endedAt: true, duration: true },
      }),
    ]);

    const attendanceByDateUser = new Map<string, typeof attendanceList[0]>();
    for (const row of attendanceList) {
      attendanceByDateUser.set(`${row.date}:${row.userId}`, row);
    }

    const idleByDateUser = new Map<string, typeof idleList[0]>();
    for (const row of idleList) {
      idleByDateUser.set(`${row.date}:${row.userId}`, row);
    }

    const dateWindows = new Map(dates.map((d) => [d, getShiftDayWindow(d)]));
    const now = new Date();
    const todayShift = getShiftDayString(now);

    const rows: any[] = [];
    for (const date of dates) {
      const window = dateWindows.get(date)!;
      const breakByUser = new Map<string, { seconds: number; isOnBreak: boolean }>();
      for (const b of breakList) {
        if (b.startedAt >= window.start && b.startedAt <= window.end) {
          const current = breakByUser.get(b.userId) || { seconds: 0, isOnBreak: false };
          current.seconds += b.endedAt
            ? b.duration || Math.max(0, Math.floor((b.endedAt.getTime() - b.startedAt.getTime()) / 1000))
            : Math.max(0, Math.floor((now.getTime() - b.startedAt.getTime()) / 1000));
          current.isOnBreak ||= !b.endedAt;
          breakByUser.set(b.userId, current);
        }
      }

      for (const user of users) {
        const attendanceRow = attendanceByDateUser.get(`${date}:${user.id}`);
        const idle = idleByDateUser.get(`${date}:${user.id}`);
        const breakState = breakByUser.get(user.id) || { seconds: 0, isOnBreak: false };
        const activeSeconds = idle?.activeSeconds || 0;
        const idleSeconds = idle?.idleSeconds || 0;
        const focus = (idle?.appFocusSeconds || {}) as AppFocus;
        const jabberSeconds = this.getAppSeconds(focus, ['jabber', 'ciscojabber', 'ciscocollabhost']);
        const wildixSeconds = this.getAppSeconds(focus, ['wildix', 'x-bees', 'wixphone']);
        const yeastarSeconds = this.getAppSeconds(focus, ['yeastar', 'yeaster', 'linkus']);
        const isCheckedIn = !!attendanceRow?.clockIn && !attendanceRow.clockOut;
        const shiftEnd = attendanceRow?.clockOut || (isCheckedIn ? now : null);
        const elapsedSeconds = attendanceRow?.clockIn && shiftEnd
          ? Math.max(0, Math.floor((shiftEnd.getTime() - attendanceRow.clockIn.getTime()) / 1000)) : 0;
        const scheduledBreakSeconds = attendanceRow?.clockIn && shiftEnd
          ? getScheduledBreakSeconds(date, attendanceRow.clockIn, shiftEnd)
          : 0;
        const breakSeconds = Math.max(breakState.seconds, scheduledBreakSeconds);
        const shiftDurationSeconds = Math.max(0, elapsedSeconds - breakSeconds);
        const ageSeconds = idle ? Math.max(0, (now.getTime() - idle.updatedAt.getTime()) / 1000) : Infinity;
        const status = !attendanceRow ? 'NOT_CHECKED_IN' : attendanceRow.clockOut ? 'CHECKED_OUT'
          : breakState.isOnBreak ? 'ON_BREAK' : !idle || ageSeconds > 240 ? 'AWAY'
            : idle.lastIsIdle ? 'IDLE' : 'ACTIVE';

        const metrics = computeProductivityMetrics({
          activeSeconds,
          idleSeconds,
          jabberSeconds,
          wildixSeconds,
          yeastarSeconds,
          shiftDurationSeconds,
        });

        rows.push({
          employeeId: user.id, userId: user.id, employeeName: `${user.firstName} ${user.lastName}`.trim(), email: user.email,
          date, checkInAt: attendanceRow?.clockIn || null, checkOutAt: attendanceRow?.clockOut || null,
          stillCheckedIn: isCheckedIn, attendanceStatus: attendanceRow ? 'PRESENT' : 'ABSENT',
          isCheckedIn,
          isOnBreak: breakState.isOnBreak || (date === todayShift && isScheduledBreakTime(now)),
          breakSeconds,
          shiftDurationSeconds,
          activeSeconds, idleSeconds, jabberSeconds, wildixSeconds, yeastarSeconds, cameraActiveSeconds: 0,
          hasActivitySnapshot: !!idle,
          productivityPercentage: metrics.overallProductivityPercentage,
          status, updatedAt: idle?.updatedAt || attendanceRow?.clockIn || null,
        });
      }
    }
    return rows;
  }

  private getAppSeconds(focus: AppFocus, names: string[]): number {
    return Object.entries(focus).reduce((sum, [name, seconds]) =>
      names.some((needle) => name.toLowerCase().includes(needle)) ? sum + (Number(seconds) || 0) : sum, 0);
  }

  private getDateRange(startDate?: string, endDate?: string) {
    const start = startDate || getShiftDayString();
    const end = endDate || start;
    this.assertDate(start); this.assertDate(end);
    if (start > end) throw new BadRequestException('startDate must not be after endDate');
    if (this.listDates(start, end).length > 366) throw new BadRequestException('Date range must not exceed 366 days');
    return { start, end };
  }

  private listDates(start: string, end: string): string[] {
    const dates: string[] = [];
    const cursor = new Date(`${start}T00:00:00.000Z`);
    const last = new Date(`${end}T00:00:00.000Z`);
    while (cursor <= last) { dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    return dates;
  }

  private assertDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
      throw new BadRequestException('date must use YYYY-MM-DD format');
    }
  }
}
