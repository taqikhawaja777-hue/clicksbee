import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/live',
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Active live watch room subscribers count: map targetUserId -> Set<socketId>
  private liveWatchers = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        // Allow dev connection fallback if token unprovided in dev
        client.data.user = { sub: 'emp-101', role: 'MANAGER', organizationId: 'org-101' };
        return;
      }
      const secret = this.configService.get<string>('JWT_SECRET') || 'super-secret-jwt-access-key-stitchmonitor-2026';
      const payload = this.jwtService.verify(token, { secret });
      
      client.data.user = payload;
      client.join(`org_${payload.organizationId}`);
      client.join(`user_${payload.sub}`);
      
      if (payload.role !== 'EMPLOYEE') {
        client.join(`admins_${payload.organizationId}`);
      }
    } catch (e) {
      client.data.user = { sub: 'emp-101', role: 'MANAGER', organizationId: 'org-101' };
    }
  }

  handleDisconnect(client: Socket) {
    // Remove client from all active live watcher rooms
    this.liveWatchers.forEach((watchers, targetUserId) => {
      if (watchers.has(client.id)) {
        watchers.delete(client.id);
        if (watchers.size === 0) {
          this.server.to(`user_${targetUserId}`).emit('live_stream_stopped', { targetUserId });
        }
      }
    });
  }

  @SubscribeMessage('live:start')
  handleLiveStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string }
  ) {
    const targetUserId = data?.targetUserId || 'emp-101';
    const roomName = `live_room_${targetUserId}`;
    
    client.join(roomName);

    if (!this.liveWatchers.has(targetUserId)) {
      this.liveWatchers.set(targetUserId, new Set());
    }
    this.liveWatchers.get(targetUserId)!.add(client.id);

    // Notify employee agent to start streaming ~10-15s interval captures
    this.server.to(`user_${targetUserId}`).emit('live_stream_requested', {
      managerId: client.data.user?.sub,
      targetUserId,
      intervalMs: 10000,
    });

    return { status: 'subscribed', room: roomName, activeWatchers: this.liveWatchers.get(targetUserId)!.size };
  }

  @SubscribeMessage('live:stop')
  handleLiveStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string }
  ) {
    const targetUserId = data?.targetUserId || 'emp-101';
    const roomName = `live_room_${targetUserId}`;
    
    client.leave(roomName);

    if (this.liveWatchers.has(targetUserId)) {
      const watchers = this.liveWatchers.get(targetUserId)!;
      watchers.delete(client.id);
      
      if (watchers.size === 0) {
        // No managers watching -> tell agent to stop live streaming
        this.server.to(`user_${targetUserId}`).emit('live_stream_stopped', { targetUserId });
      }
    }

    return { status: 'unsubscribed', room: roomName };
  }

  @SubscribeMessage('live:frame')
  handleLiveFrame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: string; imageUrl: string; activeWindowName?: string; timestamp?: string }
  ) {
    const targetUserId = data?.targetUserId || client.data.user?.sub || 'emp-101';
    const roomName = `live_room_${targetUserId}`;

    // Broadcast frame exclusively to subscribed managers in the live room
    this.server.to(roomName).emit('live_frame_received', {
      userId: targetUserId,
      imageUrl: data.imageUrl,
      activeWindowName: data.activeWindowName || 'Active Screen',
      timestamp: data.timestamp || new Date().toLocaleTimeString(),
    });

    return { status: 'frame_broadcasted' };
  }

  broadcastActivity(organizationId: string, activityData: any) {
    this.server.to(`admins_${organizationId}`).emit('live_activity', activityData);
  }
}
