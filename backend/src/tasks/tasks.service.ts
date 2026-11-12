import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto, TaskReplyDto, UpdateTaskDto } from './dto/task.dto';
import { NotificationRecipientType, NotificationType, Role, TaskStatus } from '@prisma/client';
import { AiTaskEstimatorService } from '../services/aiTaskEstimator';
import { NotificationsService } from '../notifications/notifications.service';
import { getShiftDayString, getShiftDayWindow } from '../common/utils/shift-day.util';
import {
  computeTaskProductivity,
  estimateAccuracy,
  isOnTime,
  weightedMinutes,
  TASK_PRODUCTIVITY_CONFIG,
} from './task-productivity.util';

const OPEN_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiTaskEstimator: AiTaskEstimatorService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createTask(userId: string, organizationId: string, dto: CreateTaskDto) {
    let assignedTo = dto.assignedTo || userId;

    if (dto.assignedToEmail) {
      const assignee = await this.prisma.user.findUnique({
        where: { email: dto.assignedToEmail.toLowerCase().trim() },
      });
      if (!assignee || assignee.organizationId !== organizationId) {
        throw new NotFoundException(`No employee found with email ${dto.assignedToEmail}`);
      }
      assignedTo = assignee.id;
    }

    let estimatedTimeMinutes = dto.estimatedMinutes || 0;

    if (!estimatedTimeMinutes || estimatedTimeMinutes === 0) {
      try {
        const estResult = await this.aiTaskEstimator.estimateTask(
          dto.title,
          dto.description,
          dto.priority,
        );
        estimatedTimeMinutes = estResult.estimatedTimeMinutes;
      } catch (err) {
        estimatedTimeMinutes = 60;
      }
    }

    const task = await this.prisma.task.create({
      data: {
        organizationId,
        projectId: dto.projectId,
        assignedTo,
        assignedBy: userId,
        title: dto.title,
        description: dto.description,
        status: dto.status || TaskStatus.TODO,
        priority: dto.priority || 'MEDIUM',
        estimatedMinutes: estimatedTimeMinutes,
        estimatedTimeMinutes: estimatedTimeMinutes,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        attachmentUrl: dto.attachmentUrl || null,
        attachmentName: dto.attachmentName || null,
      },
    });

    // Personal notification to whoever it's actually assigned to - not the
    // creator (who, per requirement 8, is the manager and already knows
    // they just created it). Self-assigned tasks (assignedTo === userId,
    // the default above) still get one - "your own task list changed" is
    // exactly the kind of personal status confirmation the Employee
    // Portal feed is for.
    await this.notificationsService.createSystemNotification({
      organizationId,
      recipientType: NotificationRecipientType.EMPLOYEE,
      recipientUserId: assignedTo,
      type: NotificationType.TASK_ASSIGNED,
      title: 'New Task Assigned',
      message: `You've been assigned a new task: ${task.title}${task.attachmentUrl ? ' (document attached)' : ''}`,
      attachmentUrl: task.attachmentUrl,
      attachmentName: task.attachmentName,
      metadata: { taskId: task.id },
    });

    return task;
  }

  async getTasks(
    organizationId: string,
    reqUserId: string,
    role: string,
    projectId?: string,
    status?: TaskStatus,
  ) {
    const where: any = { organizationId };

    if (role === 'EMPLOYEE') {
      where.assignedTo = reqUserId;
    }

    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    return this.prisma.task.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        assigner: { select: { id: true, firstName: true, lastName: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          include: { uploader: { select: { id: true, firstName: true, lastName: true, role: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTaskById(id: string, organizationId: string, reqUserId: string, role: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        assigner: { select: { id: true, firstName: true, lastName: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          include: { uploader: { select: { id: true, firstName: true, lastName: true, role: true } } },
        },
      },
    });

    if (!task || task.organizationId !== organizationId) {
      throw new NotFoundException('Task not found');
    }

    if (role === 'EMPLOYEE' && task.assignedTo !== reqUserId) {
      throw new ForbiddenException('Access denied to unassigned task');
    }

    return task;
  }

  async addReply(
    id: string,
    organizationId: string,
    reqUserId: string,
    role: string,
    dto: TaskReplyDto,
  ) {
    const task = await this.getTaskById(id, organizationId, reqUserId, role);
    const note = dto.note?.trim();
    if (!note && !dto.attachmentUrl) {
      throw new BadRequestException('A note or an attachment is required');
    }

    const reply = await this.prisma.taskAttachment.create({
      data: {
        organizationId,
        taskId: task.id,
        uploadedBy: reqUserId,
        note: note || null,
        fileUrl: dto.attachmentUrl || null,
        fileName: dto.attachmentName || null,
      },
      include: { uploader: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });

    const senderName = `${reply.uploader.firstName} ${reply.uploader.lastName}`.trim();
    const action = dto.attachmentName ? `sent "${dto.attachmentName}"` : 'replied';
    const message = `${senderName} ${action} on task: ${task.title}${note ? ` — ${note}` : ''}`;
    const fromAssignee = task.assignedTo === reqUserId;

    // The assignee's replies land in the shared manager feed; a manager's
    // follow-up goes to the assignee's own inbox.
    if (fromAssignee) {
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.ADMIN,
        type: NotificationType.TASK_REPLY,
        title: 'Task Reply',
        message,
        attachmentUrl: dto.attachmentUrl,
        attachmentName: dto.attachmentName,
        metadata: { taskId: task.id },
      });
    } else if (task.assignedTo) {
      await this.notificationsService.createSystemNotification({
        organizationId,
        recipientType: NotificationRecipientType.EMPLOYEE,
        recipientUserId: task.assignedTo,
        type: NotificationType.TASK_REPLY,
        title: 'Task Update',
        message,
        attachmentUrl: dto.attachmentUrl,
        attachmentName: dto.attachmentName,
        metadata: { taskId: task.id },
      });
    }

    return reply;
  }

  async updateTask(
    id: string,
    organizationId: string,
    reqUserId: string,
    role: string,
    dto: UpdateTaskDto,
  ) {
    const task = await this.getTaskById(id, organizationId, reqUserId, role);

    const updated = await this.prisma.task.update({
      where: { id: task.id },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });

    return updated;
  }

  async deleteTask(id: string, organizationId: string, reqUserId: string, role: string) {
    const task = await this.getTaskById(id, organizationId, reqUserId, role);
    if (role === 'EMPLOYEE') {
      throw new ForbiddenException('Employees cannot delete tasks');
    }

    await this.prisma.task.delete({ where: { id: task.id } });
    return { message: 'Task deleted successfully' };
  }

  async startTask(id: string, organizationId: string, reqUserId: string, role: string) {
    const task = await this.getTaskById(id, organizationId, reqUserId, role);

    return this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });
  }

  async completeTask(id: string, organizationId: string, reqUserId: string, role: string) {
    const task = await this.getTaskById(id, organizationId, reqUserId, role);

    const completedAt = new Date();
    let actualMinutes = task.actualMinutes;
    if (task.startedAt) {
      actualMinutes = Math.round(
        (completedAt.getTime() - task.startedAt.getTime()) / (1000 * 60),
      );
    }

    const updated = await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt,
        actualMinutes,
        ticketNumber: task.ticketNumber || `TKT-${completedAt.getTime().toString(36).toUpperCase()}`,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        assigner: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const assigneeName = (task as any).assignee
      ? `${(task as any).assignee.firstName} ${(task as any).assignee.lastName}`.trim()
      : 'An employee';
    await this.notificationsService.createSystemNotification({
      organizationId,
      recipientType: NotificationRecipientType.ADMIN,
      type: NotificationType.TASK_COMPLETED,
      title: 'Task Completed',
      message: `${assigneeName} completed task: ${task.title}`,
    });

    return { ...updated, onTime: isOnTime(completedAt, updated.dueDate) };
  }

  /**
   * Task-based productivity for every non-employee team member (manager,
   * HR, SM, team lead, CSR) over an inclusive shift-day range. "Team" means
   * tasks the member assigned; "own" means tasks assigned to them.
   */
  async getTeamProductivity(organizationId: string, from?: string, to?: string) {
    const today = getShiftDayString();
    const fromDay = from || today;
    const toDay = to || fromDay;
    if (!DATE_RE.test(fromDay) || !DATE_RE.test(toDay) || fromDay > toDay) {
      throw new BadRequestException('from/to must be YYYY-MM-DD and from must not be after to');
    }
    // Full Asia/Karachi calendar days, not the 10:00-19:00 shift window -
    // a manager completing a task at 8pm still gets credit for that day.
    const start = new Date(`${fromDay}T00:00:00.000+05:00`);
    const end = new Date(`${toDay}T23:59:59.999+05:00`);
    const periodDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const now = new Date();
    const todayWindow = { start: new Date(`${today}T00:00:00.000+05:00`), end: new Date(`${today}T23:59:59.999+05:00`) };
    const inWindow = (d: Date | null) => !!d && d >= start && d <= end;

    const [members, tasks] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId, role: { not: Role.EMPLOYEE }, isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, designation: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.task.findMany({
        where: {
          organizationId,
          OR: [
            { createdAt: { gte: start, lte: end } },
            { completedAt: { gte: start, lte: end } },
            { status: { in: OPEN_STATUSES } },
          ],
        },
        include: { assignee: { select: { firstName: true, lastName: true } } },
      }),
    ]);

    const fullName = (u: { firstName: string; lastName: string } | null | undefined) =>
      u ? `${u.firstName} ${u.lastName}`.trim() : '—';

    const rows = members.map((member) => {
      const mine = tasks.filter((t) => t.assignedBy === member.id || t.assignedTo === member.id);
      const completedInPeriod = mine.filter((t) => t.status === TaskStatus.COMPLETED && inWindow(t.completedAt));
      const estimateAccuracies = completedInPeriod
        .map((t) => estimateAccuracy(t.estimatedMinutes, t.actualMinutes))
        .filter((v): v is number => v !== null);
      const withDue = completedInPeriod.filter((t) => !!t.dueDate);

      const stats = {
        tasksCreated: mine.filter((t) => t.assignedBy === member.id && inWindow(t.createdAt)).length,
        teamCompleted: completedInPeriod.filter((t) => t.assignedBy === member.id && t.assignedTo !== member.id).length,
        ownCompleted: completedInPeriod.filter((t) => t.assignedTo === member.id).length,
        completedWithDueDate: withDue.length,
        completedOnTime: withDue.filter((t) => isOnTime(t.completedAt!, t.dueDate) === true).length,
        completedWeightedMinutes: completedInPeriod.reduce(
          (sum, t) => sum + weightedMinutes(t.estimatedMinutes, t.priority),
          0,
        ),
        estimateAccuracies,
        overdueOpen: mine.filter((t) => OPEN_STATUSES.includes(t.status) && !!t.dueDate && t.dueDate < now).length,
        periodDays,
      };
      const result = computeTaskProductivity(stats);
      const inProgress = mine
        .filter((t) => t.status === TaskStatus.IN_PROGRESS)
        .map((t) => ({ taskId: t.id, title: t.title, assigneeName: fullName(t.assignee), startedAt: t.startedAt }));

      return {
        userId: member.id,
        name: fullName(member),
        email: member.email,
        role: member.role,
        designation: member.designation,
        tasksCreated: stats.tasksCreated,
        teamCompleted: stats.teamCompleted,
        ownCompleted: stats.ownCompleted,
        completedOnTime: stats.completedOnTime,
        completedWithDueDate: stats.completedWithDueDate,
        overdueOpen: stats.overdueOpen,
        openTasks: mine.filter((t) => OPEN_STATUSES.includes(t.status)).length,
        inProgress,
        ...result,
      };
    });

    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const active = rows.filter((r) => r.hasActivity);

    return {
      from: fromDay,
      to: toDay,
      periodDays,
      config: TASK_PRODUCTIVITY_CONFIG,
      summary: {
        avgScore: active.length ? Math.round((active.reduce((s, r) => s + r.score, 0) / active.length) * 10) / 10 : 0,
        activeMemberCount: active.length,
        memberCount: rows.length,
        ticketsGeneratedToday: tasks.filter(
          (t) => t.status === TaskStatus.COMPLETED && !!t.completedAt && t.completedAt >= todayWindow.start && t.completedAt <= todayWindow.end,
        ).length,
      },
      members: rows,
    };
  }

  /** Completed tasks are the tickets. Optional userId = tasks they assigned or were assigned. */
  async getTickets(
    organizationId: string,
    reqUserId: string,
    role: string,
    userId?: string,
    page = 1,
    pageSize = 50,
  ) {
    const where: any = { organizationId, status: TaskStatus.COMPLETED };
    if (role === 'EMPLOYEE') {
      where.assignedTo = reqUserId;
    } else if (userId) {
      where.OR = [{ assignedBy: userId }, { assignedTo: userId }];
    }
    const take = Math.min(200, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip,
        take,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          assigner: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: items.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        taskId: t.id,
        title: t.title,
        priority: t.priority,
        assigneeName: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim() : null,
        assignerName: t.assigner ? `${t.assigner.firstName} ${t.assigner.lastName}`.trim() : null,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.actualMinutes,
        estimateAccuracy: estimateAccuracy(t.estimatedMinutes, t.actualMinutes),
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        dueDate: t.dueDate,
        onTime: t.completedAt ? isOnTime(t.completedAt, t.dueDate) : null,
      })),
      pagination: { page, limit: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  /**
   * Notifies admins once per task the moment it crosses its due date
   * without being completed/cancelled - overdueNotified guards against
   * re-notifying every day it stays overdue. Runs hourly rather than
   * daily-at-midnight so a task due mid-afternoon doesn't wait until the
   * next day to be flagged.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async notifyOverdueTasks() {
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        dueDate: { lt: new Date() },
        status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        overdueNotified: false,
      },
      include: {
        assignee: { select: { firstName: true, lastName: true } },
      },
    });

    for (const task of overdueTasks) {
      const assigneeName = task.assignee
        ? `${task.assignee.firstName} ${task.assignee.lastName}`.trim()
        : 'An employee';
      try {
        await this.notificationsService.createSystemNotification({
          organizationId: task.organizationId,
          recipientType: NotificationRecipientType.ADMIN,
          type: NotificationType.TASK_OVERDUE,
          title: 'Task Overdue',
          message: `Task "${task.title}" assigned to ${assigneeName} is overdue`,
        });
        await this.prisma.task.update({ where: { id: task.id }, data: { overdueNotified: true } });
      } catch (err) {
        this.logger.warn(`Failed to send overdue notification for task ${task.id}: ${err}`);
      }
    }

    if (overdueTasks.length > 0) {
      this.logger.log(`Overdue-task sweep: notified for ${overdueTasks.length} task(s).`);
    }
  }
}
