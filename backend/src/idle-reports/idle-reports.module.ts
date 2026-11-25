import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MonitorModule } from '../monitor/monitor.module';
import { IdleReportsController } from './idle-reports.controller';
import { IdleReportsService } from './idle-reports.service';

/** Idle Alert Report: idle-time screenshots, AI summaries and camera pictures (Admin only). */
@Module({
  imports: [PrismaModule, MonitorModule],
  controllers: [IdleReportsController],
  providers: [IdleReportsService],
  exports: [IdleReportsService],
})
export class IdleReportsModule {}
