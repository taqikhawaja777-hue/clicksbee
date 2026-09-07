/**
 * Productivity API Service — client for the standalone FastAPI + Supabase
 * productivity-tracking service (see /productivity_service at the repo
 * root). This is a separate backend from the NestJS API that api.service.ts
 * talks to, so it gets its own base URL and its own thin client.
 *
 * Task time now comes from Jibble (synced server-side), not this app's own
 * capture agent — the frontend still never computes the score itself, it
 * only displays trackedMs/score as returned by the backend.
 */

const PRODUCTIVITY_API_BASE_URL =
  (import.meta as any).env?.VITE_PRODUCTIVITY_API_URL || 'http://localhost:8000';

export interface TaskProductivity {
  taskId: string;
  trackedMs: number;
  score: number;
}

export interface Ticket {
  id: string;
  taskId: string;
  employeeId: string;
  startedAt: string;
  endedAt: string;
  trackedMs: number;
  productivityScore: number;
  source: string;
  createdAt: string;
}

export interface PaginatedTickets {
  items: Ticket[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActiveEmployee {
  employeeId: string;
  employeeName: string;
  taskId: string;
  taskTitle: string;
  trackedMinutes: number;
  score: number;
}

export interface DashboardSummary {
  avgProductivity: number;
  activeEmployeeCount: number;
  ticketsGeneratedToday: number;
}

export interface Task {
  id: string;
  employeeId: string;
  title: string;
  status: 'in_progress' | 'completed';
  estimatedMinutes: number | null;
  jibbleActivityId: string | null;
  createdAt: string;
}

export interface Employee {
  id: string;
  fullName: string;
  email: string;
  jibbleMemberId: string | null;
  cameraMonitoringEnabled: boolean;
  role: string;
}

export interface IdleTimeLog {
  id: string;
  employeeId: string;
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  appFocusSeconds: Record<string, number>;
  totalLoggedSeconds: number;
  lastActiveApp: string | null;
  lastIsIdle: boolean;
  createdAt: string;
  updatedAt: string;
}

export type IdleStatus =
  | 'NOT_CHECKED_IN'
  | 'CHECKED_OUT'
  | 'ON_BREAK'
  | 'ACTIVE_JABBER'
  | 'ACTIVE_WILDIX'
  | 'ACTIVE'
  | 'IDLE'
  | 'AWAY';

export interface EmployeeIdleStatus {
  employeeId: string;
  employeeName: string;
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  jabberSeconds: number;
  wildixSeconds: number;
  productivityPercentage: number;
  status: IdleStatus;
  updatedAt: string;
  isOnBreak: boolean;
  breakSeconds: number;
  shiftDurationSeconds: number;
  isCheckedIn: boolean;
}

export interface IdleTimeSummary {
  employees: EmployeeIdleStatus[];
  avgProductivityPercentage: number;
}

export interface CameraConsent {
  id: string;
  employeeId: string;
  consented: boolean;
  createdAt: string;
}

export interface CameraMonitoringConfig {
  employeeId: string;
  globallyEnabled: boolean;
  employeeEnabled: boolean;
  effectiveEnabled: boolean;
}

export interface PresenceSummary {
  employeeId: string;
  date: string;
  sampleCount: number;
  cameraActiveSeconds: number;
  inputActiveSeconds: number;
  combinedActiveSeconds: number;
  idleAwaySeconds: number;
}

export type BreakType = 'LUNCH_ZUHAR' | 'TEA_ASAR' | 'MANUAL';
export type TriggeredBy = 'manual' | 'scheduled';

/**
 * THE single authoritative calculation for one employee/day - mirrors
 * ProductivityService.get_shift_summary() on the backend. Every dashboard
 * component that shows active/idle/break/shift-duration/camera/status
 * should read from this same shape (via useShiftSummary), not recompute
 * any of it independently.
 */
export interface ShiftSummary {
  employeeId: string;
  date: string;
  isCheckedIn: boolean;
  isOnBreak: boolean;
  shiftDurationSeconds: number;
  breakSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  jabberSeconds: number;
  wildixSeconds: number;
  productivityPercentage: number;
  status: IdleStatus;
  cameraActiveSeconds: number;
  inputActiveSeconds: number;
  combinedActiveSeconds: number;
  idleAwaySeconds: number;
  sampleCount: number;
}

export interface BreakStatus {
  employeeId: string;
  onBreak: boolean;
  breakType: BreakType | null;
  triggeredBy: TriggeredBy | null;
  breakStartedAt: string | null;
}

export interface ShiftEvent {
  id: string;
  employeeId: string;
  eventType: 'check_in' | 'check_out' | 'break_start' | 'break_end';
  occurredAt: string;
  breakType: BreakType | null;
  triggeredBy: TriggeredBy;
  label: string | null;
  createdAt: string;
}

/** One employee, one calendar day - the day-scoped, multi-session-merged
 * figures behind the Attendance/Productivity report PDFs. Mirrors
 * ProductivityService.get_daily_report_row() on the backend. */
export interface DailyReportRow {
  employeeId: string;
  employeeName: string;
  date: string;
  attendanceStatus: 'PRESENT' | 'ABSENT';
  checkInAt: string | null;
  checkOutAt: string | null;
  stillCheckedIn: boolean;
  shiftDurationSeconds: number;
  breakSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  jabberSeconds: number;
  wildixSeconds: number;
  productivityPercentage: number;
  cameraActiveSeconds: number;
  combinedActiveSeconds: number;
}

export interface ReportRows {
  rows: DailyReportRow[];
}

class ProductivityApiService {
  constructor(private baseUrl: string = PRODUCTIVITY_API_BASE_URL) {}

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Productivity API Error ${response.status}: ${errorBody}`);
    }

    return await response.json();
  }

  getTaskProductivity(taskId: string) {
    return this.request<TaskProductivity>('GET', `/api/tasks/${taskId}/productivity`);
  }

  closeTask(taskId: string) {
    return this.request<Ticket>('POST', `/api/tasks/${taskId}/close`);
  }

  createTask(employeeId: string, title: string, estimatedMinutes?: number) {
    return this.request<Task>('POST', '/api/tasks', {
      employeeId,
      title,
      estimatedMinutes,
    });
  }

  registerEmployee(fullName: string, email: string, jibbleMemberId?: string, role: string = 'EMPLOYEE') {
    return this.request<Employee>('POST', '/api/employees/register', {
      fullName,
      email,
      jibbleMemberId,
      role,
    });
  }

  getActiveEmployees() {
    return this.request<ActiveEmployee[]>('GET', '/api/employees/active');
  }

  getDashboardSummary() {
    return this.request<DashboardSummary>('GET', '/api/dashboard/summary');
  }

  getTickets(params?: { employeeId?: string; taskId?: string; page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.employeeId) query.set('employee_id', params.employeeId);
    if (params?.taskId) query.set('task_id', params.taskId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('page_size', String(params.pageSize));
    const qs = query.toString();
    return this.request<PaginatedTickets>('GET', `/api/tickets${qs ? `?${qs}` : ''}`);
  }

  triggerJibbleSync() {
    return this.request<{
      pulled: number;
      upserted: number;
      tasksCreated: number;
      skipped: number;
      syncedAt: string;
    }>('POST', '/api/sync/jibble');
  }

  getIdleTimeSummary() {
    return this.request<IdleTimeSummary>('GET', '/api/idle-time/summary');
  }

  getEmployeeIdleTime(employeeId: string, startDate: string, endDate: string) {
    const query = new URLSearchParams({ startDate, endDate });
    return this.request<IdleTimeLog[]>('GET', `/api/idle-time/${employeeId}?${query.toString()}`);
  }

  listEmployees() {
    return this.request<Employee[]>('GET', '/api/employees');
  }

  getCameraConfig(employeeId: string) {
    return this.request<CameraMonitoringConfig>('GET', `/api/presence/config/${employeeId}`);
  }

  getGlobalCameraConfig() {
    return this.request<{ globallyEnabled: boolean }>('GET', '/api/presence/config/global');
  }

  setGlobalCameraConfig(globallyEnabled: boolean) {
    return this.request<void>('PUT', '/api/presence/config/global', { globallyEnabled });
  }

  setEmployeeCameraConfig(employeeId: string, enabled: boolean) {
    return this.request<CameraMonitoringConfig>('PUT', `/api/presence/config/${employeeId}`, { enabled });
  }

  getCameraConsent(employeeId: string) {
    return this.request<CameraConsent | null>('GET', `/api/presence/consent/${employeeId}`);
  }

  recordCameraConsent(employeeId: string, consented: boolean) {
    return this.request<CameraConsent>('POST', '/api/presence/consent', { employeeId, consented });
  }

  getPresenceSummary(employeeId: string, date?: string) {
    const query = date ? `?date=${date}` : '';
    return this.request<PresenceSummary>('GET', `/api/presence/summary/${employeeId}${query}`);
  }

  getShiftSummary(employeeId: string, date?: string) {
    const query = date ? `?date=${date}` : '';
    return this.request<ShiftSummary>('GET', `/api/shift/summary/${employeeId}${query}`);
  }

  getBreakStatus(employeeId: string) {
    return this.request<BreakStatus>('GET', `/api/shift/break-status/${employeeId}`);
  }

  checkInShift(employeeId: string) {
    return this.request<ShiftEvent>('POST', '/api/shift/check-in', { employeeId });
  }

  checkOutShift(employeeId: string) {
    return this.request<ShiftEvent>('POST', '/api/shift/check-out', { employeeId });
  }

  startBreak(employeeId: string) {
    return this.request<ShiftEvent>('POST', '/api/shift/break/start', { employeeId });
  }

  endBreak(employeeId: string) {
    return this.request<ShiftEvent>('POST', '/api/shift/break/end', { employeeId });
  }

  getAttendanceReport(startDate: string, endDate: string) {
    const query = new URLSearchParams({ startDate, endDate });
    return this.request<ReportRows>('GET', `/api/reports/attendance?${query.toString()}`);
  }

  getProductivityReport(startDate: string, endDate: string) {
    const query = new URLSearchParams({ startDate, endDate });
    return this.request<ReportRows>('GET', `/api/reports/productivity?${query.toString()}`);
  }
}

export const productivityApiService = new ProductivityApiService();
export default productivityApiService;
