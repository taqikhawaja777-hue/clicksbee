/**
 * useIdleTimeSummary — polls GET /api/idle-time/summary every 5s.
 *
 * Drives both the Manager Supervisor Portal's live status card and the
 * "Today, per employee" table on the Idle Time page. Polling (not push)
 * by design: the idle-time backend is the FastAPI + Supabase productivity
 * service, which has no Socket.IO server of its own, unlike the main
 * NestJS API.
 *
 * 5s rather than the underlying trackers' own 20s cadence (idleTimeTracker
 * .ts / presenceDetector.ts both post on a 20s cycle - that's the true
 * floor on how often the *data* itself can change) - polling faster than
 * the data changes still meaningfully cuts the average wait to see a
 * change that already landed, from ~10s (half of a 20s poll) down to
 * ~2.5s, without touching how often the camera/input trackers themselves
 * run (that cadence has real cost - CPU, camera negotiation - this read
 * doesn't).
 *
 * Also refetches immediately on a 'worktrackpro:shift-state-changed'
 * window event - dispatched by EmployeeContext.tsx right after a
 * check-in/check-out/break action succeeds - so this employee's OWN
 * status change is reflected instantly rather than waiting even 5s.
 * Only helps when both are in the same renderer (e.g. testing solo); a
 * genuinely separate manager window still just relies on its own next
 * poll, unchanged.
 */
import { useEffect, useRef, useState } from 'react';
import { productivityApiService, IdleTimeSummary } from '../services/productivityApi.service';

const POLL_INTERVAL_MS = 5000;
export const SHIFT_STATE_CHANGED_EVENT = 'worktrackpro:shift-state-changed';

export interface UseIdleTimeSummaryResult {
  summary: IdleTimeSummary | null;
  loading: boolean;
}

export function useIdleTimeSummary(): UseIdleTimeSummaryResult {
  const [summary, setSummary] = useState<IdleTimeSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchSummary = async () => {
      try {
        const data = await productivityApiService.getIdleTimeSummary();
        if (!cancelled) setSummary(data);
      } catch (err) {
        console.warn('[useIdleTimeSummary] Failed to fetch idle-time summary:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSummary();
    intervalRef.current = setInterval(fetchSummary, POLL_INTERVAL_MS);
    window.addEventListener(SHIFT_STATE_CHANGED_EVENT, fetchSummary);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      window.removeEventListener(SHIFT_STATE_CHANGED_EVENT, fetchSummary);
    };
  }, []);

  return { summary, loading };
}

export default useIdleTimeSummary;
