import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { TrackingService, IdleSnapshotInput } from './tracking.service';
import { getShiftDayString } from '../common/utils/shift-day.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('MongoDB Activity Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  // Electron submits a snapshot before a renderer can necessarily refresh a
  // JWT. Reads intended for the portals below remain authenticated.
  @Post('idle-snapshots')
  @ApiOperation({ summary: 'Upsert a desktop activity snapshot in MongoDB' })
  upsertIdleSnapshot(@Body() body: IdleSnapshotInput) {
    return this.trackingService.upsertIdleSnapshot(body);
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
