import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: 'Get main dashboard overview statistics' })
  @Get('overview')
  async getOverview(@CurrentUser('organizationId') organizationId: string) {
    return this.dashboardService.getOverview(organizationId);
  }

  @ApiOperation({ summary: 'Get dashboard productivity breakdown' })
  @Get('productivity')
  async getProductivityBreakdown(@CurrentUser('organizationId') organizationId: string) {
    return this.dashboardService.getProductivityBreakdown(organizationId);
  }

  @ApiOperation({ summary: 'Get dashboard attendance summary' })
  @Get('attendance')
  async getAttendanceOverview(@CurrentUser('organizationId') organizationId: string) {
    return this.dashboardService.getAttendanceOverview(organizationId);
  }

  @ApiOperation({ summary: 'Get dashboard activity feed' })
  @Get('activity')
  async getActivityFeed(@CurrentUser('organizationId') organizationId: string) {
    return this.dashboardService.getActivityFeed(organizationId);
  }
}
