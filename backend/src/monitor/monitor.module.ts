import { Module } from '@nestjs/common';
import { MonitorGateway } from './monitor.gateway';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { GroqVisionService } from './groq-vision.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MonitorController],
  providers: [MonitorGateway, MonitorService, GroqVisionService],
  exports: [MonitorGateway, MonitorService, GroqVisionService],
})
export class MonitorModule {}
