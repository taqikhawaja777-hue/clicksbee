import { Module } from '@nestjs/common';
import { ScreenshotsService } from './screenshots.service';
import { ScreenshotsController } from './screenshots.controller';
import { AiVisionEvaluatorService } from '../services/aiVisionEvaluator';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService, AiVisionEvaluatorService],
  exports: [ScreenshotsService, AiVisionEvaluatorService],
})
export class ScreenshotsModule {}

