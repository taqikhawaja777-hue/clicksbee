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

  @ApiOperation({ summary: 'Get audit logs (Admin only)' })
  @Roles(Role.ADMIN)
  @Get()
  async getLogs(
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.auditLogsService.getLogs(organizationId, Number(page) || 1, Number(limit) || 20);
  }
}
