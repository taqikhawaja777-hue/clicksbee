import { BadRequestException } from '@nestjs/common';
import { formatIdleDuration, IdleAlertsService } from './idle-alerts.service';

// 2026-11-13 15:42 Asia/Karachi = 10:42 UTC (inside shift, not a break)
const NOW = new Date('2026-11-13T10:44:00.000Z');
const IDLE_SINCE = '2026-11-13T10:42:00.000Z';

function setup(existingDuplicate = false) {
  const created: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ firstName: 'Ali', lastName: 'Raza', organizationId: 'org' })) },
    notification: { findFirst: jest.fn(async () => (existingDuplicate ? { id: 'n1' } : null)) },
  };
  const notifications: any = { createSystemNotification: jest.fn(async (n) => created.push(n)) };
  return { service: new IdleAlertsService(prisma, notifications), created, prisma };
}

describe('IdleAlertsService', () => {
  it('idle start alerts the manager feed and logs it for the employee', async () => {
    const { service, created } = setup();
    const res = await service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: IDLE_SINCE }, NOW);
    expect(res).toEqual({ recorded: true });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ recipientType: 'ADMIN', type: 'IDLE_ALERT', title: 'Idle Alert' });
    expect(created[0].message).toBe('Ali Raza has been idle since 3:42 PM - no mouse or keyboard activity for 2+ minutes');
    expect(created[1]).toMatchObject({ recipientType: 'EMPLOYEE', recipientUserId: 'u1', type: 'IDLE_ALERT' });
  });

  it('coming back logs the idle duration for the employee only', async () => {
    const { service, created } = setup();
    await service.recordIdleEvent(
      'u1',
      'org',
      { event: 'IDLE_ENDED', idleSince: IDLE_SINCE, endedAt: '2026-11-13T10:55:00.000Z' },
      new Date('2026-11-13T10:55:05.000Z'),
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ recipientType: 'EMPLOYEE', title: 'Back from Idle' });
    expect(created[0].message).toBe('Active again at 3:55 PM after 13 min idle (3:42 PM - 3:55 PM)');
  });

  it('never alerts during a scheduled break or outside the shift', async () => {
    const { service, created } = setup();
    // 13:45 Karachi = lunch & Zuhr break
    const lunch = new Date('2026-11-13T08:45:00.000Z');
    expect((await service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: '2026-11-13T08:43:00.000Z' }, lunch)).recorded).toBe(false);
    // 19:30 Karachi = after shift
    const late = new Date('2026-11-13T14:30:00.000Z');
    expect((await service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: '2026-11-13T14:28:00.000Z' }, late)).recorded).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('ignores a retried duplicate and rejects stale or future timestamps', async () => {
    const dup = setup(true);
    expect(await dup.service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: IDLE_SINCE }, NOW)).toEqual({ recorded: false, reason: 'Duplicate' });
    expect(dup.created).toHaveLength(0);

    const { service } = setup();
    await expect(service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: '2026-11-12T10:00:00.000Z' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: '2026-11-13T11:30:00.000Z' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('formats durations', () => {
    expect(formatIdleDuration(30_000)).toBe('1 min');
    expect(formatIdleDuration(13 * 60_000)).toBe('13 min');
    expect(formatIdleDuration(75 * 60_000)).toBe('1 h 15 min');
  });
});
