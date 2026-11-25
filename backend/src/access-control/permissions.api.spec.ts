/**
 * Calls the real controllers over HTTP with the real JWT login and the real
 * permission guards, signed in as each role - proves restricted data can't
 * be fetched by calling the API directly. Only the database (and services
 * behind controllers) are fakes.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { TrackingController } from '../tracking/tracking.controller';
import { TrackingService } from '../tracking/tracking.service';
import { IdleAlertsService } from '../tracking/idle-alerts.service';
import { ScreenshotsController } from '../screenshots/screenshots.controller';
import { ScreenshotsService } from '../screenshots/screenshots.service';
import { StorageService } from '../storage/storage.service';
import { AiVisionEvaluatorService } from '../services/aiVisionEvaluator';
import { EmployeesController } from '../employees/employees.controller';
import { EmployeesService } from '../employees/employees.service';
import { MonitorController } from '../monitor/monitor.controller';
import { MonitorService } from '../monitor/monitor.service';
import { AiAnalyticsController } from '../controllers/aiAnalyticsController';
import { AuditLogsController } from '../audit-logs/audit-logs.controller';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TasksController } from '../tasks/tasks.controller';
import { TasksService } from '../tasks/tasks.service';
import { TaskSheetsService } from '../tasks/task-sheets.service';
import { UsersAdminController } from './users-admin.controller';
import { ActivityLogController } from './activity-log.controller';
import { TeamController } from './team.controller';
import { CandidatesController } from './candidates.controller';

const ORG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const id = (n: number) => n.toString(16).padStart(24, '0');

// One person per role (+ an old-style SM account whose stored role is still ADMIN).
const U = {
  admin: { id: id(1), role: 'ADMIN', designation: null, officeCategory: 'ADMIN', managerId: null },
  hr: { id: id(2), role: 'MANAGER', designation: 'HR', officeCategory: 'HR', managerId: null },
  sm: { id: id(3), role: 'EMPLOYEE', designation: 'SM', officeCategory: 'SM', managerId: null },
  tl: { id: id(4), role: 'EMPLOYEE', designation: 'Team Lead', officeCategory: 'TEAM_LEAD', managerId: null },
  tl2: { id: id(5), role: 'EMPLOYEE', designation: 'Team Lead', officeCategory: 'TEAM_LEAD', managerId: null },
  closer: { id: id(6), role: 'EMPLOYEE', designation: 'Closer', officeCategory: 'CLOSER', managerId: id(4) },
  closer2: { id: id(7), role: 'EMPLOYEE', designation: 'Closer', officeCategory: 'CLOSER', managerId: id(5) },
  backOffice: { id: id(8), role: 'EMPLOYEE', designation: 'Back Office', officeCategory: 'BACK_OFFICE', managerId: null },
  validator: { id: id(9), role: 'EMPLOYEE', designation: 'Validator', officeCategory: 'VALIDATOR', managerId: null },
  employee: { id: id(10), role: 'EMPLOYEE', designation: 'CSR', officeCategory: 'EMPLOYEE', managerId: null },
  legacySmAdmin: { id: id(11), role: 'ADMIN', designation: 'SM', officeCategory: null, managerId: null },
};
const ALL = Object.values(U).map((u) => ({
  ...u,
  organizationId: ORG,
  email: `${u.id}@test.local`,
  firstName: u.officeCategory || 'Legacy',
  lastName: 'User',
  isActive: true,
  departmentId: null,
  teamId: null,
  avatar: null,
  employeeCode: null,
}));
const byId = (uid: string) => ALL.find((u) => u.id === uid) || null;

// Report rows as TrackingService returns them (category + Team Lead tagged).
const row = (u: (typeof ALL)[number]) => ({
  employeeId: u.id,
  category: u.officeCategory || 'SM',
  teamLeadId: u.managerId,
  activeSeconds: 100,
  idleSeconds: 5,
  productivityPercentage: 80,
  jabberSeconds: 1,
  threeCxSeconds: 2,
  yeastarSeconds: 3,
  callSeconds: 50,
  callCount: 4,
});

describe('Role permissions over the API', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const trackingService = {
    getSummary: jest.fn(async () => ({ employees: ALL.filter((u) => u.role !== 'ADMIN' && u.role !== 'MANAGER').map(row), avgProductivityPercentage: 80 })),
    getAttendanceReport: jest.fn(async () => ({ rows: ALL.map(row) })),
    getProductivityReport: jest.fn(async () => ({ rows: ALL.map(row) })),
    getAccessTarget: jest.fn(async (_org: string, uid: string) => byId(uid)),
    getShiftSummary: jest.fn(async (_o: string, uid: string) => ({ employeeId: uid, ...row(byId(uid)!) })),
    getSnapshotRange: jest.fn(async () => []),
    upsertIdleSnapshot: jest.fn(async (input: any) => input),
    getActivityConfig: jest.fn(async () => ({})),
    setActivityConfig: jest.fn(async () => ({})),
    getCameraConfig: jest.fn(async () => ({})),
    updateCameraConfig: jest.fn(async () => ({})),
  };
  const auditLogsService = { getLogs: jest.fn(async (..._args: any[]) => ({ data: [], pagination: {} })) };
  const employeesService = {
    getEmployees: jest.fn(async () => ({ data: [] })),
    getAllRegisteredEmployees: jest.fn(async () => []),
    getEmployeeById: jest.fn(async () => ({})),
    deleteEmployee: jest.fn(async () => ({})),
  };
  const monitorService = { getLiveAll: jest.fn(async () => []), analyzeScreenshot: jest.fn(async (d: any) => d) };
  const tasksService = { createTask: jest.fn(async () => ({ id: 't1' })), getTasks: jest.fn(async () => []) };
  const taskSheetsService = { upload: jest.fn(async (_f: any, _u: string, _o: string, role: string) => ({ role })) };

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (where.id ? byId(where.id) : null)),
      findFirst: jest.fn(async ({ where }: any) => {
        const u = byId(where.id);
        return u && (!where.organizationId || u.organizationId === where.organizationId) ? u : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        ALL.filter((u) => (!where?.managerId || u.managerId === where.managerId)),
      ),
      update: jest.fn(async () => ({})),
    },
    applicationUsage: {
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
    },
    candidate: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }: any) => data) },
    screenshot: {
      // Archive screenshots live under screenshots/<Employee Name>/...
      findFirst: jest.fn(async ({ where }: any) => (String(where.OR[0].filePath).startsWith('screenshots/Ali') ? { id: 's1' } : null)),
      findMany: jest.fn(async () => []),
    },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'permissions-test-secret';
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'permissions-test-secret' })],
      controllers: [
        TrackingController,
        ScreenshotsController,
        EmployeesController,
        MonitorController,
        AiAnalyticsController,
        AuditLogsController,
        TasksController,
        UsersAdminController,
        ActivityLogController,
        TeamController,
        CandidatesController,
      ],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: (k: string) => process.env[k] } },
        { provide: PrismaService, useValue: prisma },
        { provide: TrackingService, useValue: trackingService },
        { provide: IdleAlertsService, useValue: {} },
        ScreenshotsService,
        { provide: StorageService, useValue: {} },
        { provide: AiVisionEvaluatorService, useValue: {} },
        { provide: EmployeesService, useValue: employeesService },
        { provide: MonitorService, useValue: monitorService },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: TasksService, useValue: tasksService },
        { provide: TaskSheetsService, useValue: taskSheetsService },
      ],
    }).compile();
    jest
      .spyOn(moduleRef.get(ScreenshotsService), 'getScreenshotStream')
      .mockImplementation(async () => ({ ok: true }) as any);
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (user: { id: string; role: string }) =>
    `Bearer ${jwt.sign({ sub: user.id, email: `${user.id}@test.local`, role: user.role, organizationId: ORG })}`;
  const get = (path: string, user?: { id: string; role: string }) => {
    const r = request(app.getHttpServer()).get(path);
    return user ? r.set('Authorization', as(user)) : r;
  };
  const status = async (path: string, user?: { id: string; role: string }) => (await get(path, user)).status;

  it('no login -> 401 everywhere that holds data (incl. the old /employees bypass)', async () => {
    for (const path of ['/employees', '/employees/all', '/monitor/live/all', '/screenshots/feed', '/tracking/idle-snapshots', '/candidates', '/admin/users', '/activity-log/people']) {
      expect([path, await status(path)]).toEqual([path, 401]);
    }
  });

  it('screenshots: Admin only (incl. a legacy SM account whose stored role is ADMIN)', async () => {
    expect(await status('/screenshots/feed', U.admin)).toBe(200);
    for (const user of [U.hr, U.sm, U.tl, U.closer, U.backOffice, U.validator, U.employee, U.legacySmAdmin]) {
      expect(await status('/screenshots/feed', user)).toBe(403);
    }
    // a real screenshot file vs a task attachment of the same organization
    expect(await status('/screenshots/file/screenshots%2FAli%2F2026-11-17%2Fa.jpg', U.closer)).toBe(403);
    expect(await status('/screenshots/file/screenshots%2FAli%2F2026-11-17%2Fa.jpg', U.admin)).toBe(200);
    expect(await status(`/screenshots/file/screenshots%2F${ORG}%2Fu1%2F2026%2F11%2F17%2Fbrief.pdf`, U.closer)).toBe(200);
  });

  it('Live Monitor (AI screen analysis): Admin only', async () => {
    expect(await status('/monitor/live/all', U.admin)).toBe(200);
    for (const user of [U.hr, U.sm, U.tl]) expect(await status('/monitor/live/all', user)).toBe(403);
    expect(await status('/analytics/employee-summary/x', U.hr)).toBe(403);
  });

  it('Candidates: HR and Admin/Boss only', async () => {
    expect(await status('/candidates', U.hr)).toBe(200);
    expect(await status('/candidates', U.admin)).toBe(200);
    for (const user of [U.sm, U.tl, U.closer, U.backOffice, U.validator, U.employee]) {
      expect(await status('/candidates', user)).toBe(403);
    }
  });

  it('Users page (change categories): Admin only', async () => {
    expect(await status('/admin/users', U.admin)).toBe(200);
    for (const user of [U.hr, U.sm, U.tl]) expect(await status('/admin/users', user)).toBe(403);
  });

  it('Back Office / Validator / Closer see no reports or dashboards at all', async () => {
    const reportPaths = [
      '/tracking/idle-summary',
      '/tracking/productivity-report',
      '/audit-logs',
      '/employees',
      '/activity-log/people',
    ];
    for (const user of [U.backOffice, U.validator, U.closer]) {
      for (const path of reportPaths) expect([user.id, path, await status(path, user)]).toEqual([user.id, path, 403]);
      // Their own dashboard reads attendance rows - their own only.
      const own = await get('/tracking/attendance-report', user);
      expect(own.status).toBe(200);
      expect(own.body.rows.map((r: any) => r.employeeId)).toEqual([user.id]);
    }
  });

  it('agent productivity: SM sees all agents with dialer data; Team Lead only own agents, no dialer data; HR none', async () => {
    const sm = await get('/tracking/idle-summary', U.sm);
    expect(sm.status).toBe(200);
    const smCats = new Set(sm.body.employees.map((r: any) => r.category));
    expect(smCats.has('BACK_OFFICE')).toBe(false);
    expect(smCats.has('CLOSER')).toBe(true);
    expect(sm.body.employees[0]).toHaveProperty('threeCxSeconds');

    const tl = await get('/tracking/idle-summary', U.tl);
    expect(tl.body.employees.map((r: any) => r.employeeId)).toEqual([U.closer.id]);
    expect(tl.body.employees[0]).not.toHaveProperty('threeCxSeconds');
    expect(tl.body.employees[0]).toHaveProperty('idleSeconds');

    expect(await status('/tracking/idle-summary', U.hr)).toBe(403);
  });

  it('dialer + productivity report: Admin and SM only; HR attendance without dialer/productivity', async () => {
    expect(await status('/tracking/productivity-report', U.sm)).toBe(200);
    expect(await status('/tracking/productivity-report', U.admin)).toBe(200);
    for (const user of [U.hr, U.tl]) expect(await status('/tracking/productivity-report', user)).toBe(403);
    const hr = await get('/tracking/attendance-report', U.hr);
    expect(hr.status).toBe(200);
    expect(hr.body.rows[0]).not.toHaveProperty('threeCxSeconds');
    expect(hr.body.rows[0]).not.toHaveProperty('productivityPercentage');
    const tl = await get('/tracking/attendance-report', U.tl);
    expect(tl.body.rows.map((r: any) => r.employeeId)).toEqual([U.tl.id]);
  });

  it('activity logs: Admin all; SM Team Leads + Closers (not Back Office); Team Lead own agents only', async () => {
    const log = (user: any, target: any) => status(`/activity-log?userId=${target.id}`, user);
    expect(await log(U.admin, U.backOffice)).toBe(200);
    expect(await log(U.admin, U.validator)).toBe(200);
    expect(await log(U.sm, U.closer)).toBe(200);
    expect(await log(U.sm, U.tl)).toBe(200);
    expect(await log(U.sm, U.backOffice)).toBe(403);
    expect(await log(U.tl, U.closer)).toBe(200);
    expect(await log(U.tl, U.closer2)).toBe(403);
    expect(await log(U.hr, U.closer)).toBe(403);
    const people = await get('/activity-log/people', U.tl);
    expect(people.body.map((p: any) => p.id)).toEqual([U.closer.id]);
  });

  it("shift summary / snapshots: own data always; another person's only with productivity access", async () => {
    expect(await status(`/tracking/shift-summary/${U.backOffice.id}`, U.backOffice)).toBe(200);
    expect(await status(`/tracking/shift-summary/${U.closer.id}`, U.backOffice)).toBe(403);
    expect(await status(`/tracking/shift-summary/${U.closer.id}`, U.tl)).toBe(200);
    expect(await status(`/tracking/shift-summary/${U.closer2.id}`, U.tl)).toBe(403);
    expect(await status(`/tracking/idle-snapshots?employeeId=${U.closer.id}`, U.employee)).toBe(403);
  });

  it('Logs page: Admin & HR all; SM limited to agent login records; Team Lead none', async () => {
    auditLogsService.getLogs.mockClear();
    expect(await status('/audit-logs', U.sm)).toBe(200);
    expect(auditLogsService.getLogs.mock.calls[0][6]).toEqual({ allowedActions: ['LOGIN', 'CHECK_IN', 'OVERTIME_CHECK_IN', 'CHECK_OUT'], agentsOnly: true });
    expect(await status('/audit-logs', U.hr)).toBe(200);
    expect(auditLogsService.getLogs.mock.calls[1][6]).toBeUndefined();
    expect(await status('/audit-logs', U.tl)).toBe(403);
  });

  it('employees API: Admin/HR manage, SM may list, others not; nobody else can delete', async () => {
    expect(await status('/employees', U.hr)).toBe(200);
    expect(await status('/employees', U.sm)).toBe(200);
    expect(await status('/employees', U.tl)).toBe(403);
    const del = await request(app.getHttpServer()).delete(`/employees/${U.closer.id}`).set('Authorization', as(U.sm));
    expect(del.status).toBe(403);
  });

  it('lead-list uploads: Admin and Team Lead may; HR may not', async () => {
    const upload = (user: any) =>
      request(app.getHttpServer()).post('/tasks/sheets').set('Authorization', as(user)).attach('file', Buffer.from('a,b\n1,2'), 'leads.csv');
    expect((await upload(U.admin)).body.role).toBe('MANAGER');
    expect((await upload(U.tl)).body.role).toBe('MANAGER');
    expect((await upload(U.hr)).body.role).toBe('EMPLOYEE'); // the service refuses EMPLOYEE uploads
  });

  it('tracking uploads are always credited to the signed-in user, never a userId in the body', async () => {
    trackingService.upsertIdleSnapshot.mockClear();
    await request(app.getHttpServer())
      .post('/tracking/idle-snapshots')
      .set('Authorization', as(U.closer))
      .send({ userId: U.admin.id, date: '2026-11-17', activeSeconds: 1, idleSeconds: 0 });
    expect(trackingService.upsertIdleSnapshot.mock.calls[0][0].userId).toBe(U.closer.id);
    const res = await request(app.getHttpServer())
      .post('/activity-log/batch')
      .set('Authorization', as(U.backOffice))
      .send({ userId: U.admin.id, entries: [{ id: 'abcdef123456', app: 'Excel', title: 'Leads.xlsx - Excel', startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: new Date().toISOString() }] });
    expect(res.body.stored).toBe(1);
    expect(prisma.applicationUsage.createMany.mock.calls[0][0].data[0].userId).toBe(U.backOffice.id);
  });
});
