import { Module } from '@nestjs/common';
import { MonitorGateway } from './monitor.gateway';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { GeminiVisionService } from './gemini-vision.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MonitorController],
  providers: [MonitorGateway, MonitorService, GeminiVisionService],
  exports: [MonitorGateway, MonitorService, GeminiVisionService],
})
export class MonitorModule {}
