import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: 'Get current user notifications' })
  @Get()
  async getNotifications(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.notificationsService.getUserNotifications(userId, organizationId, Number(page) || 1, Number(limit) || 20);
  }

  @ApiOperation({ summary: 'Mark all notifications as read' })
  @Patch('read-all')
  async markAllAsRead(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.notificationsService.markAllAsRead(userId, organizationId);
  }

  @ApiOperation({ summary: 'Mark single notification as read' })
  @Patch(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.notificationsService.markAsRead(id, userId, organizationId);
  }
}
