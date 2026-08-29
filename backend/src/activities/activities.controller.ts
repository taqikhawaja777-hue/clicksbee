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
import { ActivitiesService } from './activities.service';
import {
  ApplicationUsageDto,
  BatchApplicationUsageDto,
  WebsiteUsageDto,
  BatchWebsiteUsageDto,
  IdleEventDto,
  GenericActivityEventDto,
} from './dto/activity.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @ApiOperation({ summary: 'Record application usage' })
  @Post('application')
  async recordApplication(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: ApplicationUsageDto,
  ) {
    return this.activitiesService.recordApplication(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Batch record application usage' })
  @Post('application/batch')
  async recordApplicationBatch(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: BatchApplicationUsageDto,
  ) {
    return this.activitiesService.recordApplicationBatch(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get current user application usage' })
  @Get('applications/me')
  async getMyApplications(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.activitiesService.getMyApplications(userId, organizationId);
  }

  @ApiOperation({ summary: 'Get user application usage' })
  @Get('applications/user/:userId')
  async getUserApplications(
    @Param('userId') targetUserId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.activitiesService.getUserApplications(targetUserId, reqUserId, organizationId, role);
  }

  @ApiOperation({ summary: 'Record website usage' })
  @Post('website')
  async recordWebsite(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: WebsiteUsageDto,
  ) {
    return this.activitiesService.recordWebsite(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Batch record website usage' })
  @Post('website/batch')
  async recordWebsiteBatch(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: BatchWebsiteUsageDto,
  ) {
    return this.activitiesService.recordWebsiteBatch(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get current user website usage' })
  @Get('websites/me')
  async getMyWebsites(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.activitiesService.getMyWebsites(userId, organizationId);
  }

  @ApiOperation({ summary: 'Get user website usage' })
  @Get('websites/user/:userId')
  async getUserWebsites(
    @Param('userId') targetUserId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.activitiesService.getUserWebsites(targetUserId, reqUserId, organizationId, role);
  }

  @ApiOperation({ summary: 'Record idle event' })
  @HttpCode(HttpStatus.OK)
  @Post('idle')
  async recordIdle(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: IdleEventDto,
  ) {
    return this.activitiesService.recordIdle(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Record generic activity event' })
  @Post('events')
  async recordEvent(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: GenericActivityEventDto,
  ) {
    return this.activitiesService.recordEvent(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get organization activity feed' })
  @Get('feed')
  async getActivityFeed(
    @CurrentUser('organizationId') organizationId: string,
    @Query('limit') limit?: number,
  ) {
    return this.activitiesService.getActivityFeed(organizationId, limit ? +limit : 20);
  }
}
