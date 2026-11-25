import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersAdminController } from './users-admin.controller';
import { ActivityLogController } from './activity-log.controller';
import { TeamController } from './team.controller';
import { CandidatesController } from './candidates.controller';
import { TeamIdleAlertsService } from './team-idle-alerts.service';

/** Roles & permissions features: Users (Admin), full-day Activity Log, Team Lead team + idle alerts, Candidates. */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [UsersAdminController, ActivityLogController, TeamController, CandidatesController],
  providers: [TeamIdleAlertsService],
})
export class AccessControlModule {}
