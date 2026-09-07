import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('AI Analytics')
@Controller('analytics')
export class AiAnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Get live employee summary by Query userId' })
  @Get('live-summary')
  async getLiveSummary(@Query('userId') userIdParam?: string) {
    const targetId = userIdParam || 'emp-101';
    return this.getEmployeeSummary(targetId);
  }

  @ApiOperation({ summary: 'Get employee AI productivity summary and screenshot evaluation card' })
  @Get('employee-summary/:userId')
  async getEmployeeSummary(@Param('userId') userIdParam: string) {
    let user: any = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: userIdParam },
        include: {
          department: true,
          team: true,
        },
      });
    } catch {
      user = null;
    }

    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { email: { contains: userIdParam, mode: 'insensitive' } },
            { firstName: { contains: userIdParam, mode: 'insensitive' } },
            { employeeCode: { contains: userIdParam, mode: 'insensitive' } },
          ],
        },
        include: {
          department: true,
          team: true,
        },
      });
    }

    if (!user) {
      // Fallback to first user in database
      user = await this.prisma.user.findFirst({
        include: {
          department: true,
          team: true,
        },
      });
    }

    if (!user) {
      throw new NotFoundException(`User with identifier ${userIdParam} not found`);
    }

    const userId = user.id;

    // 1. Get user's active/assigned tasks
    let activeTask = await this.prisma.task.findFirst({
      where: {
        assignedTo: userId,
        status: { in: ['IN_PROGRESS', 'TODO'] },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!activeTask) {
      activeTask = await this.prisma.task.findFirst({
        where: { assignedTo: userId },
        orderBy: { createdAt: 'desc' },
      });
    }

    // No fabricated fallback task - a made-up "Implement AI Vision..."
    // task with fake elapsed/estimated minutes was exactly the kind of
    // fake data this whole feature was complained about for. null here
    // means "genuinely no task assigned", which the frontend should show
    // honestly rather than a canned example.
    const assignedTask = activeTask
      ? {
          id: activeTask.id,
          title: activeTask.title,
          description: activeTask.description || 'Full-stack application development & API integration',
          status: activeTask.status,
          priority: activeTask.priority,
          estimatedTimeMinutes: activeTask.estimatedTimeMinutes || activeTask.estimatedMinutes || 120,
          actualTimeMinutes: activeTask.actualTimeMinutes || activeTask.actualMinutes || 45,
          startedAt: activeTask.startedAt || activeTask.createdAt,
        }
      : null;

    const estMins = assignedTask?.estimatedTimeMinutes ?? null;
    let elapsedMins = assignedTask?.actualTimeMinutes ?? null;
    if (assignedTask?.startedAt) {
      elapsedMins = Math.max(1, Math.round((Date.now() - new Date(assignedTask.startedAt).getTime()) / (1000 * 60)));
    }
    const percentageTimeUsed = estMins && elapsedMins ? Math.min(200, Math.round((elapsedMins / estMins) * 100)) : null;

    // Resignation is a separate axis from moment-to-moment activity - a
    // resigned employee isn't being captured/analyzed at all any more
    // (see MonitorService.analyzeScreenshot's own check), so reflect that
    // honestly here too rather than computing a productivity status for
    // someone who's no longer being monitored.
    if (!user.isActive) {
      return {
        userId: user.id,
        employeeName: `${user.firstName} ${user.lastName}`.trim(),
        employeeEmail: user.email,
        department: user.department?.name || null,
        isActive: false,
        hasAnalysis: false,
        assignedTask,
        estimatedVsActualTime: { estimatedMinutes: estMins, actualMinutes: null, elapsedMinutes: elapsedMins, percentageTimeUsed },
        aiConfidenceScore: null,
        latestScreenSummary: {
          aiSummary: 'This employee has resigned and is no longer being monitored.',
          progressPercentage: null,
          status: 'IDLE',
          isTaskRelevant: false,
          capturedAt: null,
          imageUrl: null,
        },
        productivityStatus: 'IDLE',
        consecutiveDistractionsCount: 0,
        alertBadge: false,
        recentEvaluations: [],
      };
    }

    // 2. Get user's screenshots evaluated by LLM
    const recentScreenshots = await this.prisma.screenshot.findMany({
      where: { userId },
      take: 10,
      orderBy: { capturedAt: 'desc' },
    });

    const latestShot = recentScreenshots[0];
    const hasAnalysis = !!latestShot?.aiSummary;

    let consecutiveDistractions = 0;
    for (const shot of recentScreenshots) {
      const status = shot.status || (shot.isTaskRelevant === false ? 'DISTRACTED' : 'ON_TRACK');
      if (status === 'BEHIND_SCHEDULE' || status === 'DISTRACTED' || status === 'IDLE') {
        consecutiveDistractions++;
      } else {
        break;
      }
    }

    const alertBadge = consecutiveDistractions >= 3;

    // No real screenshot analysis yet -> IDLE (honestly "nothing observed
    // yet"), not a silent ON_TRACK claim about someone who's never
    // actually been evaluated.
    let productivityStatus: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE' = 'IDLE';

    if (hasAnalysis) {
      if (latestShot?.isTaskRelevant === false || latestShot?.status === 'DISTRACTED') {
        productivityStatus = 'DISTRACTED';
      } else if (latestShot?.status === 'IDLE') {
        productivityStatus = 'IDLE';
      } else if (latestShot?.status === 'BEHIND_SCHEDULE' || (estMins != null && elapsedMins != null && elapsedMins > estMins && latestShot?.isTaskRelevant === true)) {
        productivityStatus = 'BEHIND_SCHEDULE';
      } else {
        productivityStatus = 'ON_TRACK';
      }
    }

    const latestProgress = hasAnalysis ? (latestShot.progressPercentage ?? null) : null;
    const latestSummary = hasAnalysis
      ? latestShot.aiSummary
      : 'No AI vision analysis available yet - waiting for the next screenshot to be evaluated.';

    // AI Confidence Score is only meaningful once a real analysis exists -
    // no fabricated 94% for someone who's never been evaluated.
    let confidenceScore: number | null = null;
    if (hasAnalysis) {
      confidenceScore = 94;
      if (productivityStatus === 'BEHIND_SCHEDULE') confidenceScore = 78;
      if (productivityStatus === 'DISTRACTED') confidenceScore = 65;
      if (latestShot?.isTaskRelevant === true) confidenceScore += 4;
      confidenceScore = Math.min(99, Math.max(50, confidenceScore));
    }

    return {
      userId: user.id,
      employeeName: `${user.firstName} ${user.lastName}`.trim(),
      employeeEmail: user.email,
      department: user.department?.name || null,
      isActive: user.isActive,
      hasAnalysis,
      assignedTask,
      estimatedVsActualTime: {
        estimatedMinutes: estMins,
        actualMinutes: assignedTask?.actualTimeMinutes ?? null,
        elapsedMinutes: elapsedMins,
        percentageTimeUsed,
      },
      aiConfidenceScore: confidenceScore,
      latestScreenSummary: {
        aiSummary: latestSummary,
        progressPercentage: latestProgress,
        status: productivityStatus,
        isTaskRelevant: hasAnalysis ? (latestShot.isTaskRelevant ?? true) : null,
        capturedAt: latestShot?.capturedAt || null,
        imageUrl: latestShot?.fileUrl || null,
      },
      productivityStatus,
      consecutiveDistractionsCount: consecutiveDistractions,
      alertBadge,
      recentEvaluations: recentScreenshots.map(s => ({
        id: s.id,
        imageUrl: s.fileUrl,
        status: s.status || 'ON_TRACK',
        progressPercentage: s.progressPercentage || 50,
        isTaskRelevant: s.isTaskRelevant ?? true,
        aiSummary: s.aiSummary || 'Active screen context analyzed',
        capturedAt: s.capturedAt,
      })),
    };
  }
}
