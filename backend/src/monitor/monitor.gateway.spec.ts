import { MonitorGateway } from './monitor.gateway';

describe('MonitorGateway Presence Camera & Security', () => {
  let gateway: MonitorGateway;
  let mockServer: any;
  let mockJwtService: any;
  let mockConfigService: any;
  let roomMap: Map<string, Set<string>>;

  beforeEach(() => {
    roomMap = new Map();

    mockServer = {
      sockets: {
        adapter: {
          rooms: {
            get: (room: string) => roomMap.get(room),
          },
        },
      },
      to: jest.fn().mockImplementation((roomOrSocketId: string) => ({
        emit: jest.fn((event: string, payload: any) => {
          // Record emissions by destination
          if (!mockServer._emitted) mockServer._emitted = [];
          mockServer._emitted.push({ to: roomOrSocketId, event, payload });
        }),
      })),
      emit: jest.fn(),
    };

    mockJwtService = {
      verify: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('mock-jwt-secret'),
    };

    gateway = new MonitorGateway(mockJwtService as any, mockConfigService as any);
    gateway.server = mockServer;
  });

  it('allows Manager A to request Employee B camera and routes frame strictly to Manager A', () => {
    // 1. Setup Employee B online in personal room
    roomMap.set('user_emp-B', new Set(['socket-emp-B']));

    // 2. Setup Manager A client
    const managerAClient: any = {
      id: 'socket-mgr-A',
      data: {
        user: { sub: 'mgr-A', role: 'MANAGER', organizationId: 'org-1', email: 'mgrA@work.com' },
      },
      emit: jest.fn(),
    };

    // Manager A requests camera of Employee B
    gateway.handleManagerRequestPresenceCamera({ employeeId: 'emp-B', requestId: 'req-123' }, managerAClient);

    // Verify Employee B is asked to produce a frame
    expect(mockServer.to).toHaveBeenCalledWith('user_emp-B');
    const toEmpCall = mockServer._emitted?.find(
      (e: any) => e.to === 'user_emp-B' && e.event === 'employee:request_camera_frame',
    );
    expect(toEmpCall).toBeDefined();
    expect(toEmpCall.payload).toEqual({
      requestId: 'req-123',
      managerSocketId: 'socket-mgr-A',
      requesterRole: 'MANAGER',
      employeeId: 'emp-B',
    });

    // 3. Employee B sends camera frame response
    const empBClient: any = { id: 'socket-emp-B', data: { user: { sub: 'emp-B', role: 'EMPLOYEE' } } };
    gateway.handleEmployeeCameraFrameResponse(
      {
        requestId: 'req-123',
        managerSocketId: 'socket-mgr-A',
        employeeId: 'emp-B',
        status: 'active',
        frameData: 'data:image/jpeg;base64,mockEmployeeBFrameData',
      },
      empBClient,
    );

    // 4. Verify Manager A receives Employee B's frame
    expect(mockServer.to).toHaveBeenCalledWith('socket-mgr-A');
    const toMgrCall = mockServer._emitted?.find(
      (e: any) => e.to === 'socket-mgr-A' && e.event === 'presence_camera:frame',
    );
    expect(toMgrCall).toBeDefined();
    expect(toMgrCall.payload.status).toBe('active');
    expect(toMgrCall.payload.frameData).toBe('data:image/jpeg;base64,mockEmployeeBFrameData');

    // 5. Verify frame was NEVER broadcast to general channels, Manager C, or Employee D
    const generalEmits = mockServer._emitted?.filter(
      (e: any) =>
        e.to !== 'socket-mgr-A' &&
        e.to !== 'user_emp-B' &&
        e.event === 'presence_camera:frame',
    );
    expect(generalEmits.length).toBe(0);
  });

  it('rejects camera requests from unauthorized non-manager roles without pinging employee', () => {
    roomMap.set('user_emp-B', new Set(['socket-emp-B']));

    const nonManagerClient: any = {
      id: 'socket-emp-D',
      data: {
        user: { sub: 'emp-D', role: 'EMPLOYEE', organizationId: 'org-1' },
      },
      emit: jest.fn(),
    };

    gateway.handleManagerRequestPresenceCamera({ employeeId: 'emp-B', requestId: 'req-bad' }, nonManagerClient);

    // Verify rejected with unauthorized
    expect(nonManagerClient.emit).toHaveBeenCalledWith('presence_camera:frame', {
      employeeId: 'emp-B',
      requestId: 'req-bad',
      status: 'unauthorized',
      error: expect.stringContaining('Unauthorized'),
    });

    // Verify Employee B was NEVER pinged
    expect(mockServer.to).not.toHaveBeenCalledWith('user_emp-B');
  });

  it('reports offline status immediately when employee is not connected', () => {
    // Room user_emp-B does not exist or has 0 connections
    roomMap.delete('user_emp-B');

    const managerClient: any = {
      id: 'socket-mgr-A',
      data: {
        user: { sub: 'mgr-A', role: 'MANAGER', organizationId: 'org-1' },
      },
      emit: jest.fn(),
    };

    gateway.handleManagerRequestPresenceCamera({ employeeId: 'emp-B', requestId: 'req-off' }, managerClient);

    expect(managerClient.emit).toHaveBeenCalledWith('presence_camera:frame', {
      employeeId: 'emp-B',
      requestId: 'req-off',
      status: 'offline',
      error: 'Employee offline',
    });

    // Employee room was not messaged
    expect(mockServer.to).not.toHaveBeenCalledWith('user_emp-B');
  });
});
