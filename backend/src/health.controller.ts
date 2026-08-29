import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Check API and MongoDB availability' })
  @Get()
  async getHealth() {
    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
      return { status: 'ok', database: 'mongodb' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        database: 'mongodb',
      });
    }
  }
}
