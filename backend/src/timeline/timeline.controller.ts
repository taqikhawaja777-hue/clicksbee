import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Employee Timeline')
@ApiBearerAuth()
// Cross-employee data - Admin/Boss only (access.util.ts).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @ApiOperation({ summary: 'Get chronological activity timeline for user' })
  @Get(':userId')
  async getUserTimeline(
    @Param('userId') targetUserId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Query('date') date?: string,
  ) {
    return this.timelineService.getUserTimeline(
      targetUserId,
      reqUserId,
      organizationId,
      role,
      date,
    );
  }
}
