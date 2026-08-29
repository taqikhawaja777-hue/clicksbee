import { Module } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PoliciesController, ClientConfigController } from './policies.controller';

@Module({
  controllers: [PoliciesController, ClientConfigController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
