import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @ApiOperation({ summary: 'Get employee activity logs, filterable by shift-day date / employee / action (Manager portal only)' })
  // ADMIN alone (this endpoint's original restriction, from before it did
  // anything) rejected real Manager-portal accounts whose backend role is
  // literally MANAGER, not ADMIN - every other manager-facing controller in
  // this app (attendance, licenses, policies, projects, reports) already
  // accepts both, and the frontend itself treats them as equivalent
  // "manager access" (see canAccessManagerDashboard in EmployeeContext.tsx).
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  async getLogs(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('date') date: string,
    @Query('userId') userId: string,
    @Query('action') action: string,
  ) {
    return this.auditLogsService.getLogs(
      organizationId,
      Number(page) || 1,
      Number(limit) || 50,
      date || undefined,
      userId || undefined,
      action || undefined,
    );
  }
}
