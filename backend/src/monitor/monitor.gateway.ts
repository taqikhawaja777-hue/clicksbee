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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

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

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Every existing feature on this gateway (manager:subscribe,
   * employee:heartbeat, Live Monitor's broadcastEmployeeUpdate) worked
   * fully unauthenticated before notifications needed real per-user/
   * per-org room scoping - preserved below: no token still connects fine,
   * it just joins no notification rooms. A present-but-invalid/expired
   * token is treated the SAME as no token (unauthenticated), never
   * defaulting to a fake manager identity the way the separate, unused
   * /live namespace's gateway does - that fallback would let any socket
   * with a broken token read every organization's admin notifications.
   */
  handleConnection(client: Socket) {
    this.logger.log(`[MonitorGateway] Client connected: ${client.id}`);
    try {
      const authHeader = client.handshake.headers?.authorization;
      const token = client.handshake.auth?.token || (typeof authHeader === 'string' ? authHeader.split(' ')[1] : undefined);
      if (!token) {
        client.data.user = null;
        return;
      }
      const secret = this.configService.get<string>('JWT_SECRET') || 'super-secret-jwt-access-key-stitchmonitor-2026';
      const payload = this.jwtService.verify(token, { secret });
      client.data.user = payload;

      // Every authenticated user gets their own personal room, for
      // employee-scoped notifications (and anything else that should
      // reach exactly one logged-in session).
      client.join(`user_${payload.sub}`);

      // Admins/managers additionally join their organization's shared
      // notification room - this is what makes "admin sees notifications
      // about ALL employees" a single emit rather than one per manager.
      if (payload.role === 'ADMIN' || payload.role === 'MANAGER') {
        client.join(`admin_org_${payload.organizationId}`);
      }
      this.logger.log(`[MonitorGateway] Authenticated socket ${client.id} as user ${payload.sub} (${payload.role})`);
    } catch (e) {
      client.data.user = null;
      this.logger.warn(`[MonitorGateway] Socket ${client.id} sent an invalid/expired token - connecting unauthenticated`);
    }
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

  /**
   * Pushes one notification row to the correct audience only:
   * recipientType ADMIN -> every manager/admin currently connected for
   * this organization (admin_org_${organizationId} room, joined in
   * handleConnection based on each socket's OWN verified JWT - not
   * anything the emitting code chooses per-client). recipientType
   * EMPLOYEE -> only the one user's own personal room (user_${userId}).
   * A manager can't see another org's admin notifications, and an
   * employee can't see another employee's, because room membership was
   * decided server-side from each socket's verified token, never from a
   * client-supplied id.
   */
  public emitNotification(notification: {
    id: string;
    organizationId: string;
    recipientType: 'ADMIN' | 'EMPLOYEE';
    userId: string | null;
    [key: string]: any;
  }): void {
    if (!this.server) return;
    const room =
      notification.recipientType === 'ADMIN'
        ? `admin_org_${notification.organizationId}`
        : `user_${notification.userId}`;
    this.server.to(room).emit('notification:new', notification);
  }
}
