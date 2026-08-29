import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicensePlan, LicenseStatus } from '@prisma/client';

@Injectable()
export class LicensesService {
  constructor(private readonly prisma: PrismaService) {}

  async getLicenseInfo(organizationId: string) {
    const license = await this.prisma.license.findFirst({
      where: { organizationId, status: LicenseStatus.ACTIVE },
    });

    if (!license) {
      throw new NotFoundException('Active license not found');
    }

    const currentUsers = await this.prisma.user.count({
      where: { organizationId, isActive: true },
    });

    return {
      license,
      usage: {
        currentUsers,
        maxUsers: license.maxEmployees,
        isNearLimit: currentUsers >= license.maxEmployees * 0.9,
      }
    };
  }

  async checkUserLimit(organizationId: string) {
    const info = await this.getLicenseInfo(organizationId);
    if (info.usage.currentUsers >= info.usage.maxUsers) {
      throw new BadRequestException('License limit reached. Cannot add more users.');
    }
    return true;
  }
}
