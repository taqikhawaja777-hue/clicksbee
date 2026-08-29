import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupTasksService } from './cleanup.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../storage/storage.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, StorageModule],
  providers: [CleanupTasksService],
  exports: [CleanupTasksService],
})
export class TasksCleanupModule {}
