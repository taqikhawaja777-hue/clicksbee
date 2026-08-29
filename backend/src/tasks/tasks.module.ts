import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { AiTaskEstimatorService } from '../services/aiTaskEstimator';

@Module({
  controllers: [TasksController],
  providers: [TasksService, AiTaskEstimatorService],
  exports: [TasksService, AiTaskEstimatorService],
})
export class TasksModule {}

