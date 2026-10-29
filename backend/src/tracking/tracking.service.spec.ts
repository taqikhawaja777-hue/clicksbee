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
    expect(summary1.productivityPercentage).toBe(33.7);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

    // Second call hits cache - no additional DB queries
    const summary2 = await service.getShiftSummary('org-1', 'user-1', '2026-10-26');
    expect(summary2.productivityPercentage).toBe(33.7);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
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
