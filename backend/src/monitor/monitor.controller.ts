import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MonitorService, AnalyzeScreenshotDto, ActivityLogDto, HeartbeatDto } from './monitor.service';

@ApiTags('Monitor')
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @ApiOperation({ summary: 'Analyze desktop screenshot with Groq LLM Vision and broadcast WebSocket update' })
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeScreenshot(@Body() dto: AnalyzeScreenshotDto) {
    return this.monitorService.analyzeScreenshot(dto);
  }

  @ApiOperation({ summary: 'Log employee activity from Electron client' })
  @Post('activity/log')
  @HttpCode(HttpStatus.OK)
  async logActivity(@Body() dto: ActivityLogDto) {
    return this.monitorService.logActivity(dto);
  }

  @ApiOperation({ summary: 'Process employee heartbeat from Electron client' })
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Body() dto: HeartbeatDto) {
    return this.monitorService.processHeartbeat(dto);
  }

  @ApiOperation({ summary: 'Get live status for all employees' })
  @Get('live/all')
  async getLiveAll() {
    return this.monitorService.getLiveAll();
  }

  @ApiOperation({ summary: 'Get live status for a specific employee' })
  @Get('live/:employeeId')
  async getLiveEmployee(@Param('employeeId') employeeId: string) {
    return this.monitorService.getLiveEmployee(employeeId);
  }
}
