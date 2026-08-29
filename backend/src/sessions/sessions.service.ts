import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StartSessionDto, EndSessionDto, HeartbeatDto } from './dto/session.dto';
import { SessionStatus } from '@prisma/client';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async startSession(userId: string, organizationId: string, dto: StartSessionDto) {
    const active = await this.prisma.workSession.findFirst({
      where: {
        userId,
        organizationId,
        status: SessionStatus.ACTIVE,
      },
    });

    if (active) {
      return active;
    }

    const session = await this.prisma.workSession.create({
      data: {
        userId,
        organizationId,
        deviceId: dto.deviceId,
        startedAt: new Date(),
        status: SessionStatus.ACTIVE,
        lastHeartbeatAt: new Date(),
      },
    });

    await this.redis.set(`user:status:${userId}`, JSON.stringify({
      status: 'ACTIVE',
      sessionId: session.id,
      lastSeenAt: new Date().toISOString(),
    }), 300);

    return session;
  }

  async endSession(userId: string, organizationId: string, dto: EndSessionDto) {
    let session = null;
    if (dto.sessionId) {
      session = await this.prisma.workSession.findUnique({
        where: { id: dto.sessionId },
      });
    } else {
      session = await this.prisma.workSession.findFirst({
        where: { userId, organizationId, status: SessionStatus.ACTIVE },
        orderBy: { startedAt: 'desc' },
      });
    }

    if (!session) {
      throw new NotFoundException('No active work session found to end');
    }

    const endedAt = new Date();
    const duration = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);

    const updated = await this.prisma.workSession.update({
      where: { id: session.id },
      data: {
        endedAt,
        duration,
        status: SessionStatus.COMPLETED,
      },
    });

    await this.redis.del(`user:status:${userId}`);

    return updated;
  }

  async heartbeat(userId: string, organizationId: string, dto: HeartbeatDto) {
    let session = null;
    if (dto.sessionId) {
      session = await this.prisma.workSession.findUnique({ where: { id: dto.sessionId } });
    } else {
      session = await this.prisma.workSession.findFirst({
        where: { userId, organizationId, status: SessionStatus.ACTIVE },
      });
    }

    if (!session) {
      session = await this.startSession(userId, organizationId, { deviceId: dto.deviceId });
    } else {
      await this.prisma.workSession.update({
        where: { id: session.id },
        data: { lastHeartbeatAt: new Date() },
      });
    }

    if (dto.deviceId) {
      await this.prisma.device.updateMany({
        where: { id: dto.deviceId },
        data: { lastSeenAt: new Date() },
      });
    }

    await this.redis.set(`user:status:${userId}`, JSON.stringify({
      status: 'ACTIVE',
      sessionId: session.id,
      currentApplication: dto.currentApplication || 'Desktop Activity',
      lastSeenAt: new Date().toISOString(),
    }), 300);

    return {
      sessionId: session.id,
      status: 'ACTIVE',
      timestamp: new Date().toISOString(),
    };
  }
}
