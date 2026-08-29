import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async globalSearch(organizationId: string, query: string, role: string) {
    if (!query || query.length < 2) return { users: [], projects: [], tasks: [] };

    const [users, projects, tasks] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          organizationId,
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
        take: 10,
      }),
      role !== 'EMPLOYEE' ? this.prisma.project.findMany({
        where: {
          organizationId,
          name: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, name: true, status: true },
        take: 10,
      }) : Promise.resolve([]),
      this.prisma.task.findMany({
        where: {
          organizationId,
          title: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, title: true, status: true, priority: true },
        take: 10,
      }),
    ]);

    return { users, projects, tasks };
  }
}
