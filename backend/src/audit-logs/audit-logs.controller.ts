import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { categoryOf } from '../common/access/access.util';

/** SM sees only login / check-in / check-out records of agents. */
export const SM_LOG_ACTIONS = ['LOGIN', 'CHECK_IN', 'OVERTIME_CHECK_IN', 'CHECK_OUT'];

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @ApiOperation({ summary: 'Activity logs by shift-day / employee / action (Admin & HR: all; SM: agents\' login records)' })
  @RequirePermission('loginRecords.view')
  @Get()
  async getLogs(
    @Req() req: any,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('date') date: string,
    @Query('userId') userId: string,
    @Query('action') action: string,
  ) {
    const isSm = categoryOf(req.user) === 'SM';
    return this.auditLogsService.getLogs(
      req.user.organizationId,
      Number(page) || 1,
      Number(limit) || 50,
      date || undefined,
      userId || undefined,
      action || undefined,
      isSm ? { allowedActions: SM_LOG_ACTIONS, agentsOnly: true } : undefined,
    );
  }
}
