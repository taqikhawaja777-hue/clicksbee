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
    idleEpisode: { updateMany: jest.fn(async () => ({ count: 1 })) },
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
    const { service, created, prisma } = setup();
    await service.recordIdleEvent(
      'u1',
      'org',
      { event: 'IDLE_ENDED', idleSince: IDLE_SINCE, endedAt: '2026-11-13T10:55:00.000Z' },
      new Date('2026-11-13T10:55:05.000Z'),
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ recipientType: 'EMPLOYEE', title: 'Back from Idle' });
    expect(created[0].message).toBe('Active again at 3:55 PM after 13 min idle (3:42 PM - 3:55 PM)');
    // ...and closes that idle period in the Idle Alert Report.
    expect(prisma.idleEpisode.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', idleSince: new Date(IDLE_SINCE) },
      data: { endedAt: new Date('2026-11-13T10:55:00.000Z') },
    });
  });

  it('never alerts during a scheduled break or outside the shift', async () => {
    const { service, created } = setup();
    // 14:30 Karachi = the only break (2:00-3:00 PM)
    const breakTime = new Date('2026-11-13T09:30:00.000Z');
    expect((await service.recordIdleEvent('u1', 'org', { event: 'IDLE_STARTED', idleSince: '2026-11-13T09:28:00.000Z' }, breakTime)).recorded).toBe(false);
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

  it('no-call gap alerts the manager and logs it for the employee', async () => {
    const { service, created } = setup();
    // last call ended 3:20 PM, now 3:44 PM
    await service.recordIdleEvent('u1', 'org', { event: 'NO_CALL_GAP', idleSince: '2026-11-13T10:20:00.000Z' }, NOW);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ recipientType: 'ADMIN', type: 'NO_CALL_ALERT', title: 'No Calls' });
    expect(created[0].message).toBe('Ali Raza has not been on a call since 3:20 PM (24 min)');
    expect(created[1]).toMatchObject({ recipientType: 'EMPLOYEE', recipientUserId: 'u1', type: 'NO_CALL_ALERT' });
  });

  it('suspicious activity alert carries the detected pattern', async () => {
    const { service, created } = setup();
    await service.recordIdleEvent(
      'u1',
      'org',
      { event: 'SUSPICIOUS_ACTIVITY', idleSince: IDLE_SINCE, reason: 'Mouse jiggling: only tiny cursor movements' },
      NOW,
    );
    expect(created[0]).toMatchObject({ recipientType: 'ADMIN', type: 'SUSPICIOUS_ACTIVITY' });
    expect(created[0].message).toContain('Mouse jiggling');
    expect(created[1].message).toContain('Unusual activity detected at 3:42 PM');
  });

  it('formats durations', () => {
    expect(formatIdleDuration(30_000)).toBe('1 min');
    expect(formatIdleDuration(13 * 60_000)).toBe('13 min');
    expect(formatIdleDuration(75 * 60_000)).toBe('1 h 15 min');
  });
});
