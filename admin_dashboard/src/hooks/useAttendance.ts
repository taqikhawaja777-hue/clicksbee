/**
 * useAttendance — Custom React hook for real-time attendance data
 *
 * Returns: { todayRecord, isLoading, clockIn(), clockOut(), refresh() }
 */
import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api.service';

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string;
  status: string; // PRESENT, ABSENT, LATE, etc.
  checkInTime: string | null;
  checkOutTime: string | null;
  hoursLogged: number;
  isCheckedIn: boolean;
}

export interface UseAttendanceResult {
  todayRecord: AttendanceRecord | null;
  isLoading: boolean;
  error: string | null;
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAttendance(userId: string | null): UseAttendanceResult {
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch today's attendance record
   */
  const fetchToday = useCallback(async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      setError(null);

      const today = new Date().toISOString().split('T')[0];
      const data: any = await apiService.getAttendance({ date: today, userId });

      let record: any = null;
      if (Array.isArray(data)) {
        record = data.find((r: any) => r.userId === userId) || data[0];
      } else if (data?.data) {
        record = Array.isArray(data.data)
          ? data.data.find((r: any) => r.userId === userId) || data.data[0]
          : data.data;
      } else {
        record = data;
      }

      if (record) {
        setTodayRecord({
          id: record.id || '',
          userId: record.userId || userId,
          date: record.date || today,
          status: record.status || 'ABSENT',
          checkInTime: record.checkInTime || record.clockIn || null,
          checkOutTime: record.checkOutTime || record.clockOut || null,
          hoursLogged: record.hoursLogged || record.totalHours || 0,
          isCheckedIn: !!(record.checkInTime || record.clockIn) && !(record.checkOutTime || record.clockOut),
        });
      } else {
        setTodayRecord(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch attendance');
      console.warn('[useAttendance] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  /**
   * Clock In
   */
  const clockIn = useCallback(async () => {
    if (!userId) return;
    try {
      setIsLoading(true);
      await apiService.checkIn(userId);
      await fetchToday(); // Refresh after clock-in
    } catch (err: any) {
      setError(err.message || 'Clock-in failed');
    } finally {
      setIsLoading(false);
    }
  }, [userId, fetchToday]);

  /**
   * Clock Out
   */
  const clockOut = useCallback(async () => {
    if (!userId) return;
    try {
      setIsLoading(true);
      await apiService.checkOut(userId);
      await fetchToday(); // Refresh after clock-out
    } catch (err: any) {
      setError(err.message || 'Clock-out failed');
    } finally {
      setIsLoading(false);
    }
  }, [userId, fetchToday]);

  // Auto-fetch on mount / userId change
  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  return {
    todayRecord,
    isLoading,
    error,
    clockIn,
    clockOut,
    refresh: fetchToday,
  };
}

export default useAttendance;
