import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { TrackingAuthGuard, trackingUserId } from '../common/access/tracking-auth.guard';
import { CATEGORY_LABELS, canViewActivityLog, categoryOf } from '../common/access/access.util';
import { getShiftDayString } from '../common/utils/shift-day.util';
import { cleanEntries, summarize } from './activity-log.util';

const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  designation: true,
  officeCategory: true,
  managerId: true,
} as const;

/**
 * Full-day app/window activity logs.
 *   Upload: the desktop app (own log only).
 *   View:   Admin/Boss - everyone; SM - Team Leads & Closers; Team Lead - own agents.
 */
@ApiTags('Activity Log')
@Controller('activity-log')
export class ActivityLogController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Desktop app uploads app/window segments (names and times only)' })
  @UseGuards(TrackingAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('batch')
  async upload(@Req() req: any, @Body() body: { userId?: string; entries?: unknown[] }) {
    const userId = trackingUserId(req, body?.userId);
    if (!/^[a-f0-9]{24}$/i.test(userId)) throw new BadRequestException('Unknown user');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
    if (!user) throw new NotFoundException('User not found');

    const entries = cleanEntries(body?.entries);
    if (entries.length === 0) return { stored: 0 };
    // Re-sent entries (offline retry) are ignored by their id.
    const existing = await this.prisma.applicationUsage.findMany({
      where: { eventId: { in: entries.map((e) => e.eventId) } },
      select: { eventId: true },
    });
    const seen = new Set(existing.map((e) => e.eventId));
    const fresh = entries.filter((e) => !seen.has(e.eventId));
    if (fresh.length) {
      await this.prisma.applicationUsage.createMany({
        data: fresh.map((e) => ({ ...e, organizationId: user.organizationId, userId: user.id })),
      });
    }
    return { stored: fresh.length, duplicates: entries.length - fresh.length };
  }

  @ApiOperation({ summary: 'People whose activity log you may view' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('activityLogs.view')
  @Get('people')
  async people(@Req() req: any) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: req.user.organizationId, isActive: true },
      select: PERSON_SELECT,
      orderBy: { firstName: 'asc' },
    });
    return users
      .filter((u) => u.id !== req.user.id && canViewActivityLog(req.user, u))
      .map((u) => {
        const category = categoryOf(u);
        return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, category, categoryLabel: CATEGORY_LABELS[category] };
      });
  }

  @ApiOperation({ summary: "One person's full-day app/window log (Karachi calendar day)" })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('activityLogs.view')
  @Get()
  async view(@Req() req: any, @Query('userId') userId: string, @Query('date') date?: string) {
    const day = date || getShiftDayString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException('date must be YYYY-MM-DD');
    const target = /^[a-f0-9]{24}$/i.test(userId || '')
      ? await this.prisma.user.findFirst({ where: { id: userId, organizationId: req.user.organizationId }, select: PERSON_SELECT })
      : null;
    if (!target) throw new NotFoundException('Person not found');
    if (!canViewActivityLog(req.user, target)) throw new ForbiddenException("You don't have access to this person's activity");

    const start = new Date(`${day}T00:00:00.000+05:00`);
    const end = new Date(`${day}T23:59:59.999+05:00`);
    const entries = await this.prisma.applicationUsage.findMany({
      where: { userId: target.id, startedAt: { gte: start, lte: end }, eventId: { startsWith: 'actlog-' } },
      select: { applicationName: true, windowTitle: true, startedAt: true, endedAt: true, duration: true, category: true },
      orderBy: { startedAt: 'asc' },
      take: 5000,
    });
    const category = categoryOf(target);
    return {
      person: { id: target.id, name: `${target.firstName} ${target.lastName}`.trim(), category, categoryLabel: CATEGORY_LABELS[category] },
      date: day,
      summary: summarize(entries),
      entries,
    };
  }
}
