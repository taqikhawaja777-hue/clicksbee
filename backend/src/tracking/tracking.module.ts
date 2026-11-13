import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { IdleAlertsService } from './idle-alerts.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [TrackingController],
  providers: [TrackingService, IdleAlertsService],
})
export class TrackingModule {}
