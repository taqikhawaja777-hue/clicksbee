import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
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

  async createEmployee(organizationId: string, dto: CreateEmployeeDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        organizationId,
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

  async getEmployeeById(id: string, organizationId: string) {
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
        avatar: true,
        isActive: true,
        lastLoginAt: true,
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        createdAt: true,
      },
    });

    if (!user || user.organizationId !== organizationId) {
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

  async updateEmployee(id: string, organizationId: string, dto: UpdateEmployeeDto) {
    await this.getEmployeeById(id, organizationId);

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
    });

    const { passwordHash: _, ...result } = updated;
    return result;
  }

  async deleteEmployee(id: string, organizationId: string) {
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
        avatar: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
        workSessions: {
          take: 1,
          orderBy: { startedAt: 'desc' },
        },
        attendance: {
          take: 1,
          orderBy: { clockIn: 'desc' },
        },
        breakSessions: {
          take: 1,
          orderBy: { startedAt: 'desc' },
        },
        screenshots: {
          take: 1,
          orderBy: { capturedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const registeredEmployees = users.map((u) => {
      const latestAttendance = u.attendance?.[0];
      const latestSession = u.workSessions?.[0];
      const latestBreak = u.breakSessions?.[0];
      const latestScreenshot = u.screenshots?.[0];

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

    const dateStr = new Date().toISOString().split('T')[0];
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

    const dateStr = new Date().toISOString().split('T')[0];
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
}
