import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MonitorGateway } from './monitor.gateway';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { GeminiVisionService } from './gemini-vision.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [MonitorController],
  providers: [MonitorGateway, MonitorService, GeminiVisionService],
  exports: [MonitorGateway, MonitorService, GeminiVisionService],
})
export class MonitorModule {}
