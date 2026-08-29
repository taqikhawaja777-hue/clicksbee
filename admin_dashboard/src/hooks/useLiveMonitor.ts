/**
 * useLiveMonitor — Custom React hook for real-time employee monitoring data
 *
 * Returns: { activityData, isLive, lastUpdated, isLoading, error }
 * Manages WebSocket subscription per selected employee and 60s polling fallback.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { socketService } from '../services/socket.service';
import { apiService } from '../services/api.service';

export interface LiveActivityData {
  employeeId: string;
  summary: string;
  status: string;
  activeWindow: string;
  confidenceScore: number;
  taskRelevance: string;
  activityType: string;
  productivityScore?: number;
  detectedApps?: string[];
  concerns?: string[];
  imageUrl?: string;
  timestamp: string;
}

export interface UseLiveMonitorResult {
  activityData: LiveActivityData | null;
  isLive: boolean;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLiveMonitor(employeeId: string | null): UseLiveMonitorResult {
  const [activityData, setActivityData] = useState<LiveActivityData | null>(null);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const previousEmployeeId = useRef<string | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  /**
   * Fetch the latest live data from the REST API
   */
  const fetchLiveData = useCallback(async () => {
    if (!employeeId) return;

    try {
      setIsLoading(true);
      setError(null);

      // Try primary endpoint first, fallback to secondary
      let data: any = null;
      try {
        data = await apiService.getLiveSummary(employeeId);
      } catch {
        try {
          data = await apiService.getEmployeeSummary(employeeId);
        } catch {
          data = await apiService.getLiveEmployee(employeeId);
        }
      }

      if (data) {
        const mapped: LiveActivityData = {
          employeeId,
          summary: data.latestScreenSummary?.aiSummary || data.summary || data.aiSummary || 'Awaiting analysis...',
          status: data.productivityStatus || data.status || data.liveStatus || 'ACTIVE',
          activeWindow: data.latestScreenSummary?.activeWindow || data.activeWindow || 'Desktop',
          confidenceScore: data.aiConfidenceScore || data.confidenceScore || 0,
          taskRelevance: data.taskRelevance || 'Yes',
          activityType: data.activityType || 'Work Activity',
          productivityScore: data.productivityScore || data.aiConfidenceScore || 0,
          detectedApps: data.detectedApps || [],
          concerns: data.concerns || [],
          imageUrl: data.latestScreenSummary?.imageUrl || data.imageUrl || null,
          timestamp: data.latestScreenSummary?.capturedAt || data.timestamp || new Date().toISOString(),
        };
        setActivityData(mapped);
        setLastUpdated(new Date());
        setIsLive(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch live data');
      console.warn('[useLiveMonitor] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) {
      setActivityData(null);
      setIsLive(false);
      return;
    }

    // Unsubscribe from previous employee
    if (previousEmployeeId.current && previousEmployeeId.current !== employeeId) {
      socketService.unsubscribe(previousEmployeeId.current);
    }
    previousEmployeeId.current = employeeId;

    // 1. Initial fetch
    fetchLiveData();

    // 2. Subscribe to WebSocket updates for this employee
    socketService.subscribe(employeeId);

    const handleUpdate = (data: any) => {
      if (!data) return;
      setActivityData((prev) => ({
        employeeId,
        summary: data.summary || prev?.summary || 'Activity update received',
        status: data.status || prev?.status || 'ON TRACK',
        activeWindow: data.activeWindow || prev?.activeWindow || 'Desktop',
        confidenceScore: data.confidenceScore || prev?.confidenceScore || 0,
        taskRelevance: data.taskRelevance || prev?.taskRelevance || 'Yes',
        activityType: data.activityType || prev?.activityType || 'Work Activity',
        productivityScore: data.productivityScore || prev?.productivityScore || 0,
        detectedApps: data.detectedApps || prev?.detectedApps || [],
        concerns: data.concerns || prev?.concerns || [],
        imageUrl: data.imageUrl || prev?.imageUrl || null,
        timestamp: data.timestamp || new Date().toISOString(),
      }));
      setLastUpdated(new Date());
      setIsLive(true);
    };

    // Listen on employee-specific channel
    socketService.on(`employee:update:${employeeId}`, handleUpdate);
    socketService.on('employee:activity:update', (data: any) => {
      if (data?.employeeId === employeeId) handleUpdate(data);
    });

    // 3. Set up 60-second polling fallback
    pollingInterval.current = setInterval(() => {
      console.log(`[useLiveMonitor] 60s poll for employee: ${employeeId}`);
      fetchLiveData();
    }, 60000);

    // Cleanup
    return () => {
      socketService.off(`employee:update:${employeeId}`, handleUpdate);
      socketService.unsubscribe(employeeId);
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, [employeeId, fetchLiveData]);

  return {
    activityData,
    isLive,
    lastUpdated,
    isLoading,
    error,
    refresh: fetchLiveData,
  };
}

export default useLiveMonitor;
