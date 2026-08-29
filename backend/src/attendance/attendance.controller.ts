import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { ClockInDto } from './dto/clock-in.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @ApiOperation({ summary: 'Clock in for work' })
  @Post('clock-in')
  async clockIn(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: ClockInDto,
  ) {
    return this.attendanceService.clockIn(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Clock out from work' })
  @HttpCode(HttpStatus.OK)
  @Post('clock-out')
  async clockOut(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.clockOut(userId, organizationId);
  }

  @ApiOperation({ summary: 'Get current user attendance history' })
  @Get('me')
  async getMyAttendance(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.attendanceService.getMyAttendance(userId, organizationId);
  }

  @ApiOperation({ summary: 'Get attendance by user ID' })
  @Get('user/:userId')
  async getUserAttendance(
    @Param('userId') targetUserId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.attendanceService.getUserAttendance(targetUserId, reqUserId, organizationId, role);
  }

  @ApiOperation({ summary: 'Get all attendance records (Admin/Manager)' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  async getAllAttendance(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.attendanceService.getAllAttendance(organizationId, page ? +page : 1, limit ? +limit : 20);
  }

  @ApiOperation({ summary: 'Get daily attendance summary' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('daily')
  async getDailySummary(
    @CurrentUser('organizationId') organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.attendanceService.getDailySummary(organizationId, date);
  }

  @ApiOperation({ summary: 'Get weekly attendance summary' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('weekly')
  async getWeeklySummary(@CurrentUser('organizationId') organizationId: string) {
    return this.attendanceService.getWeeklySummary(organizationId);
  }

  @ApiOperation({ summary: 'Get monthly attendance summary' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('monthly')
  async getMonthlySummary(@CurrentUser('organizationId') organizationId: string) {
    return this.attendanceService.getMonthlySummary(organizationId);
  }
}
