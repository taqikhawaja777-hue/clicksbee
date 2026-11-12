import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { ScreenshotsService } from './screenshots.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Screenshots')
@Controller('screenshots')
export class ScreenshotsController {
  constructor(private readonly screenshotsService: ScreenshotsService) {}

  @ApiOperation({
    summary:
      'Desktop agent 1-minute archive capture: writes storage/screenshots/<Employee Name>/<date>/<date_time>.jpg and records it. Idempotent on eventId.',
  })
  @Post('capture')
  async captureScreenshot(
    @Body() dto: {
      userName: string;
      userId: string;
      userRole?: string;
      imageUrl: string;
      activeWindowName?: string;
      timestamp?: string;
      date?: string;
      isIdle?: boolean;
      eventId?: string;
    },
  ) {
    if (!dto || !dto.imageUrl) {
      throw new BadRequestException('Image URL data is required');
    }
    return this.screenshotsService.saveCaptureRecord(dto);
  }

  @ApiOperation({ summary: 'Fetch live screenshots feed from MongoDB collection' })
  @Get('feed')
  async getFeed() {
    return this.screenshotsService.getFeedRecords();
  }

  @ApiOperation({ summary: 'Upload screenshot image' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadScreenshot(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body('deviceId') deviceId?: string,
    @Body('eventId') eventId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.screenshotsService.uploadScreenshot(
      file.buffer,
      file.originalname,
      file.mimetype || 'image/png',
      userId,
      organizationId,
      deviceId,
      eventId,
    );
  }

  @ApiOperation({ summary: 'Get screenshots' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  async getScreenshots(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('role') role: string,
    @Query('userId') userIdFilter?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.screenshotsService.getScreenshots(
      organizationId,
      reqUserId,
      role,
      userIdFilter,
      page ? +page : 1,
      limit ? +limit : 20,
      startDate,
      endDate,
    );
  }

  @ApiOperation({ summary: "Where employee apps send screenshots: the manager PC's LAN IP/port (org-wide)" })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('server-config')
  async getServerConfig(@CurrentUser('organizationId') organizationId: string) {
    return this.screenshotsService.getServerConfig(organizationId);
  }

  @ApiOperation({ summary: 'Set the org-wide screenshot destination (manager/admin only)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('server-config')
  async setServerConfig(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body() body: { ip: string | null; port?: number },
  ) {
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      throw new ForbiddenException('Only managers and admins can change where screenshots are stored');
    }
    return this.screenshotsService.setServerConfig(organizationId, body?.ip ?? null, body?.port);
  }

  @ApiOperation({ summary: 'Get screenshot by ID' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getScreenshotById(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.screenshotsService.getScreenshotById(id, organizationId, reqUserId, role);
  }

  @ApiOperation({ summary: 'Delete screenshot' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteScreenshot(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.screenshotsService.deleteScreenshot(id, organizationId, reqUserId, role);
  }

  @ApiOperation({ summary: 'Stream screenshot image file' })
  @Get('file/*')
  async getFile(@Param('0') relativePath: string) {
    return this.screenshotsService.getScreenshotStream(decodeURIComponent(relativePath));
  }
}
