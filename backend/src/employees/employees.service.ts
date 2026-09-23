import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { getShiftDayString } from '../common/utils/shift-day.util';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    try {
      return await argon2.hash(password);
    } catch {
      return await bcrypt.hash(password, 10);
    }
  }

  async createEmployee(organizationId: string | undefined, dto: CreateEmployeeDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    // Unlike getEmployeeById/update/delete (which can just skip an
    // ownership check when unauthenticated), creating a user always needs
    // a real organizationId - it's a required field. This controller has
    // no auth guard, so req.user (and therefore organizationId) is never
    // populated in practice; falling back to the app's one real
    // organization instead of a hardcoded placeholder string that matches
    // nothing keeps this working the same way registration already does.
    const resolvedOrgId = organizationId || (await this.prisma.organization.findFirst())?.id;
    if (!resolvedOrgId) {
      throw new NotFoundException('No organization exists to assign this employee to');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        organizationId: resolvedOrgId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        passwordHash,
        role: dto.role || 'EMPLOYEE',
        departmentId: dto.departmentId,
        teamId: dto.teamId,
        managerId: dto.managerId,
        employeeCode: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      },
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async getEmployees(
    organizationId: string,
    search?: string,
    departmentId?: string,
    teamId?: string,
    page = 1,
    limit = 20,
  ) {
    const where: any = { organizationId };

    if (departmentId) where.departmentId = departmentId;
    if (teamId) where.teamId = teamId;

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          employeeCode: true,
          designation: true,
          avatar: true,
          isActive: true,
          lastLoginAt: true,
          department: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { firstName: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const enriched = await Promise.all(
      users.map(async (u) => {
        const rawStatus = await this.redis.get(`user:status:${u.id}`);
        const parsedStatus = rawStatus ? JSON.parse(rawStatus) : { status: 'OFFLINE' };
        return {
          ...u,
          name: `${u.firstName} ${u.lastName}`,
          currentStatus: parsedStatus.status || 'OFFLINE',
          lastSeen: u.lastLoginAt,
          productivity: 85,
        };
      }),
    );

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

  async getEmployeeById(id: string, organizationId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        employeeCode: true,
        designation: true,
        avatar: true,
        isActive: true,
        lastLoginAt: true,
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        createdAt: true,
      },
    });

    // organizationId is only provided when a real auth guard populated
    // req.user - this controller has none today, so it's always undefined
    // in practice. Skip the ownership check rather than compare against a
    // value that was never real to begin with.
    if (!user || (organizationId && user.organizationId !== organizationId)) {
      throw new NotFoundException('Employee not found');
    }

    const rawStatus = await this.redis.get(`user:status:${user.id}`);
    const parsedStatus = rawStatus ? JSON.parse(rawStatus) : { status: 'OFFLINE' };

    return {
      ...user,
      name: `${user.firstName} ${user.lastName}`,
      currentStatus: parsedStatus.status || 'OFFLINE',
      productivity: 85,
    };
  }

  async updateEmployee(id: string, organizationId: string | undefined, dto: UpdateEmployeeDto) {
    // Use this employee's own real organizationId for the department
    // lookup below, not the (usually undefined, since this controller has
    // no auth guard) parameter - that parameter is only ever used for the
    // ownership check inside getEmployeeById.
    const existing = await this.getEmployeeById(id, organizationId);

    const { departmentName, ...rest } = dto;
    const data: typeof rest & { departmentId?: string } = { ...rest };

    // Same find-or-create-by-name pattern as registration - lets the
    // Employee Directory's edit modal send a plain department name rather
    // than needing to know a real Department id (there's still no
    // separate department-management UI/endpoint).
    if (departmentName?.trim()) {
      const department = await this.prisma.department.upsert({
        where: { organizationId_name: { organizationId: existing.organizationId, name: departmentName.trim() } },
        update: {},
        create: { organizationId: existing.organizationId, name: departmentName.trim() },
      });
      data.departmentId = department.id;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
    });

    const { passwordHash: _, ...result } = updated;
    return result;
  }

  async deleteEmployee(id: string, organizationId?: string) {
    await this.getEmployeeById(id, organizationId);
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Employee deleted successfully' };
  }

  /**
   * Fetch all registered employees directly from MongoDB User collection with dynamic Check-In and Online/Offline status
   */
  async getAllRegisteredEmployees() {
    const users = await this.prisma.user.findMany({
      where: { role: 'EMPLOYEE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        employeeCode: true,
        designation: true,
        avatar: true,
        isActive: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const userIds = users.map((u) => u.id);

    // Was one Prisma call with 4 nested to-many relations (each `take: 1,
    // orderBy: ...`) - measured directly against this app's real database:
    // 1.6-3.2s, because MongoDB has no native "top-1-per-group", so
    // Prisma's query engine resolves that shape as one full round trip
    // per relation, run one after another, each pulling every field of
    // every matching row before throwing away all but the newest (one
    // real org's screenshots alone: 730 rows fetched to keep 15 - measured
    // at ~990ms just for that one relation). Fetching all 4 relations
    // concurrently instead of nested, with `select` limited to only the
    // fields the logic below actually reads, cut the same real query to
    // ~400-500ms once the connection pool is warm (see PrismaService).
    const [workSessions, attendance, breakSessions, screenshots] = await Promise.all([
      this.prisma.workSession.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, startedAt: true, endedAt: true },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.attendance.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, clockIn: true, clockOut: true },
        orderBy: { clockIn: 'desc' },
      }),
      this.prisma.breakSession.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, startedAt: true, endedAt: true },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.screenshot.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, capturedAt: true },
        orderBy: { capturedAt: 'desc' },
      }),
    ]);

    // Each list is already sorted newest-first, so the first row seen per
    // userId is that user's latest - equivalent to the old take:1-per-user
    // nested shape, computed in memory instead of one query per user.
    const latestPerUser = <T extends { userId: string }>(rows: T[]): Map<string, T> => {
      const map = new Map<string, T>();
      for (const row of rows) {
        if (!map.has(row.userId)) map.set(row.userId, row);
      }
      return map;
    };
    const latestSessionByUser = latestPerUser(workSessions);
    const latestAttendanceByUser = latestPerUser(attendance);
    const latestBreakByUser = latestPerUser(breakSessions);
    const latestScreenshotByUser = latestPerUser(screenshots);

    const registeredEmployees = users.map((u) => {
      const latestAttendance = latestAttendanceByUser.get(u.id);
      const latestSession = latestSessionByUser.get(u.id);
      const latestBreak = latestBreakByUser.get(u.id);
      const latestScreenshot = latestScreenshotByUser.get(u.id);

      // Dynamic Check-In & Active status evaluation
      const hasActiveAttendance = latestAttendance && !latestAttendance.clockOut;
      const hasActiveSession = latestSession && !latestSession.endedAt;
      const isRecentlyActive = latestScreenshot &&
        (new Date().getTime() - new Date(latestScreenshot.capturedAt).getTime()) < 30 * 60 * 1000;

      const isOnBreak = latestBreak && !latestBreak.endedAt;

      let status = 'INACTIVE';
      if (isOnBreak) {
        status = 'BREAK';
      } else if (hasActiveAttendance || hasActiveSession || isRecentlyActive) {
        status = 'ACTIVE';
      }

      // Extract real formatted Check-In timestamp
      const checkInDate = latestAttendance?.clockIn || latestSession?.startedAt || (isRecentlyActive ? latestScreenshot?.capturedAt : null);
      const checkInStr = checkInDate
        ? new Date(checkInDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '--';

      const initials = `${u.firstName?.[0] || 'E'}${u.lastName?.[0] || 'E'}`.toUpperCase();

      return {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim() || 'Registered Employee',
        email: u.email,
        role: u.role || 'EMPLOYEE',
        department: u.department?.name || 'Engineering',
        avatar: u.avatar || initials,
        // Resignation is a separate axis from moment-to-moment activity -
        // a resigned employee's real-time online/break/offline state is
        // moot, so this is surfaced independently rather than folded into
        // `status` as a 4th value every existing consumer would need to
        // handle.
        isActive: u.isActive,
        status: status, // 'ACTIVE' (Online), 'BREAK' (Break), 'INACTIVE' (Offline)
        checkIn: checkInStr,
        productivity: 95,
        createdAt: u.createdAt,
      };
    });

    return {
      totalCount: registeredEmployees.length,
      activeCount: registeredEmployees.filter((e) => e.status === 'ACTIVE').length,
      data: registeredEmployees,
    };
  }

  /**
   * Check in employee directly by ID (updates Attendance & WorkSession in MongoDB)
   */
  async checkInEmployee(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Employee not found');
    }

    const dateStr = getShiftDayString();
    const now = new Date();

    // 1. Create or update Attendance record
    const attendance = await this.prisma.attendance.upsert({
      where: {
        userId_date: {
          userId: user.id,
          date: dateStr,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        date: dateStr,
        clockIn: now,
        status: 'PRESENT',
      },
      update: {
        clockOut: null,
        status: 'PRESENT',
      },
    });

    // 2. Create active WorkSession record if none is running
    const activeSession = await this.prisma.workSession.findFirst({
      where: { userId: user.id, endedAt: null },
    });

    if (!activeSession) {
      await this.prisma.workSession.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          startedAt: now,
          status: 'ACTIVE',
        },
      });
    }

    return { success: true, message: `${user.firstName} ${user.lastName} checked in successfully`, attendance };
  }

  /**
   * Check out employee directly by ID
   */
  async checkOutEmployee(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Employee not found');
    }

    const dateStr = getShiftDayString();
    const now = new Date();

    // Update Attendance
    await this.prisma.attendance.updateMany({
      where: { userId: user.id, date: dateStr },
      data: { clockOut: now },
    });

    // End active WorkSessions
    await this.prisma.workSession.updateMany({
      where: { userId: user.id, endedAt: null },
      data: { endedAt: now, status: 'COMPLETED' },
    });

    return { success: true, message: `${user.firstName} ${user.lastName} checked out successfully` };
  }

  /**
   * Auto-checks-out anyone whose WorkSession is still open when the shift
   * ends (19:00 Asia/Karachi) - forgetting to check out (or a crashed/
   * offline client that never got the chance) would otherwise leave that
   * session open forever, corrupting every attendance/hours calculation
   * that reads it. Mirrors productivity_service's equivalent job
   * (auto_checkout.py, same 19:00 Asia/Karachi trigger) on the Supabase/
   * shift_events side - both run independently, each closing out its own
   * database's still-open sessions, same pattern as check-in/check-out
   * already being dual-written from the frontend on every real action.
   * Not org-scoped, same as checkOutEmployee() itself and every other
   * shift-boundary assumption in this app (see shift-day.util.ts) - there
   * is currently only one global fixed shift, not a per-org one.
   */
  @Cron('0 19 * * *', { timeZone: 'Asia/Karachi' })
  async autoCheckoutAtShiftEnd() {
    const openSessions = await this.prisma.workSession.findMany({
      where: { endedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });

    for (const { userId } of openSessions) {
      try {
        await this.checkOutEmployee(userId);
      } catch (e) {
        console.error(`[EmployeesService] Auto-checkout failed for user ${userId}:`, e);
      }
    }

    if (openSessions.length > 0) {
      console.log(`[EmployeesService] Auto-checkout at shift end: checked out ${openSessions.length} employee(s).`);
    }
  }
}
