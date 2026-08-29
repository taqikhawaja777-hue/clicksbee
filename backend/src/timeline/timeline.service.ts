import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserTimeline(
    targetUserId: string,
    reqUserId: string,
    organizationId: string,
    role: string,
    dateStr?: string,
  ) {
    if (role === 'EMPLOYEE' && targetUserId !== reqUserId) {
      throw new ForbiddenException('Access denied to other employee timeline');
    }

    const dateFilter = dateStr || new Date().toISOString().split('T')[0];
    const startOfDay = new Date(`${dateFilter}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateFilter}T23:59:59.999Z`);

    const [attendance, workSessions, breakSessions, activityEvents, screenshots, tasks] =
      await Promise.all([
        this.prisma.attendance.findMany({
          where: { userId: targetUserId, organizationId, clockIn: { gte: startOfDay, lte: endOfDay } },
        }),
        this.prisma.workSession.findMany({
          where: { userId: targetUserId, organizationId, startedAt: { gte: startOfDay, lte: endOfDay } },
        }),
        this.prisma.breakSession.findMany({
          where: { userId: targetUserId, organizationId, startedAt: { gte: startOfDay, lte: endOfDay } },
        }),
        this.prisma.activityEvent.findMany({
          where: { userId: targetUserId, organizationId, timestamp: { gte: startOfDay, lte: endOfDay } },
        }),
        this.prisma.screenshot.findMany({
          where: { userId: targetUserId, organizationId, capturedAt: { gte: startOfDay, lte: endOfDay } },
        }),
        this.prisma.task.findMany({
          where: { assignedTo: targetUserId, organizationId, updatedAt: { gte: startOfDay, lte: endOfDay } },
        }),
      ]);

    const items: Array<{ timestamp: Date; title: string; category: string; icon?: string; metadata?: any }> = [];

    attendance.forEach((a) => {
      if (a.clockIn) {
        items.push({ timestamp: a.clockIn, title: 'Clocked In', category: 'ATTENDANCE', icon: 'login' });
      }
      if (a.clockOut) {
        items.push({ timestamp: a.clockOut, title: 'Clocked Out', category: 'ATTENDANCE', icon: 'logout' });
      }
    });

    breakSessions.forEach((b) => {
      if (b.startedAt) {
        items.push({ timestamp: b.startedAt, title: `Started ${b.breakType}`, category: 'BREAK', icon: 'coffee' });
      }
      if (b.endedAt) {
        items.push({ timestamp: b.endedAt, title: `Ended ${b.breakType}`, category: 'BREAK', icon: 'play' });
      }
    });

    activityEvents.forEach((ev) => {
      items.push({
        timestamp: ev.timestamp,
        title: `Activity: ${ev.type.replace(/_/g, ' ')}`,
        category: 'EVENT',
        metadata: ev.metadata,
      });
    });

    screenshots.forEach((s) => {
      items.push({
        timestamp: s.capturedAt,
        title: 'Screenshot Captured',
        category: 'SCREENSHOT',
        icon: 'camera',
        metadata: { screenshotId: s.id, fileUrl: s.fileUrl },
      });
    });

    tasks.forEach((t) => {
      if (t.startedAt) {
        items.push({ timestamp: t.startedAt, title: `Task Started: ${t.title}`, category: 'TASK' });
      }
      if (t.completedAt) {
        items.push({ timestamp: t.completedAt, title: `Task Completed: ${t.title}`, category: 'TASK' });
      }
    });

    items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      date: dateFilter,
      userId: targetUserId,
      timeline: items.map((i) => ({
        ...i,
        timeString: i.timestamp.toISOString().substring(11, 16),
      })),
    };
  }
}
