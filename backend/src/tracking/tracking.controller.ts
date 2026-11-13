import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { Role } from '@prisma/client';
import { TrackingService, IdleSnapshotInput } from './tracking.service';
import { IdleAlertsService, IdleEvent } from './idle-alerts.service';
import { getShiftDayString } from '../common/utils/shift-day.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class IdleEventDto {
  @ApiProperty({ enum: ['IDLE_STARTED', 'IDLE_ENDED'] })
  @IsIn(['IDLE_STARTED', 'IDLE_ENDED'])
  event: IdleEvent;

  @ApiProperty({ description: 'When the last mouse/keyboard input happened' })
  @IsISO8601()
  idleSince: string;

  @ApiPropertyOptional({ description: 'IDLE_ENDED only - when activity resumed' })
  @IsISO8601()
  @IsOptional()
  endedAt?: string;
}

@ApiTags('MongoDB Activity Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly idleAlertsService: IdleAlertsService,
  ) {}

  // Electron submits a snapshot before a renderer can necessarily refresh a
  // JWT. Reads intended for the portals below remain authenticated.
  @Get('camera-config')
  @ApiOperation({ summary: 'Get camera monitoring configuration' })
  getCameraConfig() {
    return this.trackingService.getCameraConfig();
  }

  @Post('camera-config')
  @ApiOperation({ summary: 'Update camera monitoring configuration' })
  updateCameraConfig(@Body() body: any) {
    return this.trackingService.updateCameraConfig(body);
  }

  @Post('idle-snapshots')
  @ApiOperation({ summary: 'Upsert a desktop activity snapshot in MongoDB' })
  upsertIdleSnapshot(@Body() body: IdleSnapshotInput) {
    return this.trackingService.upsertIdleSnapshot(body);
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

  @Get('idle-snapshots')
  @ApiOperation({ summary: 'Read MongoDB activity snapshots for one employee and date range' })
  getIdleSnapshots(
    @Query('employeeId') employeeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.trackingService.getSnapshotRange(employeeId, startDate, endDate);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('idle-summary')
  @ApiOperation({ summary: 'Get live employee activity summary from MongoDB' })
  getIdleSummary(@CurrentUser('organizationId') organizationId: string, @Query('date') date?: string) {
    return this.trackingService.getSummary(organizationId, date || getShiftDayString());
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('attendance-report')
  @ApiOperation({ summary: 'Get attendance report rows from MongoDB' })
  getAttendanceReport(
    @CurrentUser('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.trackingService.getAttendanceReport(organizationId, startDate, endDate);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('productivity-report')
  @ApiOperation({ summary: 'Get productivity report rows from MongoDB' })
  getProductivityReport(
    @CurrentUser('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.trackingService.getProductivityReport(organizationId, startDate, endDate);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('shift-summary/:employeeId')
  @ApiOperation({ summary: 'Get an employee shift summary from MongoDB' })
  getShiftSummary(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') role: Role,
    @Param('employeeId') employeeId: string,
    @Query('date') date?: string,
  ) {
    const targetId = role === Role.EMPLOYEE ? requesterId : employeeId;
    return this.trackingService.getShiftSummary(organizationId, targetId, date);
  }
}
