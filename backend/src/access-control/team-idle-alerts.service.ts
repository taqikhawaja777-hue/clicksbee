import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationRecipientType, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getShiftDayString, isScheduledBreakTime, isWithinShift } from '../common/utils/shift-day.util';
import { DEFAULT_TEAM_IDLE_ALERT_MINUTES } from '../tracking/tracking.service';
import { formatIdleDuration, formatKarachiTime } from '../tracking/idle-alerts.service';

/** The app reports every ~90s; older than this = the app isn't running (Away), not idle. */
const FRESH_SNAPSHOT_MS = 5 * 60_000;

export interface IdleCandidate {
  userId: string;
  organizationId: string;
  idleSince: Date;
  updatedAt: Date;
  teamLeadId: string | null;
  name: string;
}

/** Which agents should alert their Team Lead now (pure - unit tested). */
export function agentsToAlert(
  candidates: IdleCandidate[],
  limitMinutesByOrg: Map<string, number>,
  alreadyAlerted: Set<string>,
  now: Date,
): IdleCandidate[] {
  return candidates.filter((c) => {
    if (!c.teamLeadId) return false;
    if (now.getTime() - c.updatedAt.getTime() > FRESH_SNAPSHOT_MS) return false;
    const limit = limitMinutesByOrg.get(c.organizationId) ?? DEFAULT_TEAM_IDLE_ALERT_MINUTES;
    if (now.getTime() - c.idleSince.getTime() < limit * 60_000) return false;
    return !alreadyAlerted.has(`${c.userId}:${c.idleSince.toISOString()}`);
  });
}

/**
 * Team Lead feature B: when one of their agents has been idle longer than
 * the organization's limit (Settings, default 10 min), the Team Lead gets
 * one alert per idle episode. Working time only - never in breaks.
 */
@Injectable()
export class TeamIdleAlertsService {
  private readonly logger = new Logger(TeamIdleAlertsService.name);
  private readonly alerted = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkIdleAgents(now: Date = new Date()) {
    if (!isWithinShift(now) || isScheduledBreakTime(now)) return;
    const idleLogs = await this.prisma.idleTimeLog.findMany({
      where: { date: getShiftDayString(now), lastState: 'IDLE', idleSince: { not: null } },
      select: {
        userId: true,
        organizationId: true,
        idleSince: true,
        updatedAt: true,
        user: { select: { firstName: true, lastName: true, managerId: true } },
      },
    });
    if (idleLogs.length === 0) return;

    const orgIds = [...new Set(idleLogs.map((l) => l.organizationId))];
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, activityConfig: true },
    });
    const limits = new Map(
      orgs.map((o) => [o.id, Number((o.activityConfig as any)?.teamIdleAlertMinutes) || DEFAULT_TEAM_IDLE_ALERT_MINUTES]),
    );

    const due = agentsToAlert(
      idleLogs.map((l) => ({
        userId: l.userId,
        organizationId: l.organizationId,
        idleSince: l.idleSince!,
        updatedAt: l.updatedAt,
        teamLeadId: l.user?.managerId || null,
        name: `${l.user?.firstName || ''} ${l.user?.lastName || ''}`.trim() || 'An agent',
      })),
      limits,
      this.alerted,
      now,
    );

    for (const agent of due) {
      this.alerted.add(`${agent.userId}:${agent.idleSince.toISOString()}`);
      try {
        await this.notificationsService.createSystemNotification({
          organizationId: agent.organizationId,
          recipientType: NotificationRecipientType.EMPLOYEE,
          recipientUserId: agent.teamLeadId!,
          type: NotificationType.AGENT_IDLE_ALERT,
          title: 'Agent Idle',
          message: `${agent.name} has been idle for ${formatIdleDuration(now.getTime() - agent.idleSince.getTime())} (since ${formatKarachiTime(agent.idleSince)})`,
          metadata: { agentId: agent.userId, idleSince: agent.idleSince.toISOString() },
        });
      } catch (err) {
        this.logger.warn(`Could not alert Team Lead about ${agent.userId}: ${err}`);
      }
    }
    if (this.alerted.size > 5000) this.alerted.clear();
  }
}
