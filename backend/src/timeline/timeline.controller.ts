import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Employee Timeline')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
