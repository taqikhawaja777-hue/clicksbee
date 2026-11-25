import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { TrackingService, IdleSnapshotInput } from './tracking.service';
import { IdleAlertsService, IdleEvent } from './idle-alerts.service';
import { getShiftDayString } from '../common/utils/shift-day.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { TrackingAuthGuard, trackingUserId } from '../common/access/tracking-auth.guard';
import { AGENT_CATEGORIES, can, canViewProductivityOf, categoryOf, redactRow } from '../common/access/access.util';

export class IdleEventDto {
  @ApiProperty({ enum: ['IDLE_STARTED', 'IDLE_ENDED', 'NO_CALL_GAP', 'SUSPICIOUS_ACTIVITY'] })
  @IsIn(['IDLE_STARTED', 'IDLE_ENDED', 'NO_CALL_GAP', 'SUSPICIOUS_ACTIVITY'])
  event: IdleEvent;

  @ApiProperty({ description: 'Start of the episode: last input (idle), last call end (no call), detection time (suspicious)' })
  @IsISO8601()
  idleSince: string;

  @ApiPropertyOptional({ description: 'IDLE_ENDED only - when activity resumed' })
  @IsISO8601()
  @IsOptional()
  endedAt?: string;

  @ApiPropertyOptional({ description: 'SUSPICIOUS_ACTIVITY only - what pattern was detected' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  reason?: string;
}

export class ActivityConfigDto {
  @ApiPropertyOptional({ type: [String], nullable: true, description: 'Words matched against the window title/app; null = built-in defaults' })
  @IsOptional()
  @IsArray()
  unproductiveKeywords?: string[] | null;

  @ApiPropertyOptional({ description: 'Team Lead alert when an agent is idle this many minutes (default 10)' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(240)
  teamIdleAlertMinutes?: number;

  @ApiPropertyOptional({ description: 'Admin is notified when an employee uses spreadsheets longer than this per shift (default 60)' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(540)
  spreadsheetLimitMinutes?: number;
}

/**
 * Activity data. Who sees what (access.util.ts):
 *   productivity / idle  - Admin & SM (agents), Team Lead (own agents), self.
 *   dialer timings       - Admin & SM only (stripped from everyone else's rows).
 *   attendance report    - Admin, HR (without dialer/productivity), SM.
 */
@ApiTags('MongoDB Activity Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly idleAlertsService: IdleAlertsService,
  ) {}

  /** Rows the viewer may see, with fields they may not see removed. */
  private scopeRows<T extends { category?: string; teamLeadId?: string | null }>(viewer: any, rows: T[]): T[] {
    let visible = rows;
    const category = categoryOf(viewer);
    if (category === 'SM') visible = rows.filter((r) => AGENT_CATEGORIES.includes(r.category as any));
    else if (category === 'TEAM_LEAD') visible = rows.filter((r) => r.teamLeadId === viewer.id);
    return visible.map((r) =>
      redactRow(r as any, {
        dialer: can(viewer, 'dialer.reports'),
        productivity: can(viewer, 'productivity.all') || can(viewer, 'productivity.team'),
      }),
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('camera-config')
  @ApiOperation({ summary: 'Get camera monitoring configuration' })
  getCameraConfig() {
    return this.trackingService.getCameraConfig();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('org.settings')
  @Post('camera-config')
  @ApiOperation({ summary: 'Update camera monitoring configuration (Admin/Boss)' })
  updateCameraConfig(@Body() body: any) {
    return this.trackingService.updateCameraConfig(body);
  }

  @UseGuards(TrackingAuthGuard)
  @Post('idle-snapshots')
  @ApiOperation({ summary: 'Upsert a desktop activity snapshot (the signed-in user only)' })
  upsertIdleSnapshot(@Req() req: any, @Body() body: IdleSnapshotInput) {
    return this.trackingService.upsertIdleSnapshot({ ...body, userId: trackingUserId(req, body?.userId) });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('idle-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desktop app reports the signed-in user went idle (2+ min) or came back - creates the idle alert + log entry' })
  recordIdleEvent(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: IdleEventDto,
  ) {
    return this.idleAlertsService.recordIdleEvent(userId, organizationId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('activity-config')
  @ApiOperation({ summary: "Organization's unproductive apps/sites list and Team Lead idle limit" })
  getActivityConfig(@CurrentUser('organizationId') organizationId: string) {
    return this.trackingService.getActivityConfig(organizationId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('org.settings')
  @Put('activity-config')
  @ApiOperation({ summary: 'Save the unproductive apps/sites list (null resets) and/or the Team Lead idle limit (Admin/Boss)' })
  setActivityConfig(@CurrentUser('organizationId') organizationId: string, @Body() dto: ActivityConfigDto) {
    return this.trackingService.setActivityConfig(organizationId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('idle-snapshots')
  @ApiOperation({ summary: 'Activity snapshots for one person and date range (self, or someone whose productivity you may view)' })
  async getIdleSnapshots(
    @Req() req: any,
    @Query('employeeId') employeeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const targetId = employeeId || req.user.id;
    if (targetId !== req.user.id) {
      const target = await this.trackingService.getAccessTarget(req.user.organizationId, targetId);
      if (!target || !canViewProductivityOf(req.user, target)) throw new ForbiddenException('No access to this person');
    }
    return this.trackingService.getSnapshotRange(targetId, startDate, endDate);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('productivity.all', 'productivity.team')
  @Get('idle-summary')
  @ApiOperation({ summary: 'Live agent activity summary (Admin & SM: agents; Team Lead: own agents)' })
  async getIdleSummary(@Req() req: any, @Query('date') date?: string) {
    const summary = await this.trackingService.getSummary(req.user.organizationId, date || getShiftDayString());
    const employees = this.scopeRows(req.user, summary.employees);
    const avgProductivityPercentage = employees.length
      ? Math.round(employees.reduce((s: number, r: any) => s + (r.productivityPercentage || 0), 0) / employees.length)
      : 0;
    const { spreadsheetLimitMinutes } = await this.trackingService.getActivityConfig(req.user.organizationId);
    return { employees, avgProductivityPercentage, spreadsheetLimitMinutes };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('attendance-report')
  @ApiOperation({ summary: 'Attendance report rows (Admin, HR, SM: everyone in scope; others: only their own)' })
  async getAttendanceReport(@Req() req: any, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const { rows } = await this.trackingService.getAttendanceReport(req.user.organizationId, startDate, endDate);
    // The employee's own dashboard (hours chart, attendance stats) reads its own rows here.
    if (!can(req.user, 'attendance.reports')) return { rows: rows.filter((r) => r.employeeId === req.user.id) };
    return { rows: this.scopeRows(req.user, rows) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('dialer.reports')
  @Get('productivity-report')
  @ApiOperation({ summary: 'Productivity + dialer report rows (Admin & SM)' })
  async getProductivityReport(@Req() req: any, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const { rows } = await this.trackingService.getProductivityReport(req.user.organizationId, startDate, endDate);
    const { spreadsheetLimitMinutes } = await this.trackingService.getActivityConfig(req.user.organizationId);
    return { rows: this.scopeRows(req.user, rows), spreadsheetLimitMinutes };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('shift-summary/:employeeId')
  @ApiOperation({ summary: 'Shift summary: your own, or someone whose productivity you may view' })
  async getShiftSummary(@Req() req: any, @Param('employeeId') employeeId: string, @Query('date') date?: string) {
    const viewer = req.user;
    const targetId = employeeId || viewer.id;
    if (targetId === viewer.id) {
      return this.trackingService.getShiftSummary(viewer.organizationId, targetId, date);
    }
    const target = await this.trackingService.getAccessTarget(viewer.organizationId, targetId);
    if (!target || !canViewProductivityOf(viewer, target)) throw new ForbiddenException('No access to this person');
    const summary = await this.trackingService.getShiftSummary(viewer.organizationId, targetId, date);
    return redactRow(summary as any, { dialer: can(viewer, 'dialer.reports'), productivity: true });
  }
}
