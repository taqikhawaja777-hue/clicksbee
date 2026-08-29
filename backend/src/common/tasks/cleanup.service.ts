import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class CleanupTasksService {
  private readonly logger = new Logger(CleanupTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRetentionCleanup() {
    this.logger.log('Starting daily retention cleanup background job...');

    const screenshotRetentionDays = Number(this.configService.get('SCREENSHOT_RETENTION_DAYS')) || 30;
    const activityRetentionDays = Number(this.configService.get('ACTIVITY_RETENTION_DAYS')) || 90;

    const screenshotThreshold = new Date();
    screenshotThreshold.setDate(screenshotThreshold.getDate() - screenshotRetentionDays);

    const activityThreshold = new Date();
    activityThreshold.setDate(activityThreshold.getDate() - activityRetentionDays);

    try {
      const expiredScreenshots = await this.prisma.screenshot.findMany({
        where: { capturedAt: { lt: screenshotThreshold } },
      });

      for (const shot of expiredScreenshots) {
        await this.storageService.delete(shot.filePath).catch(() => null);
      }

      const deletedShots = await this.prisma.screenshot.deleteMany({
        where: { capturedAt: { lt: screenshotThreshold } },
      });

      const deletedActivities = await this.prisma.activityEvent.deleteMany({
        where: { timestamp: { lt: activityThreshold } },
      });

      this.logger.log(
        `Cleanup job completed. Purged ${deletedShots.count} screenshots (older than ${screenshotRetentionDays}d) and ${deletedActivities.count} activity logs (older than ${activityRetentionDays}d).`,
      );
    } catch (error) {
      this.logger.error('Failed to execute retention cleanup job', error.stack);
    }
  }
}
