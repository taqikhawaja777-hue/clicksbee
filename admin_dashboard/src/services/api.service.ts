/**
 * API Service — Axios instance with JWT interceptor and base URL
 */

const API_BASE_URL = 'http://localhost:3000/api/v1';

const ACCESS_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const EXPIRES_AT_KEY = 'auth_token_expires_at';

class ApiService {
  private baseUrl: string;
  private token: string | null = null;
  private refreshToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  // Dedupes concurrent 401s - the refresh token is single-use server-side
  // (rotated + the old one revoked on every /auth/refresh call), so if 5
  // in-flight requests all 401 at once, only the first refresh call may
  // succeed and the rest must share its result rather than each firing
  // their own /auth/refresh.
  private refreshPromise: Promise<string> | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    // Try to load token from localStorage
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem(ACCESS_TOKEN_KEY) || null;
      this.refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY) || null;
      const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY) || 0);
      if (expiresAt && this.refreshToken) {
        // Reschedule the proactive refresh across app restarts too - if
        // the app was closed past the access token's 15min lifetime but
        // within the refresh token's 7-day one, this fires ~immediately
        // (clamped by the floor below) instead of waiting for the first
        // API call to hit a 401.
        this.scheduleProactiveRefresh(Math.round((expiresAt - Date.now()) / 1000));
      }
    }
  }

  /**
   * Set the JWT auth token. `refreshToken`/`expiresIn` (seconds) are
   * optional so a bare `setToken(accessToken)` still works, but omitting
   * them means this session will only self-heal reactively on a 401
   * instead of proactively refreshing ahead of expiry.
   */
  setToken(token: string, refreshToken?: string, expiresIn?: number): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    }
    if (refreshToken) {
      this.refreshToken = refreshToken;
      if (typeof window !== 'undefined') {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
    }
    if (typeof window !== 'undefined' && expiresIn) {
      localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));
    }
    this.scheduleProactiveRefresh(expiresIn);
  }

  /**
   * Read the current JWT (or null if not logged in) - used by
   * socket.service.ts to authenticate the Socket.IO connection so the
   * server can join this client to the correct notification room
   * (admin-shared vs this-user-only) instead of trusting a client-claimed id.
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Clear the auth token (logout)
   */
  clearToken(): void {
    this.token = null;
    this.refreshToken = null;
    this.refreshPromise = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(EXPIRES_AT_KEY);
    }
  }

  /**
   * Refreshes the access token ~60s before it actually expires so an
   * active session never hits a 401 in the first place. The reactive
   * 401-triggered refresh in request() is the fallback for when this
   * timer didn't fire (app was asleep/suspended past it, clock drift).
   */
  private scheduleProactiveRefresh(expiresIn?: number): void {
    if (typeof window === 'undefined') return;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!expiresIn || !this.refreshToken) return;
    const delayMs = Math.max((expiresIn - 60) * 1000, 10_000);
    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken().catch(() => {
        // refreshAccessToken() already cleared tokens + dispatched
        // auth:unauthorized on failure - nothing further to do here.
      });
    }, delayMs);
  }

  /**
   * Exchanges the stored refresh token for a new access/refresh token
   * pair (the backend rotates and single-use-revokes refresh tokens, so
   * the new one replaces the old one both here and in localStorage).
   */
  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    if (!this.refreshToken) {
      this.handleSessionExpired();
      throw new Error('No refresh token available');
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
        if (!response.ok) {
          throw new Error(`Refresh failed: HTTP ${response.status}`);
        }
        const json = await response.json();
        const tokens = json.data || json;
        if (!tokens?.accessToken) {
          throw new Error('Refresh response missing accessToken');
        }
        this.setToken(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:refreshed'));
        }
        return tokens.accessToken as string;
      } catch (err) {
        // The refresh token itself is gone (expired past 7d, revoked, or
        // invalid) - unlike a plain access-token expiry, there's no way
        // to self-heal from this without a real re-login.
        this.handleSessionExpired();
        throw err;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private handleSessionExpired(): void {
    this.clearToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
  }

  /**
   * Build headers with JWT Authorization
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Generic fetch wrapper with error handling, silent token refresh, and
   * 401 redirect. `isRetry` stops this from refreshing a second time (and
   * looping) if the retried request 401s again for some other reason.
   */
  private async request<T>(method: string, path: string, body?: any, isRetry = false): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 401) {
        // Access token expired mid-session (it's only good for 15min) -
        // silently refresh and retry once before giving up, instead of
        // immediately logging the user out from under them.
        if (!isRetry && this.refreshToken) {
          console.warn('[ApiService] 401 Unauthorized — access token expired, attempting silent refresh');
          await this.refreshAccessToken();
          return this.request<T>(method, path, body, true);
        }
        console.warn('[ApiService] 401 Unauthorized — token expired or invalid');
        this.handleSessionExpired();
        throw new Error('Unauthorized');
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API Error ${response.status}: ${errorBody}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[ApiService] ${method} ${path} failed:`, err);
      throw err;
    }
  }

  // Convenience methods
  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: any): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: any): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async patch<T>(path: string, body: any): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // ─── Domain-Specific API Methods ───────────────────────────────

  /** Fetch live monitor summary for an employee */
  async getLiveSummary(userId: string) {
    return this.get(`/analytics/live-summary?userId=${userId}`);
  }

  /** Fetch employee summary by ID */
  async getEmployeeSummary(userId: string) {
    return this.get(`/analytics/employee-summary/${userId}`);
  }

  /** Fetch all registered employees */
  async getEmployees() {
    return this.get('/employees');
  }

  /** Fetch live status for all employees */
  async getLiveAll() {
    return this.get('/monitor/live/all');
  }

  /** Fetch live status for a specific employee */
  async getLiveEmployee(employeeId: string) {
    return this.get(`/monitor/live/${employeeId}`);
  }

  /** Fetch attendance records */
  async getAttendance(params?: { date?: string; userId?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return this.get(`/attendance${query ? `?${query}` : ''}`);
  }

  /** Check in */
  async checkIn(userId: string) {
    return this.post('/attendance/check-in', { userId });
  }

  /** Check out */
  async checkOut(userId: string) {
    return this.post('/attendance/check-out', { userId });
  }

  /** Fetch screenshots feed */
  async getScreenshotsFeed() {
    return this.get('/screenshots/feed');
  }

  /** Create a task assigned to an employee (by email — resolved server-side) */
  async createTask(dto: {
    title: string;
    description?: string;
    assignedToEmail: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    dueDate?: string;
    estimatedMinutes?: number;
  }) {
    return this.post('/tasks', dto);
  }

  /** Fetch tasks — the backend scopes this to "my tasks" for an EMPLOYEE
   * caller, or all org tasks for a MANAGER/ADMIN caller, based on the JWT. */
  async getTasks(status?: string) {
    return this.get(`/tasks${status ? `?status=${status}` : ''}`);
  }

  /** Mark a task completed */
  async completeTask(taskId: string) {
    return this.post(`/tasks/${taskId}/complete`, {});
  }

  /** Notifications - the backend scopes these to the caller's own role:
   * an EMPLOYEE JWT only ever gets rows addressed to their own user id,
   * an ADMIN/MANAGER JWT only ever gets the org-wide admin feed. There is
   * no query param here that widens that - it's enforced server-side. */
  async getNotifications(page = 1, limit = 20) {
    return this.get<{ data: any[]; pagination: any }>(`/notifications?page=${page}&limit=${limit}`);
  }

  async getUnreadNotificationCount() {
    return this.get<{ count: number }>('/notifications/unread-count');
  }

  async markNotificationRead(id: string) {
    return this.patch(`/notifications/${id}/read`, {});
  }

  async markAllNotificationsRead() {
    return this.patch('/notifications/read-all', {});
  }

  /** "Send Notification" / message. recipientUserId targets one employee;
   * allEmployees: true fans out to everyone in the org (management tier
   * only). Who's actually allowed to reach whom (management can message
   * anyone incl. broadcasting; floor tier - CSR/Team Lead/unset - can only
   * message other floor-tier employees) is enforced server-side in
   * NotificationsController.sendNotification, not just hidden in this UI. */
  async sendNotification(body: {
    recipientUserId?: string;
    allEmployees?: boolean;
    title?: string;
    message: string;
    attachmentUrl?: string;
    attachmentName?: string;
  }) {
    return this.post('/notifications/send', body);
  }

  /** Manager-portal Logs page: every action a specific employee took
   * during one shift-day (login, check-in/out, breaks, tasks,
   * screenshots, idle/camera/washroom/late-break alerts...), filterable
   * by date/employee/action. All three params are optional - omitting
   * `date` defaults server-side to today's shift-day, omitting `userId`
   * returns every employee in the org, omitting `action` returns every
   * action type. */
  async getAuditLogs(params?: { date?: string; userId?: string; action?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams(
      Object.entries(params || {}).reduce((acc, [k, v]) => {
        if (v !== undefined && v !== null && v !== '') acc[k] = String(v);
        return acc;
      }, {} as Record<string, string>),
    ).toString();
    return this.get<{ data: any[]; pagination: any }>(`/audit-logs${query ? `?${query}` : ''}`);
  }

  /** Everyone in the org messageable via Send Message - NOT the same,
   * role-filtered list as getEmployees() (which excludes ADMIN/MANAGER
   * accounts, so CSR/HR/SM - created via the Manager signup tab - would
   * never show up as a recipient there). Who a given sender may actually
   * message is still enforced server-side by /notifications/send. */
  async getMessageableUsers() {
    return this.get<{ data: any[] }>('/notifications/messageable-users');
  }

  /** Uploads a file (e.g. a PDF employee report) to attach to a message -
   * multipart, so it bypasses the generic JSON request() helper. Call
   * this first, then pass the returned url/fileName into sendNotification. */
  async uploadNotificationAttachment(file: File): Promise<{ url: string; fileName: string }> {
    const doUpload = (): Promise<Response> => {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
      return fetch(`${this.baseUrl}/notifications/attachment`, {
        method: 'POST',
        headers,
        body: formData,
      });
    };

    let response = await doUpload();
    // Same silent-refresh-and-retry-once as request() - this bypasses
    // that helper (multipart body, not JSON) so it needs its own copy.
    if (response.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      response = await doUpload();
    }
    if (!response.ok) {
      if (response.status === 401) this.handleSessionExpired();
      throw new Error(`Attachment upload failed: HTTP ${response.status}`);
    }
    return response.json();
  }
}

export const apiService = new ApiService();
export default apiService;
