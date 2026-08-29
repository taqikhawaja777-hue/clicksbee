import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StartBreakDto, EndBreakDto } from './dto/break.dto';

@Injectable()
export class BreaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async startBreak(userId: string, organizationId: string, dto: StartBreakDto) {
    const activeBreak = await this.prisma.breakSession.findFirst({
      where: {
        userId,
        organizationId,
        endedAt: null,
      },
    });

    if (activeBreak) {
      throw new ConflictException('Already on an active break session');
    }

    const activeWorkSession = await this.prisma.workSession.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
    });

    const breakSession = await this.prisma.breakSession.create({
      data: {
        organizationId,
        userId,
        workSessionId: activeWorkSession?.id,
        breakType: dto.breakType,
        startedAt: new Date(),
        notes: dto.notes,
      },
    });

    await this.redis.set(
      `user:status:${userId}`,
      JSON.stringify({
        status: 'ON_BREAK',
        breakType: dto.breakType,
        breakId: breakSession.id,
        startedAt: breakSession.startedAt,
      }),
      600,
    );

    return breakSession;
  }

  async endBreak(userId: string, organizationId: string, dto: EndBreakDto) {
    const activeBreak = await this.prisma.breakSession.findFirst({
      where: {
        userId,
        organizationId,
        endedAt: null,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!activeBreak) {
      throw new NotFoundException('No active break session found to end');
    }

    const endedAt = new Date();
    const duration = Math.floor(
      (endedAt.getTime() - activeBreak.startedAt.getTime()) / 1000,
    );

    const updated = await this.prisma.breakSession.update({
      where: { id: activeBreak.id },
      data: {
        endedAt,
        duration,
        notes: dto.notes ? `${activeBreak.notes || ''} ${dto.notes}`.trim() : activeBreak.notes,
      },
    });

    await this.redis.set(
      `user:status:${userId}`,
      JSON.stringify({
        status: 'ACTIVE',
        lastSeenAt: new Date().toISOString(),
      }),
      300,
    );

    return updated;
  }

  async getMyBreaks(userId: string, organizationId: string) {
    return this.prisma.breakSession.findMany({
      where: { userId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  async getUserBreaks(
    targetUserId: string,
    reqUserId: string,
    organizationId: string,
    role: string,
  ) {
    if (role === 'EMPLOYEE' && targetUserId !== reqUserId) {
      throw new ForbiddenException('Access denied to other employee break records');
    }

    return this.prisma.breakSession.findMany({
      where: { userId: targetUserId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }
}
