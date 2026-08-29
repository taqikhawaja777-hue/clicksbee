import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePolicyDto } from './dto/policy.dto';

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async createPolicy(organizationId: string, dto: CreatePolicyDto) {
    if (dto.isDefault) {
      await this.prisma.monitoringPolicy.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.monitoringPolicy.create({
      data: {
        organizationId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        minScreenshotInterval: dto.minScreenshotInterval ?? 300,
        maxScreenshotInterval: dto.maxScreenshotInterval ?? 900,
        screenshotEnabled: dto.screenshotEnabled ?? true,
        idleTimeoutSeconds: dto.idleTimeoutSeconds ?? 300,
        applicationTrackingEnabled: dto.applicationTrackingEnabled ?? true,
        websiteTrackingEnabled: dto.websiteTrackingEnabled ?? true,
        captureOnActivity: dto.captureOnActivity ?? false,
        retentionDays: dto.retentionDays ?? 30,
      },
    });
  }

  async getPolicies(organizationId: string) {
    return this.prisma.monitoringPolicy.findMany({
      where: { organizationId },
      orderBy: { isDefault: 'desc' },
    });
  }

  async getPolicyById(id: string, organizationId: string) {
    const policy = await this.prisma.monitoringPolicy.findUnique({ where: { id } });
    if (!policy || policy.organizationId !== organizationId) {
      throw new NotFoundException('Monitoring policy not found');
    }
    return policy;
  }

  async updatePolicy(id: string, organizationId: string, dto: Partial<CreatePolicyDto>) {
    await this.getPolicyById(id, organizationId);

    if (dto.isDefault) {
      await this.prisma.monitoringPolicy.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.monitoringPolicy.update({
      where: { id },
      data: dto,
    });
  }

  async deletePolicy(id: string, organizationId: string) {
    const policy = await this.getPolicyById(id, organizationId);
    if (policy.isDefault) {
      throw new NotFoundException('Cannot delete default organization monitoring policy');
    }
    await this.prisma.monitoringPolicy.delete({ where: { id } });
    return { message: 'Policy deleted successfully' };
  }

  async getClientConfig(userId: string, organizationId: string) {
    const userPolicy = await this.prisma.userPolicy.findFirst({
      where: { userId },
      include: { policy: true },
    });

    let effectivePolicy = userPolicy?.policy;

    if (!effectivePolicy) {
      effectivePolicy = await this.prisma.monitoringPolicy.findFirst({
        where: { organizationId, isDefault: true },
      });
    }

    if (!effectivePolicy) {
      effectivePolicy = await this.prisma.monitoringPolicy.findFirst({
        where: { organizationId },
      });
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workingHoursStart: true, workingHoursEnd: true, timezone: true },
    });

    return {
      idleTimeoutSeconds: effectivePolicy?.idleTimeoutSeconds || 300,
      screenshotEnabled: effectivePolicy?.screenshotEnabled ?? true,
      screenshotMinInterval: effectivePolicy?.minScreenshotInterval || 300,
      screenshotMaxInterval: effectivePolicy?.maxScreenshotInterval || 900,
      applicationTrackingEnabled: effectivePolicy?.applicationTrackingEnabled ?? true,
      websiteTrackingEnabled: effectivePolicy?.websiteTrackingEnabled ?? true,
      workingHours: {
        start: org?.workingHoursStart || '09:00',
        end: org?.workingHoursEnd || '17:00',
      },
      timezone: org?.timezone || 'UTC',
    };
  }
}
