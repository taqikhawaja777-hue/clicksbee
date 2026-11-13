import { BadRequestException, ForbiddenException, StreamableFile } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { TaskSheetsService } from './task-sheets.service';

const MANAGER = 'manager1';
const EMPLOYEE = 'employee1';
const OTHER_MANAGER = 'manager2';

const task = {
  id: 'task1',
  title: 'Call list',
  assignedTo: EMPLOYEE,
  assignedBy: MANAGER,
  assignee: { firstName: 'Test', lastName: 'Employee' },
};

function csvFile(text: string): Express.Multer.File {
  return { buffer: Buffer.from(text, 'utf-8'), originalname: 'calls.csv', mimetype: 'text/csv' } as Express.Multer.File;
}

/** In-memory stand-ins for Prisma, TasksService and NotificationsService. */
function setup() {
  let stored: any = null;
  const notifications: any[] = [];
  const pick = (row: any, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;

  const prisma: any = {
    taskSheet: {
      create: jest.fn(async ({ data, select }) => {
        stored = { id: 'sheet1', taskId: null, status: 'DRAFT', responses: null, answeredRows: 0, lastSavedAt: null, submittedAt: null, createdAt: new Date(), ...data };
        return pick(stored, select);
      }),
      findFirst: jest.fn(async ({ select }) => (stored && stored.taskId ? pick(stored, select) : null)),
      findUnique: jest.fn(async ({ select }) => pick(stored, select)),
      update: jest.fn(async ({ data, select }) => {
        stored = { ...stored, ...data };
        return pick(stored, select);
      }),
    },
    user: { findUnique: jest.fn(async () => ({ firstName: 'Main', lastName: 'Manager' })) },
  };
  const tasksService: any = { getTaskById: jest.fn(async () => task) };
  const notificationsService: any = { createSystemNotification: jest.fn(async (n) => notifications.push(n)) };
  const service = new TaskSheetsService(prisma, notificationsService, tasksService);
  const link = () => {
    stored.taskId = task.id;
  };
  return { service, notifications, link, getStored: () => stored };
}

describe('TaskSheetsService', () => {
  it('only lets managers upload, and rejects bad files with a readable message', async () => {
    const { service } = setup();
    await expect(service.upload(csvFile('Name,Number\nA,1'), EMPLOYEE, 'org', 'EMPLOYEE')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.upload(csvFile('Name,Number'), MANAGER, 'org', 'MANAGER')).rejects.toThrow(/No data rows/);
    const res = await service.upload(csvFile('Name,Number\nAli,03001234567\nSara,03331112222'), MANAGER, 'org', 'MANAGER');
    expect(res).toMatchObject({ sheetId: 'sheet1', totalRows: 2, columns: ['Name', 'Number'] });
  });

  it('gives the assignee cells but no file and no download, and the manager download rights', async () => {
    const { service, link } = setup();
    await service.upload(csvFile('Name,Number\nAli,03001234567'), MANAGER, 'org', 'MANAGER');
    link();

    const forEmployee = await service.getSheet(task.id, 'org', EMPLOYEE, 'EMPLOYEE');
    expect(forEmployee).not.toHaveProperty('originalFile');
    expect(forEmployee.sheets[0].rows[0]).toEqual(['Ali', '03001234567']);
    expect(forEmployee).toMatchObject({ canEdit: true, canDownload: false, canReopen: false });

    const forManager = await service.getSheet(task.id, 'org', OTHER_MANAGER, 'MANAGER');
    expect(forManager).toMatchObject({ canEdit: false, canDownload: true });

    await expect(service.download(task.id, 'org', EMPLOYEE, 'EMPLOYEE', 'original')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a manager-role assignee still cannot download the sheet they are filling in', async () => {
    const { service, link } = setup();
    await service.upload(csvFile('Name,Number\nAli,1'), MANAGER, 'org', 'MANAGER');
    link();
    const asAssigneeLead = { ...task, assignedTo: OTHER_MANAGER };
    (service as any).tasksService.getTaskById = jest.fn(async () => asAssigneeLead);
    await expect(service.download(task.id, 'org', OTHER_MANAGER, 'MANAGER', 'completed')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only the assignee can save; save -> submit locks it and notifies; manager reopens it', async () => {
    const { service, link, notifications, getStored } = setup();
    await service.upload(csvFile('Name,Number\nAli,1\nSara,2'), MANAGER, 'org', 'MANAGER');
    link();

    await expect(service.save(task.id, 'org', MANAGER, 'MANAGER', { '0:0': { response: 'Responded' } })).rejects.toBeInstanceOf(ForbiddenException);

    const saved = await service.save(task.id, 'org', EMPLOYEE, 'EMPLOYEE', { '0:0': { response: 'Responded', remarks: 'Wants demo' } });
    expect(saved.answeredRows).toBe(1);
    expect(getStored().status).toBe('DRAFT');

    await service.submit(task.id, 'org', EMPLOYEE, 'EMPLOYEE', { '0:1': { response: 'Wrong Number' } });
    expect(getStored()).toMatchObject({ status: 'SUBMITTED', answeredRows: 2 });
    expect(notifications.pop()).toMatchObject({ recipientType: 'ADMIN', title: 'Spreadsheet Submitted' });

    await expect(service.save(task.id, 'org', EMPLOYEE, 'EMPLOYEE', { '0:0': { remarks: 'late edit' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reopen(task.id, 'org', EMPLOYEE, 'EMPLOYEE')).rejects.toBeInstanceOf(ForbiddenException);

    await service.reopen(task.id, 'org', MANAGER, 'MANAGER', 'Add remarks for Sara');
    expect(getStored()).toMatchObject({ status: 'DRAFT', submittedAt: null });
    expect(notifications.pop()).toMatchObject({ recipientType: 'EMPLOYEE', recipientUserId: EMPLOYEE, title: 'Spreadsheet Sent Back' });
  });

  it('manager downloads the original bytes and a completed xlsx with the responses', async () => {
    const { service, link } = setup();
    const csv = 'Name,Number\nAli,03001234567';
    await service.upload(csvFile(csv), MANAGER, 'org', 'MANAGER');
    link();
    await service.save(task.id, 'org', EMPLOYEE, 'EMPLOYEE', { '0:0': { response: 'Call Back Later', remarks: 'After 5pm' } });

    const original = await service.download(task.id, 'org', MANAGER, 'MANAGER', 'original');
    expect(original).toBeInstanceOf(StreamableFile);
    expect(original.getHeaders().disposition).toContain('calls.csv');

    const completed = await service.download(task.id, 'org', MANAGER, 'MANAGER', 'completed');
    expect(completed.getHeaders().disposition).toContain('calls - completed.xlsx');
    const chunks: Buffer[] = [];
    for await (const chunk of completed.getStream()) chunks.push(chunk as Buffer);
    const wb = XLSX.read(Buffer.concat(chunks), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    expect(rows[1].slice(0, 4)).toEqual(['Ali', '03001234567', 'Call Back Later', 'After 5pm']);
  });
});
