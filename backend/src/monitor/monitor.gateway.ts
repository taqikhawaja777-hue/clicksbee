import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MonitorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MonitorGateway.name);
  // Track manager subscriptions: socketId -> Set of employeeIds
  private managerSubscriptions: Map<string, Set<string>> = new Map();

  handleConnection(client: Socket) {
    this.logger.log(`[MonitorGateway] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[MonitorGateway] Client disconnected: ${client.id}`);
    // Cleanup subscriptions for disconnected client
    this.managerSubscriptions.delete(client.id);
  }

  /**
   * Manager subscribes to a specific employee's live feed
   */
  @SubscribeMessage('manager:subscribe')
  handleManagerSubscribe(
    @MessageBody() data: { employeeId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const { employeeId } = data;
    if (!employeeId) return;

    // Join room for this employee
    const roomName = `employee:${employeeId}`;
    client.join(roomName);

    // Track subscription
    if (!this.managerSubscriptions.has(client.id)) {
      this.managerSubscriptions.set(client.id, new Set());
    }
    this.managerSubscriptions.get(client.id)!.add(employeeId);

    this.logger.log(`[MonitorGateway] Manager ${client.id} subscribed to employee: ${employeeId}`);
    client.emit('manager:subscribed', { employeeId, room: roomName });
  }

  /**
   * Manager unsubscribes from a specific employee's live feed
   */
  @SubscribeMessage('manager:unsubscribe')
  handleManagerUnsubscribe(
    @MessageBody() data: { employeeId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const { employeeId } = data;
    if (!employeeId) return;

    const roomName = `employee:${employeeId}`;
    client.leave(roomName);

    // Remove from tracking
    const subs = this.managerSubscriptions.get(client.id);
    if (subs) subs.delete(employeeId);

    this.logger.log(`[MonitorGateway] Manager ${client.id} unsubscribed from employee: ${employeeId}`);
    client.emit('manager:unsubscribed', { employeeId });
  }

  /**
   * Employee sends heartbeat to indicate they are online and active
   */
  @SubscribeMessage('employee:heartbeat')
  handleEmployeeHeartbeat(
    @MessageBody() data: { employeeId: string; status: string; activeWindow?: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const { employeeId, status, activeWindow } = data;
    if (!employeeId) return;

    this.logger.log(`[MonitorGateway] Heartbeat from employee: ${employeeId} — ${status}`);

    // Broadcast status update to all managers watching this employee
    const roomName = `employee:${employeeId}`;
    this.server.to(roomName).emit('employee:status:update', {
      employeeId,
      status,
      activeWindow,
      timestamp: new Date().toISOString(),
    });

    // Also emit to the global channel
    this.server.emit(`employee:update:${employeeId}`, {
      employeeId,
      status,
      activeWindow,
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast real-time employee activity evaluation update to WebSocket clients
   */
  public broadcastEmployeeUpdate(employeeId: string, data: any): void {
    const payload = {
      employeeId,
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
    };

    this.logger.log(`[MonitorGateway] Broadcasting update for employeeId: ${employeeId}`);

    if (this.server) {
      // 1. Emit to specific employee room (managers who subscribed)
      this.server.to(`employee:${employeeId}`).emit('employee:activity:update', payload);

      // 2. Emit to specific employee channel (direct listeners)
      this.server.emit(`employee:update:${employeeId}`, payload);

      // 3. Emit to general live feed channel
      this.server.emit('live:feed', payload);

      // 4. Emit screenshot-specific event
      this.server.emit('screenshot:new', payload);

      // 5. Emit legacy channel for backwards compatibility
      this.server.emit('NEW_SCREENSHOT_EVALUATED', payload);
    }
  }

  /**
   * Broadcast activity log update (window changes, app usage)
   */
  public broadcastActivityUpdate(employeeId: string, data: any): void {
    if (!this.server) return;

    const payload = {
      employeeId,
      type: 'activity',
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
    };

    this.server.to(`employee:${employeeId}`).emit('employee:activity:update', payload);
    this.server.emit(`employee:update:${employeeId}`, payload);
  }

  /**
   * Broadcast employee status change (ACTIVE / IDLE / OFFLINE)
   */
  public broadcastStatusUpdate(employeeId: string, status: string): void {
    if (!this.server) return;

    const payload = {
      employeeId,
      status,
      type: 'status',
      timestamp: new Date().toISOString(),
    };

    this.server.to(`employee:${employeeId}`).emit('employee:status:update', payload);
    this.server.emit(`employee:update:${employeeId}`, payload);
    this.server.emit('live:feed', payload);
  }
}
