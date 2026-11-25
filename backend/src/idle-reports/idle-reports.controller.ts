import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { CAMERA_STATUSES, CameraStatus, IdleReportsService } from './idle-reports.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class IdleCaptureDto {
  @ApiProperty() @IsISO8601()
  idleSince: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  capturedAt?: string;

  @ApiProperty({ description: 'JPEG data URL (up to 600 KB) kept for the report and summarised by AI' }) @IsString() @IsNotEmpty() @MaxLength(820_000)
  screenshot: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(220_000)
  camera?: string;

  @ApiProperty({ enum: CAMERA_STATUSES }) @IsIn(CAMERA_STATUSES as unknown as string[])
  cameraStatus: CameraStatus;
}

@ApiTags('Idle Reports')
@ApiBearerAuth()
@Controller('idle-reports')
export class IdleReportsController {
  constructor(private readonly idleReports: IdleReportsService) {}

  // Desktop app, once a minute while the signed-in employee is idle (always recorded for themselves).
  @ApiOperation({ summary: 'Record one idle-time screenshot (+ camera picture) and summarise it with AI' })
  @UseGuards(JwtAuthGuard)
  @Post('capture')
  @HttpCode(HttpStatus.OK)
  capture(@Req() req: any, @Body() dto: IdleCaptureDto) {
    return this.idleReports.recordCapture(req.user, dto);
  }

  // Screenshots and camera pictures -> Admin/Boss only, same as the Screenshots page.
  @ApiOperation({ summary: 'Idle Alert Report: every idle period with AI summary, screenshots and camera pictures' })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('screenshots.view')
  @Get()
  report(@Req() req: any, @Query('from') from: string, @Query('to') to: string) {
    const today = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return this.idleReports.getReport(
      req.user.organizationId,
      DATE.test(from || '') ? from : today,
      DATE.test(to || '') ? to : today,
    );
  }
}
