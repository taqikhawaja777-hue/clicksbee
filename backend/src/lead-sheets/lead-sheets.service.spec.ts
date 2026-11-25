import { BadRequestException, ForbiddenException, NotFoundException, StreamableFile } from '@nestjs/common';
import { canViewSheet, LeadSheetsService, sanitizeRows, sheetRights } from './lead-sheets.service';

const ORG = 'org1';
const AGENT = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', organizationId: ORG, role: 'EMPLOYEE', designation: 'Employee', officeCategory: null };
const CLOSER = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', organizationId: ORG, role: 'EMPLOYEE', designation: 'Closer', officeCategory: 'CLOSER' };
const BACK_OFFICE = { id: 'cccccccccccccccccccccccc', organizationId: ORG, role: 'EMPLOYEE', designation: 'Back Office', officeCategory: 'BACK_OFFICE' };
const ADMIN = { id: 'dddddddddddddddddddddddd', organizationId: ORG, role: 'ADMIN', designation: null, officeCategory: null };
const OTHER_AGENT = { ...AGENT, id: 'ffffffffffffffffffffffff' };
const SHEET_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

const ORG_USERS = [
  { ...AGENT, firstName: 'Ali', lastName: 'Raza' },
  { ...CLOSER, firstName: 'Sara', lastName: 'Closer' },
  { ...BACK_OFFICE, firstName: 'Bilal', lastName: 'Office' },
  { ...ADMIN, firstName: 'Boss', lastName: 'Admin' },
];

function setup(sheet: any) {
  const prisma: any = {
    leadSheet: {
      findFirst: jest.fn(async () => sheet),
      update: jest.fn(async ({ data }: any) => Object.assign(sheet, data)),
    },
    user: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id?.in ? ORG_USERS.filter((u) => where.id.in.includes(u.id)) : ORG_USERS,
      ),
    },
  };
  const notifications: any = { createSystemNotification: jest.fn(async () => ({})) };
  return { service: new LeadSheetsService(prisma, notifications), prisma, notifications };
}

const draft = () => ({
  id: SHEET_ID,
  organizationId: ORG,
  createdBy: AGENT.id,
  closerId: null as string | null,
  title: 'Monday leads',
  status: 'DRAFT',
  rows: [{ id: 'r1', customerName: 'Ahmed', contact: '0501234567', address: 'https://maps.app.goo.gl/qPy2Sobuk8b1TQAEA', offer: 'DEF 399' }],
  sentAt: null,
  updatedAt: new Date(),
});

describe('LeadSheetsService', () => {
  it('rows: known fields only, trimmed, blank rows dropped', () => {
    const rows = sanitizeRows([
      { customerName: '  Ahmed ', contact: '0501234567', hacked: 'x', chatProofId: 'not-an-id' },
      { customerName: '', contact: '   ' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerName: 'Ahmed', contact: '0501234567', address: '', chatProofId: null });
    expect(rows[0]).not.toHaveProperty('hacked');
    expect(() => sanitizeRows('nope')).toThrow(BadRequestException);
  });

  it('rights: agent edits/sends the draft; recipient views + edits once sent; only Admin downloads', () => {
    const d = draft();
    expect(sheetRights(d, AGENT)).toEqual({ canEdit: true, canSend: true, canDelete: true, canDownload: false });
    expect(canViewSheet({ ...d, closerId: CLOSER.id }, CLOSER)).toBe(false); // not sent yet

    const sent = { ...d, status: 'SENT', closerId: BACK_OFFICE.id };
    expect(sheetRights(sent, AGENT)).toEqual({ canEdit: false, canSend: false, canDelete: false, canDownload: false });
    expect(sheetRights(sent, BACK_OFFICE)).toEqual({ canEdit: true, canSend: false, canDelete: false, canDownload: false });
    expect(canViewSheet(sent, CLOSER)).toBe(false); // sent to someone else
    expect(sheetRights(sent, ADMIN)).toEqual({ canEdit: true, canSend: false, canDelete: true, canDownload: true });
  });

  it('send: to a Closer / Team Lead / Back Office person only, then that person can edit it', async () => {
    const sheet = draft();
    const { service, notifications } = setup(sheet);
    await expect(service.send(AGENT, SHEET_ID, OTHER_AGENT.id)).rejects.toBeInstanceOf(BadRequestException);

    const res = await service.send(AGENT, SHEET_ID, BACK_OFFICE.id);
    expect(res).toMatchObject({ status: 'SENT', closerId: BACK_OFFICE.id, closerName: 'Bilal Office', canEdit: false });
    expect(notifications.createSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: BACK_OFFICE.id, type: 'LEAD_SHEET_RECEIVED' }),
    );
    // The agent can no longer change it; the recipient can.
    await expect(service.update(AGENT, SHEET_ID, { rows: [] })).rejects.toBeInstanceOf(ForbiddenException);
    const edited = await service.update(BACK_OFFICE, SHEET_ID, { rows: [{ customerName: 'Ahmed', customerResponse: 'Confirmed' }] });
    expect(edited.rows[0]).toMatchObject({ customerResponse: 'Confirmed' });
  });

  it('download: Admin gets an Excel file; the recipient and the agent are refused', async () => {
    const { service } = setup({ ...draft(), status: 'SENT', closerId: CLOSER.id });
    await expect(service.download(CLOSER, SHEET_ID)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.download(AGENT, SHEET_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.download(ADMIN, SHEET_ID)).toBeInstanceOf(StreamableFile);
  });

  it('people outside the sheet cannot even see it', async () => {
    const { service } = setup(draft());
    await expect(service.update(CLOSER, SHEET_ID, { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
