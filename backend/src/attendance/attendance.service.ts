import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClockInDto } from './dto/clock-in.dto';
import { AttendanceStatus } from '@prisma/client';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  private getTodayString(): string {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  async clockIn(userId: string, organizationId: string, dto: ClockInDto) {
    const dateStr = this.getTodayString();

    const existing = await this.prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: dateStr,
        },
      },
    });

    if (existing && existing.clockIn && !existing.clockOut) {
      throw new ConflictException('Already clocked in for today');
    }

    if (existing && existing.clockOut) {
      return this.prisma.attendance.update({
        where: { id: existing.id },
        data: {
          clockOut: null,
          status: AttendanceStatus.PRESENT,
        },
      });
    }

    return this.prisma.attendance.create({
      data: {
        organizationId,
        userId,
        deviceId: dto.deviceId,
        date: dateStr,
        clockIn: new Date(),
        status: AttendanceStatus.PRESENT,
      },
    });
  }

  async clockOut(userId: string, organizationId: string) {
    const dateStr = this.getTodayString();

    const existing = await this.prisma.attendance.findUnique({
      where: {
        userId_date: {
          userId,
          date: dateStr,
        },
      },
    });

    if (!existing || !existing.clockIn) {
      throw new NotFoundException('No active clock-in session found for today');
    }

    const clockOut = new Date();
    const totalWorkDuration = Math.floor(
      (clockOut.getTime() - existing.clockIn.getTime()) / 1000,
    );

    const standardWorkSeconds = 8 * 3600;
    const overtimeDuration = Math.max(0, totalWorkDuration - standardWorkSeconds);

    const breaks = await this.prisma.breakSession.findMany({
      where: {
        userId,
        organizationId,
        startedAt: { gte: existing.clockIn },
      },
    });
    const breakDuration = breaks.reduce((acc, b) => acc + (b.duration || 0), 0);

    const idles = await this.prisma.activityEvent.findMany({
      where: {
        userId,
        organizationId,
        type: 'IDLE_ENDED',
        timestamp: { gte: existing.clockIn },
      },
    });
    const idleDuration = idles.reduce((acc, i) => {
      const meta = i.metadata as any;
      return acc + (meta?.idleDuration || 0);
    }, 0);

    const productiveDuration = Math.max(
      0,
      totalWorkDuration - breakDuration - idleDuration,
    );

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockOut,
        totalWorkDuration,
        productiveDuration,
        idleDuration,
        breakDuration,
        overtimeDuration,
      },
    });
  }

  private enrichAttendanceRecord(record: any) {
    const now = new Date();
    let durationSeconds = record.totalWorkDuration || 0;
    
    // If clocked in & shift active (not clocked out), compute live real-time elapsed duration
    if (record.clockIn && !record.clockOut) {
      durationSeconds = Math.max(0, Math.floor((now.getTime() - new Date(record.clockIn).getTime()) / 1000));
    }

    const hrs = Math.floor(durationSeconds / 3600);
    const mins = Math.floor((durationSeconds % 3600) / 60);
    const secs = durationSeconds % 60;
    const formattedHours = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    const displayHours = `${hrs}h ${mins}m ${secs}s`;

    return {
      ...record,
      status: AttendanceStatus.PRESENT,
      totalWorkDuration: durationSeconds,
      formattedHours,
      displayHours,
    };
  }

  async getMyAttendance(userId: string, organizationId: string) {
    const records = await this.prisma.attendance.findMany({
      where: { userId, organizationId },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return records.map((r) => this.enrichAttendanceRecord(r));
  }

  async getUserAttendance(
    targetUserId: string,
    reqUserId: string,
    organizationId: string,
    role: string,
  ) {
    if (role === 'EMPLOYEE' && targetUserId !== reqUserId) {
      throw new ForbiddenException('Access denied to other user attendance records');
    }

    const records = await this.prisma.attendance.findMany({
      where: { userId: targetUserId, organizationId },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return records.map((r) => this.enrichAttendanceRecord(r));
  }

  async getAllAttendance(organizationId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { organizationId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, role: true },
          },
        },
        orderBy: { clockIn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendance.count({ where: { organizationId } }),
    ]);

    const enriched = data.map((r) => this.enrichAttendanceRecord(r));

    return {
      data: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDailySummary(organizationId: string, dateStr?: string) {
    const targetDate = dateStr || this.getTodayString();
    const records = await this.prisma.attendance.findMany({
      where: { organizationId, date: targetDate },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    const enriched = records.map((r) => this.enrichAttendanceRecord(r));
    const presentCount = enriched.filter((r) => r.status === 'PRESENT').length;
    const totalUsers = await this.prisma.user.count({ where: { organizationId, isActive: true } });

    return {
      date: targetDate,
      totalUsers,
      presentCount,
      absentCount: Math.max(0, totalUsers - presentCount),
      records: enriched,
    };
  }

  async getWeeklySummary(organizationId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    return this.prisma.attendance.findMany({
      where: {
        organizationId,
        clockIn: { gte: sevenDaysAgo },
      },
      orderBy: { clockIn: 'asc' },
    });
  }

  async getMonthlySummary(organizationId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    return this.prisma.attendance.findMany({
      where: {
        organizationId,
        clockIn: { gte: thirtyDaysAgo },
      },
      orderBy: { clockIn: 'asc' },
    });
  }
}
