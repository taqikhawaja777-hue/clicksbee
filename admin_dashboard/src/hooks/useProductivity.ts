/**
 * useProductivity — polls GET /api/tasks/{taskId}/productivity every 15s
 * while a task is active. This is a live preview against the backend's own
 * calculation (sourced from Jibble time entries); it never computes the
 * score itself.
 */
import { useEffect, useRef, useState } from 'react';
import { productivityApiService } from '../services/productivityApi.service';

export interface UseProductivityResult {
  trackedMs: number;
  score: number;
  loading: boolean;
}

const POLL_INTERVAL_MS = 15000;

export function useProductivity(taskId: string | null): UseProductivityResult {
  const [trackedMs, setTrackedMs] = useState<number>(0);
  const [score, setScore] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!taskId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchProductivity = async () => {
      try {
        const data = await productivityApiService.getTaskProductivity(taskId);
        if (cancelled) return;
        setTrackedMs(data.trackedMs);
        setScore(data.score);
      } catch (err) {
        console.warn('[useProductivity] Failed to fetch productivity:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    fetchProductivity();
    intervalRef.current = setInterval(fetchProductivity, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [taskId]);

  return { trackedMs, score, loading };
}

export default useProductivity;
