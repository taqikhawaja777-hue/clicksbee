import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorGateway } from './monitor.gateway';
import { GeminiVisionService, VisionAnalysisResult } from './gemini-vision.service';

export interface AnalyzeScreenshotDto {
  employeeId: string;
  imageBase64: string;
  timestamp?: string;
  // Defaults true (the original, always-persisted behavior) so any other
  // caller keeps working unchanged. The Live Monitor page's dedicated
  // 10-second capture loop passes false - persisting a full screenshot
  // every 10s (vs. the existing 5-minute archival loop) would bloat the
  // Screenshot gallery table ~30x for a page that only needs the latest
  // live result, not a permanent history.
  persist?: boolean;
}

export interface ActivityAnalysisResult {
  summary: string;
  taskRelevance: 'Yes' | 'No';
  activityType: 'Work Activity' | 'Idle' | 'Off Task';
  confidenceScore: number;
  status: 'ON TRACK' | 'IDLE' | 'OFF TASK';
  activeWindow: string;
  timestamp: string;
  imageUrl?: string;
  productivityScore?: number;
  detectedApps?: string[];
  concerns?: string[];
}

export interface ActivityLogDto {
  employeeId: string;
  windowTitle: string;
  appName: string;
  duration: number;
  timestamp: string;
}

export interface HeartbeatDto {
  employeeId: string;
  status: 'ACTIVE' | 'IDLE' | 'OFFLINE';
  activeWindow?: string;
}

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  // In-memory store for employee live status (production: use Redis)
  private employeeStatus: Map<string, { status: string; lastHeartbeat: Date; activeWindow?: string }> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly monitorGateway: MonitorGateway,
    private readonly visionService: GeminiVisionService,
  ) {}

  /**
   * Analyze screenshot using GeminiVisionService and broadcast update
   */
  async analyzeScreenshot(dto: AnalyzeScreenshotDto): Promise<{ success: boolean; data?: ActivityAnalysisResult }> {
    const { employeeId, imageBase64, timestamp, persist = true } = dto;
    const captureTime = timestamp || new Date().toISOString();

    // Look up the real employee (with department + resignation status)
    // BEFORE spending a Gemini API call - a resigned employee shouldn't be
    // actively evaluated at all, and the department is passed into the
    // vision prompt so task-relevance is judged against what's actually
    // normal for that person's job (e.g. Figma is relevant for Design,
    // not for Engineering).
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { id: employeeId },
          { email: { contains: employeeId, mode: 'insensitive' } },
          { firstName: { contains: employeeId, mode: 'insensitive' } },
        ],
      },
      include: { department: true },
    });

    if (!user) {
      this.logger.warn(`[MonitorService] analyzeScreenshot: no matching user for employeeId=${employeeId}`);
      return { success: false };
    }

    if (!user.isActive) {
      this.logger.log(`[MonitorService] Skipping vision analysis for resigned employee ${user.id} - no Gemini call made.`);
      const notMonitoredResult: ActivityAnalysisResult = {
        summary: 'This employee has resigned and is no longer being monitored.',
        taskRelevance: 'No',
        activityType: 'Idle',
        confidenceScore: 0,
        status: 'IDLE',
        activeWindow: 'N/A',
        timestamp: captureTime,
        detectedApps: [],
        concerns: [],
      };
      this.monitorGateway.broadcastEmployeeUpdate(employeeId, {
        ...notMonitoredResult,
        employeeIsActive: false,
        department: user.department?.name || null,
      } as any);
      return { success: true, data: notMonitoredResult };
    }

    this.logger.log(`[MonitorService] Analyzing screenshot for employeeId: ${employeeId} (department=${user.department?.name || 'none'})`);

    // Delegate AI analysis to GeminiVisionService
    const visionResult: VisionAnalysisResult = await this.visionService.analyzeScreenshot(
      imageBase64,
      user.department?.name,
    );

    const analysisResult: ActivityAnalysisResult = {
      ...visionResult,
      timestamp: captureTime,
      imageUrl: imageBase64,
    };

    // Broadcast via WebSocket Gateway - includes department/resignation
    // context alongside the vision result so the Live Monitor page can
    // show "is this relevant to their actual job" without a second
    // round-trip.
    this.monitorGateway.broadcastEmployeeUpdate(employeeId, {
      ...analysisResult,
      employeeIsActive: user.isActive,
      department: user.department?.name || null,
    } as any);

    // Update in-memory status
    this.employeeStatus.set(employeeId, {
      status: visionResult.status,
      lastHeartbeat: new Date(),
      activeWindow: visionResult.activeWindow,
    });

    if (persist) {
      try {
        await (this.prisma.screenshot as any).create({
          data: {
            userId: user.id,
            fileUrl: imageBase64,
            capturedAt: new Date(captureTime),
            isTaskRelevant: analysisResult.taskRelevance === 'Yes',
            aiSummary: analysisResult.summary,
            status: analysisResult.status,
            activeWindowName: analysisResult.activeWindow,
            progressPercentage: analysisResult.confidenceScore,
          },
        });
      } catch (dbErr) {
        this.logger.warn(`[MonitorService] DB Save fallback: ${dbErr.message}`);
      }
    }

    return { success: true, data: analysisResult };
  }

  /**
   * Log activity from Electron desktop client
   */
  async logActivity(dto: ActivityLogDto): Promise<{ success: boolean }> {
    const { employeeId, windowTitle, appName, duration, timestamp } = dto;
    this.logger.log(`[MonitorService] Activity log: ${employeeId} — ${appName} (${windowTitle})`);

    try {
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { id: employeeId },
            { email: { contains: employeeId, mode: 'insensitive' } },
          ],
        },
      });

      if (user) {
        await (this.prisma.activityEvent as any).create({
          data: {
            userId: user.id,
            type: 'APPLICATION_STARTED',
            description: `${appName}: ${windowTitle}`,
            metadata: { windowTitle, appName, duration },
            occurredAt: new Date(timestamp || Date.now()),
          },
        });
      }
    } catch (err) {
      this.logger.warn(`[MonitorService] Activity log DB error: ${err.message}`);
    }

    // Update live status
    this.employeeStatus.set(employeeId, {
      status: 'ACTIVE',
      lastHeartbeat: new Date(),
      activeWindow: windowTitle,
    });

    // Broadcast activity update
    this.monitorGateway.broadcastActivityUpdate(employeeId, {
      windowTitle,
      appName,
      duration,
      timestamp: timestamp || new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Process heartbeat from Electron client
   */
  async processHeartbeat(dto: HeartbeatDto): Promise<{ success: boolean }> {
    const { employeeId, status, activeWindow } = dto;

    this.employeeStatus.set(employeeId, {
      status,
      lastHeartbeat: new Date(),
      activeWindow,
    });

    // Broadcast status change
    this.monitorGateway.broadcastStatusUpdate(employeeId, status);

    return { success: true };
  }

  /**
   * Get live status for all employees
   */
  async getLiveAll(): Promise<any[]> {
    const employees = await this.prisma.user.findMany({
      where: { role: 'EMPLOYEE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
    });

    return employees.map((emp) => {
      const liveStatus = this.employeeStatus.get(emp.id);
      const isOnline = liveStatus
        ? (Date.now() - liveStatus.lastHeartbeat.getTime()) < 120000 // 2-min threshold
        : false;

      return {
        ...emp,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        liveStatus: isOnline ? (liveStatus?.status || 'ACTIVE') : 'OFFLINE',
        activeWindow: liveStatus?.activeWindow || null,
        lastHeartbeat: liveStatus?.lastHeartbeat?.toISOString() || null,
        isOnline,
      };
    });
  }

  /**
   * Get live status for a specific employee
   */
  async getLiveEmployee(employeeId: string): Promise<any> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { id: employeeId },
          { email: { contains: employeeId, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return { error: 'Employee not found' };
    }

    const liveStatus = this.employeeStatus.get(user.id);
    const isOnline = liveStatus
      ? (Date.now() - liveStatus.lastHeartbeat.getTime()) < 120000
      : false;

    // Fetch latest screenshot analysis
    let latestScreenshot = null;
    try {
      latestScreenshot = await (this.prisma.screenshot as any).findFirst({
        where: { userId: user.id },
        orderBy: { capturedAt: 'desc' },
      });
    } catch (e) {
      this.logger.warn(`[MonitorService] Screenshot fetch fallback: ${e.message}`);
    }

    return {
      ...user,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      liveStatus: isOnline ? (liveStatus?.status || 'ACTIVE') : 'OFFLINE',
      activeWindow: liveStatus?.activeWindow || null,
      lastHeartbeat: liveStatus?.lastHeartbeat?.toISOString() || null,
      isOnline,
      latestScreenshot: latestScreenshot
        ? {
            aiSummary: latestScreenshot.aiSummary,
            status: latestScreenshot.status,
            activeWindow: latestScreenshot.activeWindowName,
            capturedAt: latestScreenshot.capturedAt,
            imageUrl: latestScreenshot.fileUrl,
          }
        : null,
    };
  }
}
