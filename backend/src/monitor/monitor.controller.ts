import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MonitorService, AnalyzeScreenshotDto, ActivityLogDto, HeartbeatDto } from './monitor.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { TrackingAuthGuard, trackingUserId } from '../common/access/tracking-auth.guard';

@ApiTags('Monitor')
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  // Desktop uploads: always credited to the signed-in user (legacy apps: the employeeId they send).
  @ApiOperation({ summary: 'Analyze desktop screenshot with LLM Vision and broadcast WebSocket update' })
  @UseGuards(TrackingAuthGuard)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeScreenshot(@Req() req: any, @Body() dto: AnalyzeScreenshotDto) {
    return this.monitorService.analyzeScreenshot({ ...dto, employeeId: trackingUserId(req, dto.employeeId) });
  }

  @ApiOperation({ summary: 'Log employee activity from Electron client' })
  @UseGuards(TrackingAuthGuard)
  @Post('activity/log')
  @HttpCode(HttpStatus.OK)
  async logActivity(@Req() req: any, @Body() dto: ActivityLogDto) {
    return this.monitorService.logActivity({ ...dto, employeeId: trackingUserId(req, dto.employeeId) });
  }

  @ApiOperation({ summary: 'Process employee heartbeat from Electron client' })
  @UseGuards(TrackingAuthGuard)
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Req() req: any, @Body() dto: HeartbeatDto) {
    return this.monitorService.processHeartbeat({ ...dto, employeeId: trackingUserId(req, dto.employeeId) });
  }

  // Live Monitor = an AI reading of the employee's screen -> same rule as screenshots (Admin/Boss only).
  @ApiOperation({ summary: 'Get live status for all employees' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('liveMonitor.view')
  @Get('live/all')
  async getLiveAll() {
    return this.monitorService.getLiveAll();
  }

  @ApiOperation({ summary: 'Get live status for a specific employee' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('liveMonitor.view')
  @Get('live/:employeeId')
  async getLiveEmployee(@Param('employeeId') employeeId: string) {
    return this.monitorService.getLiveEmployee(employeeId);
  }
}
