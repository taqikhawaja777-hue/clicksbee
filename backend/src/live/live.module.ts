import { Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [RedisModule, AuthModule, JwtModule],
  providers: [LiveGateway],
  exports: [LiveGateway],
})
export class LiveModule {}
