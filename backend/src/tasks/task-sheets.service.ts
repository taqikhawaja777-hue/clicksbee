import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationRecipientType, NotificationType, TaskSheetStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from './tasks.service';
import {
  buildCompletedWorkbook,
  mergeResponses,
  parseSpreadsheet,
  ParsedSheet,
  RESPONSE_OPTIONS,
  SheetResponseInput,
  SheetResponses,
  SheetValidationError,
} from './task-sheet.util';

/** Everything except the file bytes - the assignee never receives the file. */
const SHEET_SELECT = {
  id: true,
  taskId: true,
  fileName: true,
  sheets: true,
  responses: true,
  status: true,
  totalRows: true,
  answeredRows: true,
  lastSavedAt: true,
  submittedAt: true,
  createdAt: true,
} as const;

const MIME_BY_EXT: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
};

type TaskForSheet = {
  id: string;
  title: string;
  assignedTo: string | null;
  assignedBy: string | null;
  assignee?: { firstName: string; lastName: string } | null;
};

const fullName = (u?: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}`.trim() : 'An employee';

function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Injectable()
export class TaskSheetsService {
  private readonly logger = new Logger(TaskSheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly tasksService: TasksService,
  ) {}

  /**
   * The person filling the sheet may never take the file out - even a
   * manager-role assignee - unless they assigned the task to themselves.
   */
  private permissions(task: TaskForSheet, reqUserId: string, role: string) {
    const isAssignee = task.assignedTo === reqUserId;
    const isManager = role !== 'EMPLOYEE' && (!isAssignee || task.assignedBy === reqUserId);
    return { isAssignee, isManager };
  }

  private async loadSheet(taskId: string) {
    const sheet = await this.prisma.taskSheet.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: SHEET_SELECT,
    });
    if (!sheet) throw new NotFoundException('This task has no spreadsheet');
    return sheet;
  }

  private parsedSheets(sheet: { sheets: unknown }): ParsedSheet[] {
    return (sheet.sheets as unknown as ParsedSheet[]) || [];
  }

  async upload(file: Express.Multer.File | undefined, userId: string, organizationId: string, role: string) {
    if (role === 'EMPLOYEE') {
      throw new ForbiddenException('Only managers can attach a fill-in spreadsheet');
    }
    if (!file) throw new BadRequestException('file is required');

    let parsed: { sheets: ParsedSheet[]; totalRows: number };
    try {
      parsed = parseSpreadsheet(file.buffer, file.originalname);
    } catch (err) {
      if (err instanceof SheetValidationError) throw new BadRequestException(err.message);
      throw err;
    }

    const sheet = await this.prisma.taskSheet.create({
      data: {
        organizationId,
        uploadedBy: userId,
        fileName: file.originalname,
        mimeType: file.mimetype || null,
        originalFile: file.buffer,
        sheets: parsed.sheets as any,
        totalRows: parsed.totalRows,
      },
      select: { id: true },
    });

    return {
      sheetId: sheet.id,
      fileName: file.originalname,
      sheetCount: parsed.sheets.length,
      totalRows: parsed.totalRows,
      columns: parsed.sheets[0].header,
    };
  }

  async getSheet(taskId: string, organizationId: string, reqUserId: string, role: string) {
    const task = (await this.tasksService.getTaskById(taskId, organizationId, reqUserId, role)) as TaskForSheet;
    const sheet = await this.loadSheet(task.id);
    const { isAssignee, isManager } = this.permissions(task, reqUserId, role);

    return {
      ...sheet,
      responses: (sheet.responses as unknown as SheetResponses) || {},
      taskTitle: task.title,
      assigneeName: fullName(task.assignee),
      responseOptions: RESPONSE_OPTIONS,
      canEdit: isAssignee && sheet.status === TaskSheetStatus.DRAFT,
      canDownload: isManager,
      canReopen: isManager && sheet.status === TaskSheetStatus.SUBMITTED,
    };
  }

  private async saveChanges(
    taskId: string,
    organizationId: string,
    reqUserId: string,
    role: string,
    changes: SheetResponseInput | undefined,
    submit: boolean,
  ) {
    const task = (await this.tasksService.getTaskById(taskId, organizationId, reqUserId, role)) as TaskForSheet;
    if (task.assignedTo !== reqUserId) {
      throw new ForbiddenException('Only the person this task is assigned to can fill in the spreadsheet');
    }
    const sheet = await this.loadSheet(task.id);
    if (sheet.status !== TaskSheetStatus.DRAFT) {
      throw new BadRequestException('This spreadsheet was already sent to your manager. Ask them to send it back to make changes.');
    }

    let merged: { responses: SheetResponses; answeredRows: number };
    try {
      merged = mergeResponses(this.parsedSheets(sheet), sheet.responses as unknown as SheetResponses, changes || {});
    } catch (err) {
      if (err instanceof SheetValidationError) throw new BadRequestException(err.message);
      throw err;
    }

    const now = new Date();
    const updated = await this.prisma.taskSheet.update({
      where: { id: sheet.id },
      data: {
        responses: merged.responses as any,
        answeredRows: merged.answeredRows,
        lastSavedAt: now,
        ...(submit ? { status: TaskSheetStatus.SUBMITTED, submittedAt: now } : {}),
      },
      select: { status: true, responses: true, answeredRows: true, totalRows: true, lastSavedAt: true, submittedAt: true },
    });

    if (submit) {
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.ADMIN,
        type: NotificationType.TASK_REPLY,
        title: 'Spreadsheet Submitted',
        message: `${fullName(task.assignee)} sent "${sheet.fileName}" for task: ${task.title} — ${updated.answeredRows}/${updated.totalRows} rows have a client response. Open Create Task → View responses.`,
        metadata: { taskId: task.id, sheetId: sheet.id },
      });
    }

    return updated;
  }

  save(taskId: string, organizationId: string, reqUserId: string, role: string, changes: SheetResponseInput) {
    return this.saveChanges(taskId, organizationId, reqUserId, role, changes, false);
  }

  submit(taskId: string, organizationId: string, reqUserId: string, role: string, changes?: SheetResponseInput) {
    return this.saveChanges(taskId, organizationId, reqUserId, role, changes, true);
  }

  /** Manager sends a submitted sheet back to the assignee for changes. */
  async reopen(taskId: string, organizationId: string, reqUserId: string, role: string, note?: string) {
    const task = (await this.tasksService.getTaskById(taskId, organizationId, reqUserId, role)) as TaskForSheet;
    if (!this.permissions(task, reqUserId, role).isManager) {
      throw new ForbiddenException('Only a manager can send the spreadsheet back');
    }
    const sheet = await this.loadSheet(task.id);
    if (sheet.status !== TaskSheetStatus.SUBMITTED) {
      throw new BadRequestException('This spreadsheet has not been sent yet');
    }

    const updated = await this.prisma.taskSheet.update({
      where: { id: sheet.id },
      data: { status: TaskSheetStatus.DRAFT, submittedAt: null },
      select: { status: true, answeredRows: true, totalRows: true, lastSavedAt: true, submittedAt: true },
    });

    if (task.assignedTo) {
      const manager = await this.prisma.user.findUnique({
        where: { id: reqUserId },
        select: { firstName: true, lastName: true },
      });
      const trimmedNote = note?.trim();
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.EMPLOYEE,
        recipientUserId: task.assignedTo,
        type: NotificationType.TASK_REPLY,
        title: 'Spreadsheet Sent Back',
        message: `${manager ? fullName(manager) : 'Your manager'} sent back "${sheet.fileName}" on task: ${task.title} for changes${trimmedNote ? ` — ${trimmedNote}` : ''}`,
        metadata: { taskId: task.id, sheetId: sheet.id },
      });
    }

    return updated;
  }

  /** Manager-only download: the original file, or the completed .xlsx with the assignee's columns. */
  async download(
    taskId: string,
    organizationId: string,
    reqUserId: string,
    role: string,
    version: 'original' | 'completed',
  ): Promise<StreamableFile> {
    const task = (await this.tasksService.getTaskById(taskId, organizationId, reqUserId, role)) as TaskForSheet;
    if (!this.permissions(task, reqUserId, role).isManager) {
      throw new ForbiddenException('Only a manager can download this spreadsheet');
    }
    const meta = await this.loadSheet(task.id);

    if (version === 'original') {
      const file = await this.prisma.taskSheet.findUnique({
        where: { id: meta.id },
        select: { originalFile: true, mimeType: true },
      });
      const ext = (meta.fileName.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
      const buffer = Buffer.from(file!.originalFile);
      return new StreamableFile(buffer, {
        type: MIME_BY_EXT[ext] || file!.mimeType || 'application/octet-stream',
        disposition: attachmentDisposition(meta.fileName),
        length: buffer.length,
      });
    }

    const buffer = buildCompletedWorkbook(this.parsedSheets(meta), meta.responses as unknown as SheetResponses, {
      taskTitle: task.title,
      assigneeName: fullName(task.assignee),
      status: meta.status,
      submittedAt: meta.submittedAt,
    });
    const baseName = meta.fileName.replace(/\.[^.]+$/, '');
    return new StreamableFile(buffer, {
      type: MIME_BY_EXT['.xlsx'],
      disposition: attachmentDisposition(`${baseName} - completed.xlsx`),
      length: buffer.length,
    });
  }

  /** Uploads that never got attached to a task (form abandoned) are removed after a day. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepUnlinkedSheets() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.taskSheet.deleteMany({
      where: { createdAt: { lt: cutoff }, OR: [{ taskId: null }, { taskId: { isSet: false } }] },
    });
    if (count > 0) this.logger.log(`Removed ${count} spreadsheet upload(s) never attached to a task.`);
  }
}
