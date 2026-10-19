import { Module } from '@nestjs/common';
import { CleanupTasksService } from './cleanup.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [CleanupTasksService],
  exports: [CleanupTasksService],
})
export class TasksCleanupModule {}
