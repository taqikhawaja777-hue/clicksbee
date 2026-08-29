import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Managers and Admins are exempt from employee consent guard
    if (user && (user.role === 'ADMIN' || user.role === 'MANAGER')) {
      return true;
    }

    if (!user || !user.id) {
      throw new ForbiddenException({
        code: 'ERR_CONSENT_REQUIRED',
        message: 'Employee authentication required.',
      });
    }

    // Fetch Organization's active MonitoringPolicy version
    const activePolicy = await this.prisma.monitoringPolicy.findFirst({
      where: {
        organizationId: user.organizationId,
        isDefault: true,
      },
      select: { policyVersion: true },
    });

    const targetVersion = activePolicy?.policyVersion || '1.0.0';

    // Check if user has consented to the current policy version
    const consent = await this.prisma.consentRecord.findFirst({
      where: {
        userId: user.id,
        policyVersion: targetVersion,
      },
    });

    if (!consent) {
      throw new ForbiddenException({
        code: 'ERR_CONSENT_REQUIRED',
        message: `Employee must consent to monitoring policy version ${targetVersion} before initiating captures or live streams.`,
        policyVersion: targetVersion,
      });
    }

    return true;
  }
}
