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
}

export const apiService = new ApiService();
export default apiService;
