import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadSheetsController } from './lead-sheets.controller';
import { LeadSheetsService } from './lead-sheets.service';

/** Employee -> Closer customer lead sheets (in-app only, no download). */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [LeadSheetsController],
  providers: [LeadSheetsService],
})
export class LeadSheetsModule {}
