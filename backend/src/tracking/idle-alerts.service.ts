import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationRecipientType, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isScheduledBreakTime, isWithinShift } from '../common/utils/shift-day.util';
import { hasFlexibleHours } from '../common/access/access.util';

export type IdleEvent = 'IDLE_STARTED' | 'IDLE_ENDED' | 'NO_CALL_GAP' | 'SUSPICIOUS_ACTIVITY';

export const IDLE_ALERT_TITLE = 'Idle Alert';
export const BACK_FROM_IDLE_TITLE = 'Back from Idle';
export const NO_CALL_TITLE = 'No Calls';
export const SUSPICIOUS_TITLE = 'Suspicious Activity';

const EVENT_META: Record<IdleEvent, { type: NotificationType; title: string }> = {
  IDLE_STARTED: { type: NotificationType.IDLE_ALERT, title: IDLE_ALERT_TITLE },
  IDLE_ENDED: { type: NotificationType.IDLE_ALERT, title: BACK_FROM_IDLE_TITLE },
  NO_CALL_GAP: { type: NotificationType.NO_CALL_ALERT, title: NO_CALL_TITLE },
  SUSPICIOUS_ACTIVITY: { type: NotificationType.SUSPICIOUS_ACTIVITY, title: SUSPICIOUS_TITLE },
};
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
    input: { event: IdleEvent; idleSince: string; endedAt?: string; reason?: string },
    now: Date = new Date(),
  ) {
    const since = new Date(input.idleSince);
    if (Number.isNaN(since.getTime()) || since.getTime() > now.getTime() + 120_000 || now.getTime() - since.getTime() > MAX_EVENT_AGE_MS) {
      throw new BadRequestException('idleSince must be a recent timestamp');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, organizationId: true, role: true, designation: true, officeCategory: true },
    });
    if (!user || user.organizationId !== organizationId) throw new NotFoundException('User not found');
    const name = `${user.firstName} ${user.lastName}`.trim();

    const { type, title } = EVENT_META[input.event];

    // Close this idle period in the Idle Alert Report (before the duplicate check - retries are harmless).
    if (input.event === 'IDLE_ENDED') {
      const parsed = input.endedAt ? new Date(input.endedAt) : now;
      const endedAt = Number.isNaN(parsed.getTime()) || parsed > now || parsed < since ? now : parsed;
      await this.prisma.idleEpisode.updateMany({ where: { userId, idleSince: since }, data: { endedAt } });
    }

    // Breaks and off-shift time are never idle (same rule as the desktop tracker).
    // Back Office / Validator have no duty hours - their alerts work any time of day.
    if (input.event !== 'IDLE_ENDED' && !hasFlexibleHours(user) && (!isWithinShift(now) || isScheduledBreakTime(now))) {
      return { recorded: false, reason: 'Outside working time or during a scheduled break' };
    }

    // The app retries on network errors - don't post the same alert twice.
    const duplicate = await this.prisma.notification.findFirst({
      where: {
        organizationId,
        userId,
        recipientType: NotificationRecipientType.EMPLOYEE,
        type,
        title,
        createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (duplicate) return { recorded: false, reason: 'Duplicate' };

    const startTime = formatKarachiTime(since);
    const metadata = { event: input.event, idleSince: since.toISOString() };

    if (input.event === 'NO_CALL_GAP' || input.event === 'SUSPICIOUS_ACTIVITY') {
      const reason = (input.reason || '').trim().slice(0, 200);
      const minutes = formatIdleDuration(now.getTime() - since.getTime());
      const [adminMessage, employeeMessage] =
        input.event === 'NO_CALL_GAP'
          ? [
              `${name} has not been on a call since ${startTime} (${minutes})`,
              `No call since ${startTime} (${minutes})`,
            ]
          : [
              `${name}: unusual activity since ${startTime}${reason ? ` - ${reason}` : ''}. Check their screenshots or camera.`,
              `Unusual activity detected at ${startTime}${reason ? ` - ${reason}` : ''}`,
            ];
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.ADMIN,
        type,
        title,
        message: adminMessage,
        metadata: { ...metadata, userId, reason: reason || undefined },
      });
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.EMPLOYEE,
        recipientUserId: userId,
        type,
        title,
        message: employeeMessage,
        metadata: { ...metadata, reason: reason || undefined },
      });
      return { recorded: true };
    }

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
        message: `Went idle at ${startTime}`,
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
