import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TaskEstimationResult {
  estimatedTimeMinutes: number;
  keyMilestones: string[];
}

@Injectable()
export class AiTaskEstimatorService {
  private readonly logger = new Logger(AiTaskEstimatorService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Estimates completion time and milestones for a given task using Groq LLM API
   */
  async estimateTask(
    title: string,
    description?: string,
    complexity?: string,
  ): Promise<TaskEstimationResult> {
    const apiKey = this.configService.get<string>('LLM_API_KEY') || process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error('LLM_API_KEY must be configured');
    }
    const model = this.configService.get<string>('LLM_MODEL') || process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
    const baseUrl = this.configService.get<string>('LLM_BASE_URL') || process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';

    const systemPrompt = `You are an expert technical project manager. Analyze the provided task description and estimate the average completion time in minutes. Output JSON only: { "estimatedTimeMinutes": number, "keyMilestones": string[] }`;

    const userPrompt = `Task Title: ${title}
Task Description: ${description || 'No description provided.'}
Priority/Complexity: ${complexity || 'MEDIUM'}`;

    try {
      this.logger.log(`Requesting task estimation from LLM API for: "${title}"`);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`LLM API returned status ${response.status}: ${errorText}`);
        return this.getFallbackEstimation(title, description);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        return this.getFallbackEstimation(title, description);
      }

      const jsonStr = content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1);
      const parsed = JSON.parse(jsonStr);

      const estimatedTimeMinutes = typeof parsed.estimatedTimeMinutes === 'number' && parsed.estimatedTimeMinutes > 0
        ? Math.round(parsed.estimatedTimeMinutes)
        : this.getFallbackMinutes(title, description);

      const keyMilestones = Array.isArray(parsed.keyMilestones) ? parsed.keyMilestones : ['Initial setup', 'Implementation', 'Testing & Review'];

      return {
        estimatedTimeMinutes,
        keyMilestones,
      };
    } catch (error) {
      this.logger.error('Failed to estimate task completion time via LLM', error);
      return this.getFallbackEstimation(title, description);
    }
  }

  private getFallbackEstimation(title: string, description?: string): TaskEstimationResult {
    const estimatedTimeMinutes = this.getFallbackMinutes(title, description);
    return {
      estimatedTimeMinutes,
      keyMilestones: ['Initial implementation', 'Quality assurance & testing', 'Final sign-off'],
    };
  }

  private getFallbackMinutes(title: string, description?: string): number {
    const textLength = title.length + (description?.length || 0);
    if (textLength > 300) return 180;
    if (textLength > 100) return 120;
    return 60;
  }
}
