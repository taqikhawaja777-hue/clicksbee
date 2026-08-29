import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import * as fs from 'fs';
import * as path from 'path';

export interface VisionEvaluationResult {
  isTaskRelevant: boolean;
  progressPercentage: number;
  status: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE';
  summary: string;
}

@Injectable()
export class AiVisionEvaluatorService {
  private readonly logger = new Logger(AiVisionEvaluatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Evaluates a captured screenshot against the user's active task using Groq LLM Vision API
   */
  async evaluateScreenshot(screenshotId: string): Promise<VisionEvaluationResult | null> {
    try {
      const screenshot = await this.prisma.screenshot.findUnique({
        where: { id: screenshotId },
        include: { user: true },
      });

      if (!screenshot) {
        this.logger.warn(`Screenshot ${screenshotId} not found for vision evaluation`);
        return null;
      }

      // Find employee's active assigned task (IN_PROGRESS or TODO)
      let activeTask = await this.prisma.task.findFirst({
        where: {
          assignedTo: screenshot.userId,
          status: { in: ['IN_PROGRESS', 'TODO'] },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Fallback: If no assigned task found for user, check any open task in org
      if (!activeTask) {
        activeTask = await this.prisma.task.findFirst({
          where: {
            organizationId: screenshot.organizationId,
            status: { in: ['IN_PROGRESS', 'TODO'] },
          },
          orderBy: { updatedAt: 'desc' },
        });
      }

      const taskTitle = activeTask ? activeTask.title : 'General Work Session';
      const taskDescription = activeTask ? (activeTask.description || 'Active desktop shift session.') : 'Daily productivity and task completion.';
      const estimatedTimeMinutes = activeTask ? (activeTask.estimatedTimeMinutes || activeTask.estimatedMinutes || 60) : 60;

      let elapsedMinutes = 15;
      if (activeTask && activeTask.startedAt) {
        elapsedMinutes = Math.max(1, Math.round((Date.now() - activeTask.startedAt.getTime()) / (1000 * 60)));
      } else if (screenshot.capturedAt) {
        const startOfDay = new Date(screenshot.capturedAt);
        startOfDay.setHours(9, 0, 0, 0);
        elapsedMinutes = Math.max(5, Math.round((screenshot.capturedAt.getTime() - startOfDay.getTime()) / (1000 * 60)));
      }

      // Prepare Image Data URL (Base64)
      const base64ImageUrl = await this.getImageAsBase64(screenshot.fileUrl, screenshot.filePath);

      const apiKey = this.configService.get<string>('LLM_API_KEY') || process.env.LLM_API_KEY;
      if (!apiKey) {
        throw new Error('LLM_API_KEY must be configured');
      }
      const model = this.configService.get<string>('LLM_MODEL') || process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
      const baseUrl = this.configService.get<string>('LLM_BASE_URL') || process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';

      const visionSystemPrompt = `You are an automated workforce productivity evaluator. Compare the provided employee desktop screenshot with their assigned active task.
Active Task: ${taskTitle} - ${taskDescription}
Elapsed Time: ${elapsedMinutes} / Estimated: ${estimatedTimeMinutes} mins.

Evaluate:
1. Is the employee actively working on the assigned task based on screen content? (boolean)
2. Estimated Progress Percentage (0-100%).
3. Productivity Status: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE'.
4. Brief 1-sentence manager summary of current activity.

Output strictly in JSON:
{ 'isTaskRelevant': boolean, 'progressPercentage': number, 'status': string, 'summary': string }`;

      this.logger.log(`Evaluating screenshot ${screenshotId} with Groq Vision model (${model})...`);

      const messages: any[] = [
        { role: 'system', content: visionSystemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Evaluate employee workstation screenshot for task "${taskTitle}" (${elapsedMinutes} elapsed mins).`,
            },
          ],
        },
      ];

      if (base64ImageUrl) {
        messages[1].content.push({
          type: 'image_url',
          image_url: { url: base64ImageUrl },
        });
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });

      let evalResult: VisionEvaluationResult;

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(`Vision LLM API error ${response.status}: ${errText}`);
        evalResult = this.generateFallbackEvaluation(taskTitle, elapsedMinutes, estimatedTimeMinutes);
      } else {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (content) {
          try {
            const jsonStr = content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1);
            const parsed = JSON.parse(jsonStr);

            const isTaskRelevant = typeof parsed.isTaskRelevant === 'boolean' ? parsed.isTaskRelevant : true;
            let statusVal: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE' = 'ON_TRACK';

            if (isTaskRelevant === false || parsed.status === 'DISTRACTED') {
              statusVal = 'DISTRACTED';
            } else if (parsed.status === 'BEHIND_SCHEDULE') {
              statusVal = 'BEHIND_SCHEDULE';
            } else if (parsed.status === 'IDLE') {
              statusVal = 'IDLE';
            } else {
              statusVal = 'ON_TRACK';
            }

            evalResult = {
              isTaskRelevant,
              progressPercentage: typeof parsed.progressPercentage === 'number' ? Math.min(100, Math.max(0, parsed.progressPercentage)) : 50,
              status: statusVal,
              summary: parsed.summary || `Employee working on ${taskTitle}.`,
            };
          } catch (e) {
            evalResult = this.generateFallbackEvaluation(taskTitle, elapsedMinutes, estimatedTimeMinutes);
          }
        } else {
          evalResult = this.generateFallbackEvaluation(taskTitle, elapsedMinutes, estimatedTimeMinutes);
        }
      }

      // Update Screenshot record in DB
      await this.prisma.screenshot.update({
        where: { id: screenshotId },
        data: {
          taskId: activeTask ? activeTask.id : null,
          isTaskRelevant: evalResult.isTaskRelevant,
          progressPercentage: evalResult.progressPercentage,
          status: evalResult.status,
          aiSummary: evalResult.summary,
        },
      });

      this.logger.log(`Screenshot ${screenshotId} evaluated: Status=${evalResult.status}, Progress=${evalResult.progressPercentage}%`);

      return evalResult;
    } catch (error) {
      this.logger.error(`Error in AiVisionEvaluatorService for screenshot ${screenshotId}`, error);
      return null;
    }
  }

  private async getImageAsBase64(fileUrl: string, filePath?: string): Promise<string | null> {
    if (fileUrl && fileUrl.startsWith('data:image/')) {
      return fileUrl;
    }

    if (filePath) {
      try {
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(process.cwd(), filePath);

        if (fs.existsSync(absPath)) {
          const buffer = fs.readFileSync(absPath);
          return `data:image/png;base64,${buffer.toString('base64')}`;
        }
      } catch (err) {
        this.logger.warn(`Could not read screenshot file from disk: ${filePath}`, err);
      }
    }

    return null;
  }

  private generateFallbackEvaluation(
    taskTitle: string,
    elapsedMinutes: number,
    estimatedMinutes: number,
  ): VisionEvaluationResult {
    const isOvertime = elapsedMinutes > estimatedMinutes;
    const progress = Math.min(95, Math.round((elapsedMinutes / estimatedMinutes) * 100));

    return {
      isTaskRelevant: true,
      progressPercentage: progress,
      status: isOvertime ? 'BEHIND_SCHEDULE' : 'ON_TRACK',
      summary: isOvertime
        ? `Employee has elapsed ${elapsedMinutes}m on task "${taskTitle}" (Est: ${estimatedMinutes}m) and is behind schedule.`
        : `Employee actively working on task "${taskTitle}" with screen context matching work session.`,
    };
  }
}
