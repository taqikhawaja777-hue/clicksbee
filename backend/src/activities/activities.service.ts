import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplicationUsageDto,
  BatchApplicationUsageDto,
  WebsiteUsageDto,
  BatchWebsiteUsageDto,
  IdleEventDto,
  GenericActivityEventDto,
} from './dto/activity.dto';

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return rawUrl.split('?')[0];
    }
  }

  async recordApplication(userId: string, organizationId: string, dto: ApplicationUsageDto) {
    if (dto.eventId) {
      const existing = await this.prisma.applicationUsage.findUnique({
        where: { eventId: dto.eventId },
      });
      if (existing) return existing;
    }

    return this.prisma.applicationUsage.create({
      data: {
        organizationId,
        userId,
        deviceId: dto.deviceId,
        applicationName: dto.applicationName,
        processName: dto.processName,
        windowTitle: dto.windowTitle,
        startedAt: new Date(dto.startedAt),
        endedAt: new Date(dto.endedAt),
        duration: dto.duration,
        category: dto.category || 'Uncategorized',
        isProductive: dto.isProductive ?? true,
        eventId: dto.eventId,
      },
    });
  }

  async recordApplicationBatch(userId: string, organizationId: string, dto: BatchApplicationUsageDto) {
    const results = [];
    for (const app of dto.applications) {
      const item = await this.recordApplication(userId, organizationId, {
        ...app,
        deviceId: app.deviceId || dto.deviceId,
      });
      results.push(item);
    }
    return { count: results.length, applications: results };
  }

  async recordWebsite(userId: string, organizationId: string, dto: WebsiteUsageDto) {
    if (dto.eventId) {
      const existing = await this.prisma.websiteUsage.findUnique({
        where: { eventId: dto.eventId },
      });
      if (existing) return existing;
    }

    const cleanUrl = this.sanitizeUrl(dto.url);

    return this.prisma.websiteUsage.create({
      data: {
        organizationId,
        userId,
        deviceId: dto.deviceId,
        domain: dto.domain.toLowerCase(),
        url: cleanUrl,
        title: dto.title,
        startedAt: new Date(dto.startedAt),
        endedAt: new Date(dto.endedAt),
        duration: dto.duration,
        category: dto.category || 'Uncategorized',
        isProductive: dto.isProductive ?? true,
        eventId: dto.eventId,
      },
    });
  }

  async recordWebsiteBatch(userId: string, organizationId: string, dto: BatchWebsiteUsageDto) {
    const results = [];
    for (const web of dto.websites) {
      const item = await this.recordWebsite(userId, organizationId, {
        ...web,
        deviceId: web.deviceId || dto.deviceId,
      });
      results.push(item);
    }
    return { count: results.length, websites: results };
  }

  async recordIdle(userId: string, organizationId: string, dto: IdleEventDto) {
    if (dto.eventId) {
      const existing = await this.prisma.activityEvent.findUnique({
        where: { eventId: dto.eventId },
      });
      if (existing) return existing;
    }

    return this.prisma.activityEvent.create({
      data: {
        organizationId,
        userId,
        deviceId: dto.deviceId,
        type: 'IDLE_ENDED',
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
        metadata: { idleDuration: dto.idleDuration },
        eventId: dto.eventId,
      },
    });
  }

  async recordEvent(userId: string, organizationId: string, dto: GenericActivityEventDto) {
    if (dto.eventId) {
      const existing = await this.prisma.activityEvent.findUnique({
        where: { eventId: dto.eventId },
      });
      if (existing) return existing;
    }

    return this.prisma.activityEvent.create({
      data: {
        organizationId,
        userId,
        deviceId: dto.deviceId,
        type: dto.type,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
        metadata: dto.metadata || {},
        eventId: dto.eventId,
      },
    });
  }

  async getMyApplications(userId: string, organizationId: string) {
    return this.prisma.applicationUsage.findMany({
      where: { userId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  async getUserApplications(
    targetUserId: string,
    reqUserId: string,
    organizationId: string,
    role: string,
  ) {
    if (role === 'EMPLOYEE' && targetUserId !== reqUserId) {
      throw new ForbiddenException('Access denied to other user activity data');
    }
    return this.prisma.applicationUsage.findMany({
      where: { userId: targetUserId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  async getMyWebsites(userId: string, organizationId: string) {
    return this.prisma.websiteUsage.findMany({
      where: { userId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  async getUserWebsites(
    targetUserId: string,
    reqUserId: string,
    organizationId: string,
    role: string,
  ) {
    if (role === 'EMPLOYEE' && targetUserId !== reqUserId) {
      throw new ForbiddenException('Access denied to other user activity data');
    }
    return this.prisma.websiteUsage.findMany({
      where: { userId: targetUserId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  async getActivityFeed(organizationId: string, limit = 20) {
    return this.prisma.activityEvent.findMany({
      where: { organizationId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}
