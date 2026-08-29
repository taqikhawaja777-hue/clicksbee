import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(userId: string, organizationId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
        status: dto.status || 'ACTIVE',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        managerId: dto.managerId || userId,
        createdBy: userId,
      },
    });
  }

  async getProjects(organizationId: string) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      projects.map(async (project) => {
        const calculatedProgress = await this.calculateProjectProgress(project.id);
        return {
          ...project,
          progress: calculatedProgress,
        };
      }),
    );
  }

  async getProjectById(id: string, organizationId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        tasks: {
          include: {
            assignee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          },
        },
      },
    });

    if (!project || project.organizationId !== organizationId) {
      throw new NotFoundException('Project not found');
    }

    const calculatedProgress = await this.calculateProjectProgress(project.id);
    return {
      ...project,
      progress: calculatedProgress,
    };
  }

  async updateProject(id: string, organizationId: string, dto: UpdateProjectDto) {
    await this.getProjectById(id, organizationId);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  async deleteProject(id: string, organizationId: string) {
    await this.getProjectById(id, organizationId);
    await this.prisma.project.delete({ where: { id } });
    return { message: 'Project deleted successfully' };
  }

  async calculateProjectProgress(projectId: string): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: { status: true },
    });

    if (tasks.length === 0) return 0;

    const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
    return Math.round((completed / tasks.length) * 100);
  }
}
