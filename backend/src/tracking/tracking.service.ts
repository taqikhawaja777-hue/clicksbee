import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getScheduledBreakSeconds, getShiftDayString, getShiftDayWindow, isScheduledBreakTime, isWithinShift } from '../common/utils/shift-day.util';

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
    if (input.date !== getShiftDayString()) {
      throw new BadRequestException('Activity snapshot date must match the current Karachi calendar date');
    }
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new NotFoundException('Employee not found');
    const cleanSeconds = (value: number) => Math.max(0, Math.round(Number(value) || 0));
    // Do not accept a client writing activity outside work hours or during
    // the two organization-wide scheduled breaks. Rejecting (rather than
    // overwriting) preserves the valid cumulative totals already stored.
    if (!isWithinShift() || isScheduledBreakTime()) {
      throw new BadRequestException('Activity snapshots are accepted only during working time outside scheduled breaks');
    }

    return this.prisma.idleTimeLog.upsert({
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
  }

  async getSummary(organizationId: string, date: string) {
    const employees = await this.getDailyRows(organizationId, date);
    const avgProductivityPercentage = employees.length
      ? Math.round(employees.reduce((sum, row) => sum + row.productivityPercentage, 0) / employees.length)
      : 0;
    return { employees, avgProductivityPercentage };
  }

  async getAttendanceReport(organizationId: string, startDate?: string, endDate?: string) {
    const { start, end } = this.getDateRange(startDate, endDate);
    const rows = (await Promise.all(this.listDates(start, end).map((date) => this.getDailyRows(organizationId, date)))).flat();
    return { rows };
  }

  async getProductivityReport(organizationId: string, startDate?: string, endDate?: string) {
    return this.getAttendanceReport(organizationId, startDate, endDate);
  }

  async getShiftSummary(organizationId: string, userId: string, date?: string) {
    const targetDate = date || getShiftDayString();
    this.assertDate(targetDate);
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
    if (!user) throw new NotFoundException('Employee not found');
    const row = (await this.getDailyRows(organizationId, targetDate)).find((candidate) => candidate.employeeId === userId);
    if (!row) throw new NotFoundException('Employee not found');

    const dialerSeconds = row.jabberSeconds + row.wildixSeconds + row.yeastarSeconds;
    const attendanceRatio = row.shiftDurationSeconds ? Math.round((row.activeSeconds / row.shiftDurationSeconds) * 100) : 0;
    const appFocusScore = row.activeSeconds ? Math.round((dialerSeconds / row.activeSeconds) * 100) : 0;
    const idlePenaltyPoints = Math.min(100, Math.round(Math.max(0, row.idleSeconds - 300) / 60));
    const complianceScore = Math.max(0, 100 - idlePenaltyPoints);

    // Overall Productivity formula: 70% App Focus + 15% Compliance + 15% Attendance
    const productivityPercentage = (row.activeSeconds > 0 || row.shiftDurationSeconds > 0)
      ? Math.round(appFocusScore * 0.70 + complianceScore * 0.15 + attendanceRatio * 0.15)
      : 0;

    return {
      ...row,
      productivityPercentage,
      combinedActiveSeconds: row.activeSeconds,
      attendanceRatio,
      appFocusScore,
      complianceScore,
      complianceBreakdown: {
        idlePenaltyPoints, lateReturnPenaltyPoints: 0, washroomPenaltyPoints: 0,
        idleSeconds: row.idleSeconds, idleThresholdSeconds: 300, lateReturnCount: 0,
        washroomBreakCount: 0, washroomOverLimitCount: 0, washroomOverDurationCount: 0,
      },
      weightsUsed: { attendanceWeight: 15, appFocusWeight: 70, complianceWeight: 15, callEfficiencyWeight: 0 },
      cameraActiveSeconds: 0,
      inputActiveSeconds: row.activeSeconds,
    };
  }

  async getSnapshotRange(userId: string, startDate: string, endDate: string) {
    this.assertDate(startDate);
    this.assertDate(endDate);
    return this.prisma.idleTimeLog.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } }, orderBy: { date: 'asc' },
    });
  }

  /** One MongoDB projection shared by Directory, Attendance and Productivity. */
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
      const jabberSeconds = this.getAppSeconds(focus, ['jabber']);
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
      const dialerSeconds = jabberSeconds + wildixSeconds + yeastarSeconds;
      const attendanceRatio = shiftDurationSeconds ? Math.round((activeSeconds / shiftDurationSeconds) * 100) : 0;
      const appFocusScore = activeSeconds ? Math.round((dialerSeconds / activeSeconds) * 100) : 0;
      const idlePenaltyPoints = Math.min(100, Math.round(Math.max(0, idleSeconds - 300) / 60));
      const complianceScore = Math.max(0, 100 - idlePenaltyPoints);
      // Overall Productivity formula: 70% App Focus + 15% Compliance + 15% Attendance
      const productivityPercentage = (activeSeconds > 0 || shiftDurationSeconds > 0)
        ? Math.round(appFocusScore * 0.70 + complianceScore * 0.15 + attendanceRatio * 0.15)
        : 0;

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
        productivityPercentage,
        status, updatedAt: idle?.updatedAt || attendanceRow?.clockIn || null,
      };
    });
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
