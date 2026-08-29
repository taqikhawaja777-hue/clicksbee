import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Reporting System')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({ summary: 'Monthly attendance rate analytics (Public)' })
  @Get('attendance-analytics')
  async getAttendanceAnalytics(
    @Query('organizationId') organizationId?: string,
  ) {
    return this.reportsService.getAttendanceAnalytics(organizationId);
  }

  @ApiOperation({ summary: 'Daily attendance report' })
  @Get('daily')
  async getDailyReport(
    @CurrentUser('organizationId') organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.getDailyReport(organizationId, date);
  }

  @ApiOperation({ summary: 'Weekly attendance report' })
  @Get('weekly')
  async getWeeklyReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getWeeklyReport(organizationId);
  }

  @ApiOperation({ summary: 'Monthly attendance report' })
  @Get('monthly')
  async getMonthlyReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getMonthlyReport(organizationId);
  }

  @ApiOperation({ summary: 'Productivity report' })
  @Get('productivity')
  async getProductivityReport(
    @CurrentUser('organizationId') organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getProductivityReport(organizationId, startDate, endDate);
  }

  @ApiOperation({ summary: 'Attendance report' })
  @Get('attendance')
  async getAttendanceReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getAttendanceReport(organizationId);
  }

  @ApiOperation({ summary: 'Activity event report' })
  @Get('activity')
  async getActivityReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getActivityReport(organizationId);
  }

  @ApiOperation({ summary: 'Application usage report' })
  @Get('applications')
  async getApplicationsReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getApplicationsReport(organizationId);
  }

  @ApiOperation({ summary: 'Website usage report' })
  @Get('websites')
  async getWebsitesReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getWebsitesReport(organizationId);
  }

  @ApiOperation({ summary: 'Project progress report' })
  @Get('projects')
  async getProjectsReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getProjectsReport(organizationId);
  }

  @ApiOperation({ summary: 'Task completion report' })
  @Get('tasks')
  async getTasksReport(@CurrentUser('organizationId') organizationId: string) {
    return this.reportsService.getTasksReport(organizationId);
  }
}
