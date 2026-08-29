/**
 * Socket Service — Socket.IO client singleton for /monitor namespace
 */
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

class SocketService {
  private socket: Socket | null = null;
  private subscribedEmployees: Set<string> = new Set();
  private eventListeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  /**
   * Connect to Socket.IO server
   */
  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect', () => {
      console.log(`[SocketService] Connected: ${this.socket?.id}`);
      // Re-subscribe to previously tracked employees on reconnect
      this.subscribedEmployees.forEach((empId) => {
        this.socket?.emit('manager:subscribe', { employeeId: empId });
      });
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`[SocketService] Disconnected: ${reason}`);
    });

    this.socket.on('connect_error', (err) => {
      console.warn(`[SocketService] Connection error:`, err.message);
    });

    return this.socket;
  }

  /**
   * Disconnect from server and cleanup
   */
  disconnect(): void {
    if (this.socket) {
      this.subscribedEmployees.forEach((empId) => {
        this.socket?.emit('manager:unsubscribe', { employeeId: empId });
      });
      this.subscribedEmployees.clear();
      this.eventListeners.clear();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Subscribe to a specific employee's live updates
   */
  subscribe(employeeId: string): void {
    if (!employeeId) return;

    this.connect(); // Ensure connected
    this.subscribedEmployees.add(employeeId);
    this.socket?.emit('manager:subscribe', { employeeId });
    console.log(`[SocketService] Subscribed to employee: ${employeeId}`);
  }

  /**
   * Unsubscribe from a specific employee's live updates
   */
  unsubscribe(employeeId: string): void {
    if (!employeeId) return;

    this.subscribedEmployees.delete(employeeId);
    this.socket?.emit('manager:unsubscribe', { employeeId });
    console.log(`[SocketService] Unsubscribed from employee: ${employeeId}`);
  }

  /**
   * Listen for a specific event
   */
  on(event: string, callback: (...args: any[]) => void): void {
    this.connect(); // Ensure connected

    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);

    this.socket?.on(event, callback);
  }

  /**
   * Remove a specific event listener
   */
  off(event: string, callback: (...args: any[]) => void): void {
    this.socket?.off(event, callback);
    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Get the raw socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export const socketService = new SocketService();
export default socketService;
