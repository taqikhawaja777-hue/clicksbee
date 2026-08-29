import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryRuleDto } from './dto/productivity.dto';
import { RuleType } from '@prisma/client';

@Injectable()
export class ProductivityService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateUserDailyProductivity(userId: string, organizationId: string, dateStr: string) {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const appUsages = await this.prisma.applicationUsage.findMany({
      where: {
        userId,
        organizationId,
        startedAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    const webUsages = await this.prisma.websiteUsage.findMany({
      where: {
        userId,
        organizationId,
        startedAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    const idleEvents = await this.prisma.activityEvent.findMany({
      where: {
        userId,
        organizationId,
        type: 'IDLE_ENDED',
        timestamp: { gte: startOfDay, lte: endOfDay },
      },
    });

    const breakSessions = await this.prisma.breakSession.findMany({
      where: {
        userId,
        organizationId,
        startedAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    let productiveSeconds = 0;
    let unproductiveSeconds = 0;

    appUsages.forEach((app) => {
      if (app.isProductive) {
        productiveSeconds += app.duration;
      } else {
        unproductiveSeconds += app.duration;
      }
    });

    webUsages.forEach((web) => {
      if (web.isProductive) {
        productiveSeconds += web.duration;
      } else {
        unproductiveSeconds += web.duration;
      }
    });

    const idleSeconds = idleEvents.reduce((acc, i) => {
      const meta = i.metadata as any;
      return acc + (meta?.idleDuration || 0);
    }, 0);

    const breakSeconds = breakSessions.reduce((acc, b) => acc + (b.duration || 0), 0);

    const activeSeconds = Math.max(0, productiveSeconds + unproductiveSeconds);
    const totalTrackedSeconds = activeSeconds + idleSeconds + breakSeconds;

    const productivityPercentage =
      totalTrackedSeconds > 0
        ? Math.round((productiveSeconds / totalTrackedSeconds) * 100 * 10) / 10
        : 0;

    const record = await this.prisma.productivityRecord.upsert({
      where: {
        userId_date: {
          userId,
          date: dateStr,
        },
      },
      update: {
        totalTrackedSeconds,
        productiveSeconds,
        idleSeconds,
        breakSeconds,
        activeSeconds,
        productivityPercentage,
      },
      create: {
        organizationId,
        userId,
        date: dateStr,
        totalTrackedSeconds,
        productiveSeconds,
        idleSeconds,
        breakSeconds,
        activeSeconds,
        productivityPercentage,
      },
    });

    return record;
  }

  async createCategoryRule(organizationId: string, dto: CreateCategoryRuleDto) {
    return this.prisma.categoryRule.create({
      data: {
        organizationId,
        type: dto.type,
        pattern: dto.pattern.toLowerCase(),
        category: dto.category,
        isProductive: dto.isProductive,
      },
    });
  }

  async getCategoryRules(organizationId: string) {
    return this.prisma.categoryRule.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCategoryRule(id: string, organizationId: string) {
    await this.prisma.categoryRule.deleteMany({
      where: { id, organizationId },
    });
    return { message: 'Category rule deleted' };
  }
}
