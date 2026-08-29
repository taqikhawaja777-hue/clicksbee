import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConsentService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get active policy consent status for a user
   */
  async getConsentStatus(userId: string, organizationId: string) {
    const policy = await this.prisma.monitoringPolicy.findFirst({
      where: { organizationId, isDefault: true },
    }) || await this.prisma.monitoringPolicy.findFirst({
      where: { organizationId },
    });

    const activeVersion = policy?.policyVersion || '1.0.0';

    const consentRecord = await this.prisma.consentRecord.findFirst({
      where: { userId, policyVersion: activeVersion },
    });

    return {
      consented: !!consentRecord,
      policyVersion: activeVersion,
      consentedAt: consentRecord?.consentedAt || null,
      policyDetails: {
        capturedItems: ['Full Desktop Screenshots', 'Active Window & App Titles', 'Idle & Active Work Duration', 'Short Video Clips (Optional)'],
        screenshotIntervalMin: policy?.minScreenshotInterval || 300,
        screenshotIntervalMax: policy?.maxScreenshotInterval || 900,
        retentionDays: policy?.retentionDays || 60,
        excludedApps: policy?.excludedApps || ['1Password', 'KeePass', 'Bitwarden', 'Bank'],
        workingHoursStart: policy?.workingHoursStart || '09:00',
        workingHoursEnd: policy?.workingHoursEnd || '17:00',
        viewers: ['Organization Managers', 'System Administrators'],
      },
    };
  }

  /**
   * Record employee policy consent
   */
  async recordConsent(userId: string, policyVersion: string, ipAddress?: string, userAgent?: string) {
    const existing = await this.prisma.consentRecord.findFirst({
      where: { userId, policyVersion },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.consentRecord.create({
      data: {
        userId,
        policyVersion,
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'WorkTrackPro Desktop Agent',
      },
    });
  }
}
