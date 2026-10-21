/**
 * MongoDB-backed reporting client.  This deliberately keeps the legacy view
 * shapes so existing portal components do not need a visual rewrite, while
 * removing their dependency on the retired Supabase/FastAPI service.
 */
import { apiService } from './api.service';
import type {
  DailyReportRow,
  Employee,
  EmployeeIdleStatus,
  IdleTimeSummary,
  ShiftSummary,
} from './productivityApi.service';

function unwrap<T>(payload: any): T {
  return (payload?.data ?? payload) as T;
}

class MongoTrackingApiService {
  async getIdleTimeSummary(date?: string): Promise<IdleTimeSummary> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return unwrap<IdleTimeSummary>(await apiService.get(`/tracking/idle-summary${query}`));
  }

  async getAttendanceReport(startDate: string, endDate: string): Promise<{ rows: DailyReportRow[] }> {
    const query = new URLSearchParams({ startDate, endDate });
    return unwrap<{ rows: DailyReportRow[] }>(await apiService.get(`/tracking/attendance-report?${query}`));
  }

  async getProductivityReport(startDate: string, endDate: string): Promise<{ rows: DailyReportRow[] }> {
    const query = new URLSearchParams({ startDate, endDate });
    return unwrap<{ rows: DailyReportRow[] }>(await apiService.get(`/tracking/productivity-report?${query}`));
  }

  async getShiftSummary(employeeId: string, date?: string): Promise<ShiftSummary> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return unwrap<ShiftSummary>(await apiService.get(`/tracking/shift-summary/${employeeId}${query}`));
  }

  async getCameraConfig(): Promise<CameraConfig> {
    try {
      const res = unwrap<CameraConfig>(await apiService.get('/tracking/camera-config'));
      if (res && typeof res.globallyEnabled === 'boolean') {
        localStorage.setItem('worktrackpro_camera_config', JSON.stringify(res));
        return res;
      }
    } catch (e) {
      console.warn('Failed to fetch camera config from backend, using local store:', e);
    }
    const local = localStorage.getItem('worktrackpro_camera_config');
    if (local) {
      try { return JSON.parse(local); } catch {}
    }
    return { globallyEnabled: true, employeeConfigs: {} };
  }

  async saveCameraConfig(updates: { globallyEnabled?: boolean; employeeConfigs?: Record<string, boolean> }): Promise<CameraConfig> {
    const current = await this.getCameraConfig();
    const next: CameraConfig = {
      globallyEnabled: updates.globallyEnabled !== undefined ? updates.globallyEnabled : current.globallyEnabled,
      employeeConfigs: { ...current.employeeConfigs, ...(updates.employeeConfigs || {}) },
    };
    localStorage.setItem('worktrackpro_camera_config', JSON.stringify(next));
    try {
      await apiService.post('/tracking/camera-config', next);
    } catch (e) {
      console.warn('Failed to save camera config to backend:', e);
    }
    return next;
  }

  async listEmployees(): Promise<Employee[]> {
    const payload: any = unwrap(await apiService.get('/employees/all'));
    const rows: any[] = Array.isArray(payload) ? payload : payload?.data || [];
    const config = await this.getCameraConfig();
    return rows.map((employee) => {
      const empEnabled = config.employeeConfigs[employee.id] !== undefined
        ? config.employeeConfigs[employee.id]
        : true; // Default to true if not explicitly toggled off
      return {
        id: employee.id,
        fullName: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        email: employee.email,
        jibbleMemberId: null,
        cameraMonitoringEnabled: config.globallyEnabled && empEnabled,
        role: employee.role || 'EMPLOYEE',
      };
    });
  }
}

export interface CameraConfig {
  globallyEnabled: boolean;
  employeeConfigs: Record<string, boolean>;
}

export type { DailyReportRow, Employee, EmployeeIdleStatus, IdleTimeSummary, ShiftSummary };
export const mongoTrackingApiService = new MongoTrackingApiService();
export default mongoTrackingApiService;
