import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncOfflineData(organizationId: string, userId: string, deviceId: string, syncPayload: any) {
    const syncId = syncPayload.syncId;
    if (!syncId) {
      throw new BadRequestException('syncId is required for idempotent sync');
    }

    const existingSync = await this.prisma.syncQueue.findUnique({
      where: { syncId },
    });

    if (existingSync && existingSync.status === 'COMPLETED') {
      return { message: 'Sync already processed', syncId };
    }

    const events = syncPayload.events || [];
    let processed = 0;
    let duplicates = 0;
    let failed = 0;

    for (const event of events) {
      try {
        if (event.type === 'APPLICATION' && event.eventId) {
          const exists = await this.prisma.applicationUsage.findUnique({ where: { eventId: event.eventId } });
          if (exists) {
            duplicates++;
            continue;
          }
          await this.prisma.applicationUsage.create({
            data: {
              organizationId,
              userId,
              deviceId,
              applicationName: event.applicationName,
              processName: event.processName,
              startedAt: new Date(event.startedAt),
              endedAt: new Date(event.endedAt),
              duration: event.duration,
              eventId: event.eventId,
            }
          });
          processed++;
        }
      } catch (e) {
        failed++;
      }
    }

    await this.prisma.syncQueue.upsert({
      where: { syncId },
      update: {
        processedCount: (existingSync?.processedCount || 0) + processed,
        duplicatesCount: (existingSync?.duplicatesCount || 0) + duplicates,
        failedCount: (existingSync?.failedCount || 0) + failed,
        status: 'COMPLETED',
      },
      create: {
        organizationId,
        userId,
        deviceId,
        syncId,
        eventsCount: events.length,
        processedCount: processed,
        duplicatesCount: duplicates,
        failedCount: failed,
        clientTimestamp: syncPayload.timestamp,
        status: 'COMPLETED',
      }
    });

    return {
      message: 'Sync completed',
      syncId,
      stats: { processed, duplicates, failed }
    };
  }
}
