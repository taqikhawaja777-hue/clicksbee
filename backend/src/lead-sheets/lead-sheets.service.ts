import { BadRequestException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { NotificationRecipientType, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Category, categoryOf, CATEGORY_LABELS } from '../common/access/access.util';
import { decodeImage } from '../idle-reports/idle-reports.service';

export const LEAD_FIELDS = ['customerName', 'contact', 'address', 'offer', 'time', 'reference', 'customerResponse'] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export type LeadRow = Record<LeadField, string> & { id: string; chatProofId: string | null };

// The agent sends a sheet to ONE of these people (stored in LeadSheet.closerId).
export const RECIPIENT_CATEGORIES: Category[] = ['CLOSER', 'TEAM_LEAD', 'BACK_OFFICE'];

const MAX_ROWS = 1000;
const MAX_CELL = 1000;
const MAX_PROOF_BYTES = 1024 * 1024;

export interface SheetUser {
  id: string;
  organizationId: string;
  role: string;
  designation?: string | null;
  officeCategory?: string | null;
}

/** Rows from the app: known fields only, trimmed and bounded; blank rows dropped. */
export function sanitizeRows(input: unknown): LeadRow[] {
  if (!Array.isArray(input)) throw new BadRequestException('rows must be a list');
  if (input.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} customers per sheet`);
  const rows: LeadRow[] = [];
  input.forEach((raw, i) => {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const row = {
      id: typeof src.id === 'string' && /^[\w-]{1,40}$/.test(src.id) ? src.id : `r${Date.now().toString(36)}${i}`,
      chatProofId: typeof src.chatProofId === 'string' && /^[a-f0-9]{24}$/i.test(src.chatProofId) ? src.chatProofId : null,
    } as LeadRow;
    for (const f of LEAD_FIELDS) row[f] = String(src[f] ?? '').trim().slice(0, MAX_CELL);
    if (LEAD_FIELDS.some((f) => row[f]) || row.chatProofId) rows.push(row);
  });
  return rows;
}

type SheetRef = { createdBy: string; closerId: string | null; status: string };

/** Creator always; the chosen recipient once it is sent; Admin/Boss always. */
export function canViewSheet(sheet: SheetRef, user: SheetUser): boolean {
  if (categoryOf(user) === 'ADMIN') return true;
  if (sheet.createdBy === user.id) return true;
  return sheet.status === 'SENT' && sheet.closerId === user.id;
}

/**
 * Admin/Boss: everything (edit any time, delete, download). Agent (creator):
 * edits, sends or deletes the draft; after sending it is view only.
 * Recipient (Closer / Team Lead / Back Office): views and edits once it is
 * sent - never downloads.
 */
export function sheetRights(sheet: SheetRef, user: SheetUser) {
  const admin = categoryOf(user) === 'ADMIN';
  const creatorDraft = sheet.createdBy === user.id && sheet.status === 'DRAFT';
  const recipient = sheet.status === 'SENT' && sheet.closerId === user.id;
  return {
    canEdit: admin || creatorDraft || recipient,
    canSend: creatorDraft,
    canDelete: admin || creatorDraft,
    canDownload: admin,
  };
}

@Injectable()
export class LeadSheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** People a sheet can be sent to: Closers, Team Leads and Back Office. */
  async listRecipients(organizationId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true, designation: true, officeCategory: true },
      orderBy: { firstName: 'asc' },
    });
    return users
      .map((u) => ({ u, category: categoryOf(u) }))
      .filter(({ category }) => RECIPIENT_CATEGORIES.includes(category))
      .map(({ u, category }) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        category,
        roleLabel: CATEGORY_LABELS[category],
      }));
  }

  /** Mine (created), received (closer), and for Admin every sheet in the organization. */
  async list(user: SheetUser) {
    const isAdmin = categoryOf(user) === 'ADMIN';
    const sheets = await this.prisma.leadSheet.findMany({
      where: isAdmin
        ? { organizationId: user.organizationId }
        : { organizationId: user.organizationId, OR: [{ createdBy: user.id }, { closerId: user.id, status: 'SENT' }] },
      // No rows here - the list only needs the count (rowCount).
      select: { id: true, title: true, status: true, rowCount: true, createdBy: true, closerId: true, sentAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    const names = await this.namesFor(sheets.flatMap((s) => [s.createdBy, s.closerId].filter(Boolean) as string[]));
    return sheets.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      rowCount: s.rowCount ?? 0,
      createdBy: s.createdBy,
      createdByName: names.get(s.createdBy) || 'Unknown',
      closerId: s.closerId,
      closerName: s.closerId ? names.get(s.closerId) || 'Unknown' : null,
      sentAt: s.sentAt,
      updatedAt: s.updatedAt,
      mine: s.createdBy === user.id,
    }));
  }

  async create(user: SheetUser, title: string) {
    const clean = (title || '').trim().slice(0, 120);
    if (!clean) throw new BadRequestException('Give the sheet a name');
    const sheet = await this.prisma.leadSheet.create({
      data: { organizationId: user.organizationId, createdBy: user.id, title: clean, rows: [], rowCount: 0 },
    });
    return this.get(user, sheet.id);
  }

  async get(user: SheetUser, id: string) {
    const sheet = await this.load(user, id);
    const names = await this.namesFor([sheet.createdBy, sheet.closerId].filter(Boolean) as string[]);
    return {
      id: sheet.id,
      title: sheet.title,
      status: sheet.status,
      rows: sanitizeRows(sheet.rows),
      createdBy: sheet.createdBy,
      createdByName: names.get(sheet.createdBy) || 'Unknown',
      closerId: sheet.closerId,
      closerName: sheet.closerId ? names.get(sheet.closerId) || 'Unknown' : null,
      sentAt: sheet.sentAt,
      updatedAt: sheet.updatedAt,
      ...sheetRights(sheet, user),
    };
  }

  async update(user: SheetUser, id: string, changes: { title?: string; rows?: unknown }) {
    const sheet = await this.loadEditable(user, id);
    const data: Prisma.LeadSheetUpdateInput = {};
    if (changes.title !== undefined) {
      const title = changes.title.trim().slice(0, 120);
      if (!title) throw new BadRequestException('Give the sheet a name');
      data.title = title;
    }
    if (changes.rows !== undefined) {
      const rows = sanitizeRows(changes.rows);
      data.rows = rows as unknown as Prisma.InputJsonArray;
      data.rowCount = rows.length;
    }
    await this.prisma.leadSheet.update({ where: { id: sheet.id }, data });
    return this.get(user, id);
  }

  async remove(user: SheetUser, id: string) {
    const sheet = await this.load(user, id);
    if (!sheetRights(sheet, user).canDelete) throw new ForbiddenException('Only Admin can delete a sheet that was already sent');
    await this.prisma.leadChatProof.deleteMany({ where: { sheetId: sheet.id } });
    await this.prisma.leadSheet.delete({ where: { id: sheet.id } });
    return { deleted: true };
  }

  async send(user: SheetUser, id: string, closerId: string) {
    const sheet = await this.load(user, id);
    if (!sheetRights(sheet, user).canSend) {
      throw new BadRequestException('Only the person who made this draft can send it, and only once');
    }
    const rows = sanitizeRows(sheet.rows);
    if (rows.length === 0) throw new BadRequestException('Add at least one customer before sending');
    const recipient = (await this.listRecipients(user.organizationId)).find((c) => c.id === closerId);
    if (!recipient) throw new BadRequestException('Choose a Closer, Team Lead or Back Office person from your organization');

    await this.prisma.leadSheet.update({
      where: { id: sheet.id },
      data: { status: 'SENT', closerId, sentAt: new Date() },
    });
    const names = await this.namesFor([user.id]);
    await this.notifications.createSystemNotification({
      organizationId: user.organizationId,
      recipientType: NotificationRecipientType.EMPLOYEE,
      recipientUserId: closerId,
      type: NotificationType.LEAD_SHEET_RECEIVED,
      title: 'New Lead Sheet',
      message: `${names.get(user.id) || 'An employee'} sent you "${sheet.title}" (${rows.length} customer${rows.length === 1 ? '' : 's'}) to view and update. Open My Tasks > Lead Sheets.`,
      metadata: { leadSheetId: sheet.id },
    });
    return this.get(user, id);
  }

  async addProof(user: SheetUser, id: string, image: string) {
    const sheet = await this.loadEditable(user, id);
    const bytes = decodeImage(image, MAX_PROOF_BYTES);
    if (!bytes) throw new BadRequestException('The chat proof must be a JPEG or PNG image under 1 MB');
    const proof = await this.prisma.leadChatProof.create({
      data: { sheetId: sheet.id, uploadedBy: user.id, image: bytes },
      select: { id: true },
    });
    return { chatProofId: proof.id };
  }

  /** In-app viewing only (returned as data, never as a file download). */
  async getProof(user: SheetUser, id: string, proofId: string) {
    const sheet = await this.load(user, id);
    if (!/^[a-f0-9]{24}$/i.test(proofId || '')) throw new NotFoundException('Chat proof not found');
    const proof = await this.prisma.leadChatProof.findFirst({ where: { id: proofId, sheetId: sheet.id } });
    if (!proof) throw new NotFoundException('Chat proof not found');
    const bytes = Buffer.from(proof.image);
    const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
    return { image: `data:${mime};base64,${bytes.toString('base64')}` };
  }

  private async load(user: SheetUser, id: string) {
    if (!/^[a-f0-9]{24}$/i.test(id || '')) throw new NotFoundException('Lead sheet not found');
    const sheet = await this.prisma.leadSheet.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!sheet || !canViewSheet(sheet, user)) throw new NotFoundException('Lead sheet not found');
    return sheet;
  }

  private async loadEditable(user: SheetUser, id: string) {
    const sheet = await this.load(user, id);
    if (!sheetRights(sheet, user).canEdit) {
      throw new ForbiddenException(
        sheet.createdBy === user.id ? 'This sheet was already sent and can no longer be changed by you' : 'You cannot change this sheet',
      );
    }
    return sheet;
  }

  /** Admin/Boss only: the sheet as an Excel file (chat proofs are listed as attached / none). */
  async download(user: SheetUser, id: string): Promise<StreamableFile> {
    const sheet = await this.load(user, id);
    if (!sheetRights(sheet, user).canDownload) throw new ForbiddenException('Only Admin can download lead sheets');
    const rows = sanitizeRows(sheet.rows);
    const aoa = [
      ['Customer Name', 'Contact', 'Address', 'Offer', 'Time', 'Reference', 'Customer Response', 'Chat Proof'],
      ...rows.map((r) => [r.customerName, r.contact, r.address, r.offer, r.time, r.reference, r.customerResponse, r.chatProofId ? 'Attached (view in app)' : '']),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Leads');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const fileName = `${sheet.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Lead sheet'}.xlsx`;
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      length: buffer.length,
    });
  }

  private async namesFor(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }
}
