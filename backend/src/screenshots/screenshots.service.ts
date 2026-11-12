import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { getShiftDayString } from '../common/utils/shift-day.util';
import { StreamableFile } from '@nestjs/common';
import { AiVisionEvaluatorService } from '../services/aiVisionEvaluator';
import * as fs from 'fs';
import * as path from 'path';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

@Injectable()
export class ScreenshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly aiVisionEvaluator: AiVisionEvaluatorService,
  ) {}

  /**
   * Save Real Desktop Captured Image File to Disk & Record Metadata in MongoDB Collection
   */
  async saveCaptureRecord(dto: {
    userName: string;
    userId?: string;
    userRole?: string;
    imageUrl: string;
    activeWindowName?: string;
    timestamp?: string;
    date?: string;
    isIdle?: boolean;
    eventId?: string;
  }) {
    if (!dto.userId) {
      throw new BadRequestException('userId is required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, organizationId: true, firstName: true, lastName: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('Employee not found');
    }
    if (dto.eventId) {
      const existing = await this.prisma.screenshot.findUnique({ where: { eventId: dto.eventId } });
      if (existing) return this.toFeedRecord(existing, user, dto);
    }

    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(dto.imageUrl || '');
    if (!match) {
      throw new BadRequestException('imageUrl must be a base64 image data URL');
    }
    const mimeType = match[1];
    const fileBuffer = Buffer.from(match[2], 'base64');
    const capturedAt = dto.timestamp && !Number.isNaN(Date.parse(dto.timestamp)) ? new Date(dto.timestamp) : new Date();
    const employeeName = `${user.firstName} ${user.lastName}`.trim();

    const uploadRes = await this.storage.uploadScreenshot(fileBuffer, employeeName, capturedAt, mimeType);

    const record = await this.prisma.screenshot.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        fileName: uploadRes.filePath.split('/').pop() || 'screenshot',
        filePath: uploadRes.filePath,
        fileUrl: uploadRes.fileUrl,
        activeWindowName: dto.activeWindowName || null,
        fileSize: uploadRes.fileSize,
        mimeType,
        capturedAt,
        isBlurred: false,
        eventId: dto.eventId || 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      },
    });

    // The 1-minute archive deliberately does NOT run the Gemini vision
    // evaluation - Live Monitor has its own on-demand path for that.
    return this.toFeedRecord(record, user, dto);
  }

  private toFeedRecord(
    record: { id: string; userId: string; fileUrl: string; capturedAt: Date; activeWindowName: string | null },
    user: { firstName: string; lastName: string; role: string },
    dto: { userRole?: string; isIdle?: boolean },
  ) {
    return {
      id: record.id,
      userId: record.userId,
      userName: `${user.firstName} ${user.lastName}`.trim(),
      userRole: dto.userRole || user.role,
      timestamp: record.capturedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }),
      isoTimestamp: record.capturedAt.toISOString(),
      date: getShiftDayString(record.capturedAt),
      imageUrl: record.fileUrl,
      isIdle: !!dto.isIdle,
      activeWindowName: record.activeWindowName || 'Desktop',
      screenshotNumber: 1,
      totalTodayCount: 1,
    };
  }

  async getServerConfig(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { screenshotServerIp: true, screenshotServerPort: true },
    });
    return { ip: org?.screenshotServerIp || null, port: org?.screenshotServerPort || 5000 };
  }

  async setServerConfig(organizationId: string, ip: string | null, port?: number) {
    const cleanIp = ip?.trim() || null;
    if (cleanIp && !/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanIp) && !/^[a-zA-Z0-9.-]{1,253}$/.test(cleanIp)) {
      throw new BadRequestException('ip must be an IPv4 address or host name');
    }
    const cleanPort = port === undefined ? 5000 : Number(port);
    if (!Number.isInteger(cleanPort) || cleanPort < 1024 || cleanPort > 65535) {
      throw new BadRequestException('port must be between 1024 and 65535');
    }
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { screenshotServerIp: cleanIp, screenshotServerPort: cleanPort },
      select: { screenshotServerIp: true, screenshotServerPort: true },
    });
    return { ip: org.screenshotServerIp, port: org.screenshotServerPort || 5000 };
  }

  /**
   * Fetch Screenshots Feed from MongoDB Collection
   */
  async getFeedRecords() {
    const list = await this.prisma.screenshot.findMany({
      take: 50,
      orderBy: { capturedAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, role: true } },
      },
    });

    return list.map(item => ({
      id: item.id,
      userId: item.userId,
      userName: item.user ? `${item.user.firstName} ${item.user.lastName}`.trim() : 'umer Sohail',
      userRole: item.user?.role === 'ADMIN' || item.user?.role === 'MANAGER' ? 'Manager' : 'Full Stack Engineer',
      timestamp: item.capturedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isoTimestamp: item.capturedAt.toISOString(),
      date: getShiftDayString(item.capturedAt),
      imageUrl: item.fileUrl,
      isIdle: false,
      activeWindowName: item.activeWindowName || 'Active Workstation Screen (File Explorer / My Computer)',
      screenshotNumber: 1,
      totalTodayCount: 1,
    }));
  }

  async uploadScreenshot(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    userId: string,
    organizationId: string,
    deviceId?: string,
    eventId?: string,
  ) {
    if (eventId) {
      const existing = await this.prisma.screenshot.findUnique({
        where: { eventId },
      });
      if (existing) return existing;
    }

    const uploadRes = await this.storage.upload(
      fileBuffer,
      organizationId,
      userId,
      originalName,
      mimeType,
    );

    const record = await this.prisma.screenshot.create({
      data: {
        organizationId,
        userId,
        deviceId,
        fileName: originalName,
        filePath: uploadRes.filePath,
        fileUrl: uploadRes.fileUrl,
        fileSize: uploadRes.fileSize,
        mimeType,
        eventId,
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId,
        userId,
        deviceId,
        type: 'SCREENSHOT_CAPTURED',
        metadata: { screenshotId: record.id, fileUrl: record.fileUrl },
      },
    });

    // Trigger AI Vision Evaluation in background
    this.aiVisionEvaluator.evaluateScreenshot(record.id).catch(err => {
      console.warn(`Background AI vision evaluation error for ${record.id}:`, err);
    });

    return record;
  }

  async getScreenshots(
    organizationId: string,
    reqUserId: string,
    role: string,
    userIdFilter?: string,
    page = 1,
    limit = 20,
    startDate?: string,
    endDate?: string,
  ) {
    const where: any = { organizationId };

    if (role === 'EMPLOYEE') {
      where.userId = reqUserId;
    } else if (userIdFilter) {
      where.userId = userIdFilter;
    }

    // Date range for the Screenshot Report - inclusive of the whole
    // endDate day, matching how every other report/date-range query in
    // this app treats its end boundary.
    if (startDate || endDate) {
      where.capturedAt = {};
      if (startDate) where.capturedAt.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) where.capturedAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.screenshot.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        orderBy: { capturedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.screenshot.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getScreenshotById(
    id: string,
    organizationId: string,
    reqUserId: string,
    role: string,
  ) {
    const screenshot = await this.prisma.screenshot.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });

    if (!screenshot || screenshot.organizationId !== organizationId) {
      throw new NotFoundException('Screenshot record not found');
    }

    if (role === 'EMPLOYEE' && screenshot.userId !== reqUserId) {
      throw new ForbiddenException('Access denied to other employee screenshot');
    }

    return screenshot;
  }

  async deleteScreenshot(
    id: string,
    organizationId: string,
    reqUserId: string,
    role: string,
  ) {
    const screenshot = await this.getScreenshotById(id, organizationId, reqUserId, role);

    if (role === 'EMPLOYEE') {
      throw new ForbiddenException('Employees cannot delete monitoring screenshots');
    }

    await this.storage.delete(screenshot.filePath);
    await this.prisma.screenshot.delete({ where: { id: screenshot.id } });

    return { message: 'Screenshot deleted successfully' };
  }

  async getScreenshotStream(relativePath: string) {
    const absolutePath = this.storage.getAbsPath(relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException('Screenshot file not found on disk');
    }
    const stream = fs.createReadStream(absolutePath);
    // Without a real Content-Type the browser can't render a PDF inline and
    // falls back to a bare download. Strip StorageService's timestamp prefix
    // from the suggested filename.
    const fileName = path.basename(absolutePath).replace(/^\d+_/, '').replace(/"/g, '');
    return new StreamableFile(stream, {
      type: MIME_BY_EXT[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream',
      disposition: `inline; filename="${fileName}"`,
    });
  }
}
