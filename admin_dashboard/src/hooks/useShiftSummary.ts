/**
 * useShiftSummary — polls GET /api/shift/summary/{employeeId} every 5s (see
 * useIdleTimeSummary.ts for why 5s rather than the underlying trackers'
 * own 20s data-producing cadence).
 *
 * THE single source of truth for one employee's active/idle/break/shift-
 * duration/camera/status numbers, mirroring ProductivityService
 * .get_shift_summary() on the backend. Every component that shows these
 * numbers for one employee (EmployeeContext's Shift Live Counter,
 * PresenceVerificationCard) should read from this hook rather than
 * recomputing anything independently - see the "Today, per employee"
 * table's own consumer, useIdleTimeSummary, which delegates to the exact
 * same backend calculation for the all-employees case.
 *
 * Adds a thin local 1-second ticker on top of the poll so the Shift Live
 * Counter reads as continuously live rather than jumping once per poll -
 * it only advances while the employee is in an actively-working status
 * (not on break/checked out/not checked in), so the counter visibly
 * freezes the instant a break starts, and re-snaps to the server's
 * authoritative value on every poll to correct any drift.
 *
 * Exposes `refresh()` so an action that just changed server-side state
 * (check-in/check-out/break start/end) can force an immediate refetch
 * instead of leaving the UI showing stale status for up to one full 20s
 * poll interval.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { productivityApiService, ShiftSummary } from '../services/productivityApi.service';

const POLL_INTERVAL_MS = 5000;
const TICK_INTERVAL_MS = 1000;

const TICKING_STATUSES = new Set(['ACTIVE', 'ACTIVE_JABBER', 'ACTIVE_WILDIX', 'IDLE', 'AWAY']);

export interface UseShiftSummaryResult {
  summary: ShiftSummary | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useShiftSummary(employeeId: string | null | undefined): UseShiftSummaryResult {
  const [serverSummary, setServerSummary] = useState<ShiftSummary | null>(null);
  const [displaySummary, setDisplaySummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const employeeIdRef = useRef(employeeId);
  employeeIdRef.current = employeeId;

  const fetchSummary = useCallback(async () => {
    const currentId = employeeIdRef.current;
    if (!currentId) return;
    try {
      const data = await productivityApiService.getShiftSummary(currentId);
      setServerSummary(data);
    } catch (err) {
      console.warn('[useShiftSummary] Failed to fetch shift summary:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!employeeId) {
      setServerSummary(null);
      setDisplaySummary(null);
      setLoading(false);
      return;
    }

    fetchSummary();
    const interval = setInterval(fetchSummary, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [employeeId, fetchSummary]);

  useEffect(() => {
    setDisplaySummary(serverSummary);
    if (!serverSummary || !TICKING_STATUSES.has(serverSummary.status)) {
      return;
    }
    const tick = setInterval(() => {
      setDisplaySummary((prev) =>
        prev ? { ...prev, shiftDurationSeconds: prev.shiftDurationSeconds + 1 } : prev,
      );
    }, TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [serverSummary]);

  return { summary: displaySummary, loading, refresh: fetchSummary };
}

export default useShiftSummary;
