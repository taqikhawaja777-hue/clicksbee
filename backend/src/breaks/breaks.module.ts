import { Module } from '@nestjs/common';
import { BreaksService } from './breaks.service';
import { BreaksController } from './breaks.controller';

@Module({
  controllers: [BreaksController],
  providers: [BreaksService],
  exports: [BreaksService],
})
export class BreaksModule {}
