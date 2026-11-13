import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationRecipientType, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isScheduledBreakTime, isWithinShift } from '../common/utils/shift-day.util';

export type IdleEvent = 'IDLE_STARTED' | 'IDLE_ENDED';

export const IDLE_ALERT_TITLE = 'Idle Alert';
export const BACK_FROM_IDLE_TITLE = 'Back from Idle';
const DUPLICATE_WINDOW_MS = 90_000;
const MAX_EVENT_AGE_MS = 12 * 60 * 60 * 1000;

export function formatKarachiTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });
}

export function formatIdleDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Idle alerts reported by the employee's desktop app the moment they cross
 * the 2-minute idle threshold, and again when they come back. "Went idle"
 * goes to the manager feed (live, with a beep on the manager app) and to the
 * employee; "back" (with the duration) goes to the employee. The employee-
 * scoped rows are what the Logs page lists as Idle Alert.
 */
@Injectable()
export class IdleAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async recordIdleEvent(
    userId: string,
    organizationId: string,
    input: { event: IdleEvent; idleSince: string; endedAt?: string },
    now: Date = new Date(),
  ) {
    const since = new Date(input.idleSince);
    if (Number.isNaN(since.getTime()) || since.getTime() > now.getTime() + 120_000 || now.getTime() - since.getTime() > MAX_EVENT_AGE_MS) {
      throw new BadRequestException('idleSince must be a recent timestamp');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, organizationId: true },
    });
    if (!user || user.organizationId !== organizationId) throw new NotFoundException('User not found');
    const name = `${user.firstName} ${user.lastName}`.trim();

    const title = input.event === 'IDLE_STARTED' ? IDLE_ALERT_TITLE : BACK_FROM_IDLE_TITLE;

    // Breaks and off-shift time are never idle (same rule as the desktop tracker).
    if (input.event === 'IDLE_STARTED' && (!isWithinShift(now) || isScheduledBreakTime(now))) {
      return { recorded: false, reason: 'Outside working time or during a scheduled break' };
    }

    // The app retries on network errors - don't post the same alert twice.
    const duplicate = await this.prisma.notification.findFirst({
      where: {
        organizationId,
        userId,
        recipientType: NotificationRecipientType.EMPLOYEE,
        type: NotificationType.IDLE_ALERT,
        title,
        createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (duplicate) return { recorded: false, reason: 'Duplicate' };

    const startTime = formatKarachiTime(since);
    const metadata = { event: input.event, idleSince: since.toISOString() };

    if (input.event === 'IDLE_STARTED') {
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.ADMIN,
        type: NotificationType.IDLE_ALERT,
        title: IDLE_ALERT_TITLE,
        message: `${name} has been idle since ${startTime} - no mouse or keyboard activity for 2+ minutes`,
        metadata: { ...metadata, userId },
      });
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.EMPLOYEE,
        recipientUserId: userId,
        type: NotificationType.IDLE_ALERT,
        title: IDLE_ALERT_TITLE,
        message: `Went idle at ${startTime} - no mouse or keyboard activity for 2+ minutes`,
        metadata,
      });
      return { recorded: true };
    }

    const parsedEnd = input.endedAt ? new Date(input.endedAt) : now;
    const ended = Number.isNaN(parsedEnd.getTime()) || parsedEnd > now || parsedEnd < since ? now : parsedEnd;
    await this.notificationsService.createSystemNotification({
      organizationId,
      recipientType: NotificationRecipientType.EMPLOYEE,
      recipientUserId: userId,
      type: NotificationType.IDLE_ALERT,
      title: BACK_FROM_IDLE_TITLE,
      message: `Active again at ${formatKarachiTime(ended)} after ${formatIdleDuration(ended.getTime() - since.getTime())} idle (${startTime} - ${formatKarachiTime(ended)})`,
      metadata: { ...metadata, endedAt: ended.toISOString(), idleSeconds: Math.round((ended.getTime() - since.getTime()) / 1000) },
    });
    return { recorded: true };
  }
}
