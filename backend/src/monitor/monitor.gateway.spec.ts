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

    gateway = new MonitorGateway(mockJwtService as any, mockConfigService as any, {} as any);
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
      requesterRole: 'ADMIN',
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

/** Live Monitor + employee camera over the socket connection: Admin/Boss only. */
describe('MonitorGateway access', () => {
  const accounts: Record<string, any> = {
    admin: { role: 'ADMIN', designation: null, officeCategory: 'ADMIN', isActive: true },
    sm: { role: 'EMPLOYEE', designation: 'SM', officeCategory: 'SM', isActive: true },
    legacySmAdmin: { role: 'ADMIN', designation: 'SM', officeCategory: null, isActive: true },
    hr: { role: 'MANAGER', designation: 'HR', officeCategory: 'HR', isActive: true },
  };

  function setup() {
    const emitted: { room: string | null; event: string }[] = [];
    const server: any = {
      to: (room: string) => ({ emit: (event: string) => emitted.push({ room, event }) }),
      emit: (event: string) => emitted.push({ room: null, event }),
      sockets: { adapter: { rooms: new Map() } },
    };
    const gateway = new MonitorGateway(
      { verify: (token: string) => ({ sub: token, email: `${token}@x`, role: accounts[token].role, organizationId: 'org' }) } as any,
      { get: () => 'secret' } as any,
      { user: { findUnique: async ({ where }: any) => accounts[where.sub ?? where.id] } } as any,
    );
    gateway.server = server;
    return { gateway, emitted };
  }

  async function connect(gateway: MonitorGateway, who: string) {
    const clientEmits: { event: string; payload: any }[] = [];
    const rooms: string[] = [];
    const client: any = {
      id: `sock-${who}`,
      handshake: { auth: { token: who }, headers: {} },
      data: {},
      join: (r: string) => rooms.push(r),
      emit: (event: string, payload: any) => clientEmits.push({ event, payload }),
    };
    await gateway.handleConnection(client);
    return { client, clientEmits, rooms };
  }

  it('SM (and a legacy SM account with stored role ADMIN) cannot start Live Monitor or open the camera', async () => {
    for (const who of ['sm', 'legacySmAdmin', 'hr']) {
      const { gateway, emitted } = setup();
      const { client, clientEmits } = await connect(gateway, who);
      gateway.handleManagerSubscribe({ employeeId: 'emp1' }, client);
      gateway.handleManagerRequestCapture({ employeeId: 'emp1' }, client);
      gateway.handleManagerRequestPresenceCamera({ employeeId: 'emp1' }, client);
      expect(emitted.filter((e) => /live_monitor|request_camera_frame/.test(e.event))).toEqual([]);
      expect(clientEmits.map((e) => e.payload.status || e.event)).toEqual(['manager:unauthorized', 'manager:unauthorized', 'unauthorized']);
    }
  });

  it('Admin can start Live Monitor and request the camera', async () => {
    const { gateway, emitted } = setup();
    const { client, clientEmits } = await connect(gateway, 'admin');
    gateway.handleManagerSubscribe({ employeeId: 'emp1' }, client);
    expect(emitted.some((e) => e.event === 'live_monitor:start')).toBe(true);
    gateway.server.sockets.adapter.rooms.set('user_emp1', new Set(['x']));
    gateway.handleManagerRequestPresenceCamera({ employeeId: 'emp1' }, client);
    expect(emitted.some((e) => e.event === 'employee:request_camera_frame')).toBe(true);
    expect(clientEmits.some((e) => e.payload?.status === 'unauthorized')).toBe(false);
  });

  it('only Manager-portal users (Admin, HR) join the shared manager notification feed', async () => {
    const { gateway } = setup();
    expect((await connect(gateway, 'admin')).rooms).toContain('admin_org_org');
    expect((await connect(gateway, 'hr')).rooms).toContain('admin_org_org');
    expect((await connect(gateway, 'sm')).rooms).not.toContain('admin_org_org');
    expect((await connect(gateway, 'legacySmAdmin')).rooms).not.toContain('admin_org_org');
  });
});
