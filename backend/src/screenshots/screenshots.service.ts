import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StreamableFile } from '@nestjs/common';
import { AiVisionEvaluatorService } from '../services/aiVisionEvaluator';
import * as fs from 'fs';

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
  }) {
    const defaultOrg = await this.prisma.organization.findFirst();
    const orgId = defaultOrg ? defaultOrg.id : '66ba11111111111111111111';

    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.userName.toLowerCase().replace(/\s+/g, '') + '@stitchmonitor.com' },
          { firstName: { contains: dto.userName.split(' ')[0], mode: 'insensitive' } }
        ]
      }
    });

    if (!user) {
      user = await this.prisma.user.findFirst();
    }

    const userId = user ? user.id : '66ba22222222222222222222';
    const fileName = `${dto.userName.replace(/\s+/g, '_')}_${Date.now()}.png`;

    let fileUrl = dto.imageUrl;
    let filePath = 'storage/screenshots/' + fileName;
    let fileSize = Math.round(dto.imageUrl.length * 0.75);

    // If Base64 Data URL, convert to binary PNG file on physical disk & create accessible HTTP URL
    if (dto.imageUrl && dto.imageUrl.startsWith('data:image/')) {
      try {
        const base64Data = dto.imageUrl.replace(/^data:image\/\w+;base64,/, '');
        const fileBuffer = Buffer.from(base64Data, 'base64');
        fileSize = fileBuffer.length;

        const uploadRes = await this.storage.upload(
          fileBuffer,
          orgId,
          userId,
          fileName,
          'image/png',
        );

        filePath = uploadRes.filePath;
        fileUrl = uploadRes.fileUrl;
      } catch (err) {
        console.warn('Failed to write base64 to physical file, storing fallback data URL:', err);
      }
    }

    const record = await this.prisma.screenshot.create({
      data: {
        organizationId: orgId,
        userId: userId,
        fileName: fileName,
        filePath: filePath,
        fileUrl: fileUrl,
        activeWindowName: dto.activeWindowName || null,
        fileSize: fileSize,
        mimeType: 'image/png',
        isBlurred: false,
        eventId: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      },
    });

    // Trigger AI Vision Evaluation in background
    this.aiVisionEvaluator.evaluateScreenshot(record.id).catch(err => {
      console.warn(`Background AI vision evaluation error for ${record.id}:`, err);
    });

    return {
      id: record.id,
      userId: record.userId,
      userName: dto.userName,
      userRole: dto.userRole || 'Software Engineer',
      timestamp: dto.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isoTimestamp: record.capturedAt.toISOString(),
      date: dto.date || record.capturedAt.toISOString().split('T')[0],
      imageUrl: record.fileUrl,
      isIdle: !!dto.isIdle,
      activeWindowName: dto.activeWindowName || 'Active Shift Session (File Explorer / Desktop)',
      screenshotNumber: 1,
      totalTodayCount: 1,
    };
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
      date: item.capturedAt.toISOString().split('T')[0],
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
    return new StreamableFile(stream);
  }
}
