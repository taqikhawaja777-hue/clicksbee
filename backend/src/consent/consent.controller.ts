import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('api/v1/consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: any) {
    const userId = req.user?.id || 'emp-101';
    const orgId = req.user?.organizationId || 'org-101';
    return this.consentService.getConsentStatus(userId, orgId);
  }

  @Post('record')
  @UseGuards(JwtAuthGuard)
  async recordConsent(
    @Req() req: any,
    @Body() body: { policyVersion: string; ipAddress?: string; userAgent?: string }
  ) {
    const userId = req.user?.id || 'emp-101';
    return this.consentService.recordConsent(
      userId,
      body.policyVersion || '1.0.0',
      body.ipAddress || req.ip,
      body.userAgent || req.headers['user-agent']
    );
  }
}
