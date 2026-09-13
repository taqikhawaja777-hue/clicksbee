import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { NotificationRecipientType, NotificationType, TaskStatus } from '@prisma/client';
import { AiTaskEstimatorService } from '../services/aiTaskEstimator';
import { NotificationsService } from '../notifications/notifications.service';

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
      message: `You've been assigned a new task: ${task.title}`,
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

    return updated;
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
