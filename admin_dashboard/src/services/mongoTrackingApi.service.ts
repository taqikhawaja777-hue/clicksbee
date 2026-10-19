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

  async listEmployees(): Promise<Employee[]> {
    const payload: any = unwrap(await apiService.get('/employees/all'));
    const rows: any[] = Array.isArray(payload) ? payload : payload?.data || [];
    return rows.map((employee) => ({
      id: employee.id,
      fullName: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      email: employee.email,
      jibbleMemberId: null,
      cameraMonitoringEnabled: false,
      role: employee.role || 'EMPLOYEE',
    }));
  }
}

export type { DailyReportRow, Employee, EmployeeIdleStatus, IdleTimeSummary, ShiftSummary };
export const mongoTrackingApiService = new MongoTrackingApiService();
export default mongoTrackingApiService;
