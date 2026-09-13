/**
 * API Service — Axios instance with JWT interceptor and base URL
 */

const API_BASE_URL = 'http://localhost:3000/api/v1';

class ApiService {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    // Try to load token from localStorage
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token') || null;
    }
  }

  /**
   * Set the JWT auth token
   */
  setToken(token: string): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
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
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
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
   * Generic fetch wrapper with error handling and 401 redirect
   */
  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 401 Unauthorized — redirect to login
      if (response.status === 401) {
        console.warn('[ApiService] 401 Unauthorized — token expired or invalid');
        this.clearToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
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
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}/notifications/attachment`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Attachment upload failed: HTTP ${response.status}`);
    }
    return response.json();
  }
}

export const apiService = new ApiService();
export default apiService;
