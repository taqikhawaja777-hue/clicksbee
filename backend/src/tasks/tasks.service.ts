import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { TaskStatus } from '@prisma/client';
import { AiTaskEstimatorService } from '../services/aiTaskEstimator';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiTaskEstimator: AiTaskEstimatorService,
  ) {}

  async createTask(userId: string, organizationId: string, dto: CreateTaskDto) {
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

    return this.prisma.task.create({
      data: {
        organizationId,
        projectId: dto.projectId,
        assignedTo: dto.assignedTo || userId,
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

    return this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt,
        actualMinutes,
      },
    });
  }
}
