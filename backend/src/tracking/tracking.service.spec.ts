import { TrackingService } from './tracking.service';

describe('TrackingService Performance & Batching', () => {
  let service: TrackingService;
  let mockPrisma: any;
  let mockRedis: any;

  // Haider Ali 2026-10-26 with shiftDurationSeconds = 17500s
  // 19900 - 2400 (break) = 17500 seconds net shift duration
  const clockIn = new Date('2026-10-26T04:00:00Z');
  const clockOut = new Date(clockIn.getTime() + 19900 * 1000);

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-1', firstName: 'Haider', lastName: 'Ali', email: 'haider@example.com' },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1', firstName: 'Haider', lastName: 'Ali', email: 'haider@example.com',
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1', organizationId: 'org-1',
        }),
      },
      attendance: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'user-1', date: '2026-10-26', clockIn, clockOut },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          clockIn, clockOut,
        }),
      },
      idleTimeLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'user-1', date: '2026-10-26', activeSeconds: 12780, idleSeconds: 4680,
            appFocusSeconds: { 'cisco jabber': 4080 }, lastIsIdle: false, updatedAt: new Date('2026-10-26T12:00:00Z'),
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          activeSeconds: 12780, idleSeconds: 4680,
          appFocusSeconds: { 'cisco jabber': 4080 }, lastIsIdle: false, updatedAt: new Date('2026-10-26T12:00:00Z'),
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      breakSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const memoryCache = new Map<string, string>();
    mockRedis = {
      get: jest.fn().mockImplementation((k: string) => Promise.resolve(memoryCache.get(k) || null)),
      set: jest.fn().mockImplementation((k: string, v: string) => {
        memoryCache.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((k: string) => {
        memoryCache.delete(k);
        return Promise.resolve();
      }),
    };

    service = new TrackingService(mockPrisma as any, mockRedis as any);
  });

  it('batches date-range queries into a single multi-date query instead of N queries', async () => {
    const report = await service.getAttendanceReport('org-1', '2026-10-25', '2026-10-27');
    expect(report.rows.length).toBe(3);
    // Across 3 days, user.findMany was called ONCE, not 3 times
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
    // attendance.findMany called ONCE with date: { in: dates }
    expect(mockPrisma.attendance.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.idleTimeLog.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.breakSession.findMany).toHaveBeenCalledTimes(1);
  });

  it('getShiftSummary reads user directly and caches the result', async () => {
    const summary1 = await service.getShiftSummary('org-1', 'user-1', '2026-10-26');
    expect(summary1.employeeId).toBe('user-1');
    expect(summary1.productivityPercentage).toBe(31.7); // 95% App Focus + 5% Compliance
    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

    // Second call hits cache - no additional DB queries
    const summary2 = await service.getShiftSummary('org-1', 'user-1', '2026-10-26');
    expect(summary2.productivityPercentage).toBe(31.7);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('counts the 3CX web dialer (and legacy Wildix time) as dialer time', async () => {
    const focus = { '3CX': 3000, Wildix: 600, 'cisco jabber': 480, Other: 900 };
    mockPrisma.idleTimeLog.findUnique.mockResolvedValueOnce({
      activeSeconds: 12780, idleSeconds: 4680, appFocusSeconds: focus, lastIsIdle: false, updatedAt: new Date('2026-10-26T12:00:00Z'),
    });
    const summary: any = await service.getShiftSummary('org-1', 'user-1', '2026-10-26');
    expect(summary.threeCxSeconds).toBe(3600);
    expect(summary.jabberSeconds).toBe(480);
    expect(summary).not.toHaveProperty('wildixSeconds');
  });

  it('stores the call breakdown (capped to active time) and returns it in summaries', async () => {
    await service.upsertIdleSnapshot({
      userId: 'user-1',
      date: '2026-10-26',
      activeSeconds: 3000,
      idleSeconds: 100,
      activityBreakdown: { callSeconds: 9999, callCount: 12, unproductiveSeconds: 300 },
      lastState: 'ON_CALL',
    });
    const saved = mockPrisma.idleTimeLog.upsert.mock.calls[0][0];
    expect(saved.update.activityBreakdown).toMatchObject({ callSeconds: 3000, callCount: 12, unproductiveSeconds: 300 });
    expect(saved.update.lastState).toBe('ON_CALL');

    // An older app (no breakdown) must not wipe what is stored.
    await service.upsertIdleSnapshot({ userId: 'user-1', date: '2026-10-26', activeSeconds: 3100, idleSeconds: 100 });
    expect(mockPrisma.idleTimeLog.upsert.mock.calls[1][0].update).not.toHaveProperty('activityBreakdown');

    mockPrisma.idleTimeLog.findUnique.mockResolvedValueOnce({
      activeSeconds: 3000, idleSeconds: 100, appFocusSeconds: { '3CX': 2400 }, lastIsIdle: false,
      activityBreakdown: { callSeconds: 2100, callCount: 12, longestNoCallGapSeconds: 840 }, lastState: 'ON_CALL',
      updatedAt: new Date('2026-10-26T12:00:00Z'),
    });
    const summary: any = await service.getShiftSummary('org-1', 'user-1', '2026-10-26');
    expect(summary).toMatchObject({ callSeconds: 2100, callCount: 12, longestNoCallGapSeconds: 840, hasCallTracking: true });
  });

  it('keeps spreadsheet time inside active time and tells Admin once when it passes the limit', async () => {
    const notifications = { createSystemNotification: jest.fn().mockResolvedValue({}) };
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', organizationId: 'org-1', firstName: 'Haider', lastName: 'Ali' });
    mockPrisma.organization = { findUnique: jest.fn().mockResolvedValue({ activityConfig: {} }) }; // default limit 60 min
    const withAlerts = new TrackingService(mockPrisma as any, mockRedis as any, notifications as any);
    const stored = (spreadsheetSeconds: number) => ({
      activeSeconds: 5000, idleSeconds: 0, appFocusSeconds: {}, activityBreakdown: { spreadsheetSeconds },
    });
    const send = (spreadsheetSeconds: number) =>
      withAlerts.upsertIdleSnapshot({
        userId: 'user-1', date: '2026-10-26', activeSeconds: 5000, idleSeconds: 0, activityBreakdown: { spreadsheetSeconds },
      });

    // 58 min -> 61 min: crosses the 1-hour limit -> one Admin notification.
    mockPrisma.idleTimeLog.findUnique.mockResolvedValueOnce(stored(3480));
    await send(3660);
    expect(notifications.createSystemNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createSystemNotification.mock.calls[0][0]).toMatchObject({
      recipientType: 'ADMIN',
      type: 'SPREADSHEET_LIMIT',
      message: 'Haider Ali has used Excel / spreadsheets for more than 1 h this shift (2026-10-26)',
    });

    // Already over the limit -> no repeat.
    mockPrisma.idleTimeLog.findUnique.mockResolvedValueOnce(stored(3660));
    await send(4000);
    expect(notifications.createSystemNotification).toHaveBeenCalledTimes(1);

    // Never more than the active time it is part of.
    mockPrisma.idleTimeLog.findUnique.mockResolvedValueOnce(null);
    await send(9999);
    expect(mockPrisma.idleTimeLog.upsert.mock.calls[2][0].update.activityBreakdown.spreadsheetSeconds).toBe(5000);
  });

  it('upsertIdleSnapshot invalidates summary cache', async () => {
    await service.getShiftSummary('org-1', 'user-1', '2026-10-26');
    expect(mockRedis.set).toHaveBeenCalled();

    await service.upsertIdleSnapshot({
      userId: 'user-1',
      date: '2026-10-26',
      activeSeconds: 13000,
      idleSeconds: 4000,
    });

    expect(mockRedis.del).toHaveBeenCalledWith('cache:shiftsummary:org-1:user-1:2026-10-26');
    expect(mockRedis.del).toHaveBeenCalledWith('cache:summary:org-1:2026-10-26');
  });
});
