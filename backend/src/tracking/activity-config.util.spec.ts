import { BadRequestException } from '@nestjs/common';
import { activityFields, sanitizeBreakdown, sanitizeKeywords } from './activity-config.util';

describe('activity-config.util', () => {
  it('cleans keyword lists and rejects bad input', () => {
    expect(sanitizeKeywords([' YouTube ', 'youtube', '', 'Netflix'])).toEqual(['youtube', 'netflix']);
    expect(() => sanitizeKeywords('youtube')).toThrow(BadRequestException);
    expect(() => sanitizeKeywords(Array.from({ length: 101 }, (_, i) => `k${i}`))).toThrow(/At most 100/);
    expect(() => sanitizeKeywords(['x'.repeat(61)])).toThrow(/60 characters/);
  });

  it('keeps only known breakdown fields as whole non-negative numbers', () => {
    expect(sanitizeBreakdown({ callSeconds: 120.6, callCount: -3, hacked: 9 })).toEqual({
      callSeconds: 121,
      callCount: 0,
      dialingSeconds: 0,
      otherWorkSeconds: 0,
      unproductiveSeconds: 0,
      suspiciousSeconds: 0,
      longestNoCallGapSeconds: 0,
      spreadsheetSeconds: 0,
    });
    expect(sanitizeBreakdown(null)).toBeNull();
  });

  it('report fields: zeros for old-app days, live state only while fresh', () => {
    const now = new Date('2026-11-17T10:00:00Z');
    expect(activityFields(null, now)).toMatchObject({ hasCallTracking: false, callCount: 0, activityState: null });
    const fresh = activityFields(
      { activityBreakdown: { callSeconds: 600, callCount: 4 }, lastState: 'ON_CALL', updatedAt: new Date('2026-11-17T09:59:00Z') },
      now,
    );
    expect(fresh).toMatchObject({ hasCallTracking: true, callSeconds: 600, callCount: 4, activityState: 'ON_CALL' });
    const stale = activityFields({ activityBreakdown: {}, lastState: 'ON_CALL', updatedAt: new Date('2026-11-17T09:50:00Z') }, now);
    expect(stale.activityState).toBeNull();
  });
});
