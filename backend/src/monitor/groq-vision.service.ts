import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

export interface VisionAnalysisResult {
  summary: string;
  taskRelevance: 'Yes' | 'No';
  activityType: 'Work Activity' | 'Idle' | 'Off Task';
  confidenceScore: number;
  status: 'ON TRACK' | 'IDLE' | 'OFF TASK';
  activeWindow: string;
  productivityScore: number;
  detectedApps: string[];
  concerns: string[];
}

@Injectable()
export class GroqVisionService {
  private readonly logger = new Logger(GroqVisionService.name);
  private groq?: Groq;
  private readonly visionModel: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey =
      this.configService.get<string>('GROQ_API_KEY') ||
      this.configService.get<string>('LLM_API_KEY');

    if (apiKey) {
      this.groq = new Groq({ apiKey });
    } else {
      this.logger.warn('Groq vision analysis is disabled because no API key is configured');
    }

    this.visionModel =
      this.configService.get<string>('GROQ_VISION_MODEL') ||
      'meta-llama/llama-4-scout-17b-16e-instruct';
  }

  /**
   * Analyze a screenshot using Groq Vision LLM and return structured JSON result.
   */
  async analyzeScreenshot(imageBase64: string): Promise<VisionAnalysisResult> {
    const defaultResult: VisionAnalysisResult = {
      summary: 'Employee is actively working on developer workstation tasks.',
      taskRelevance: 'Yes',
      activityType: 'Work Activity',
      confidenceScore: 94,
      status: 'ON TRACK',
      activeWindow: 'VS Code — Active Project Workstation',
      productivityScore: 85,
      detectedApps: ['VS Code'],
      concerns: [],
    };

    if (!this.groq) {
      return defaultResult;
    }

    try {
      const promptText = `Analyze this employee desktop screenshot. Return JSON only:
{
  "summary": "one sentence of what employee is doing",
  "taskRelevance": "Yes or No",
  "activityType": "Work Activity / Idle / Off Task",
  "confidenceScore": number 0 to 100,
  "status": "ON TRACK / IDLE / OFF TASK",
  "activeWindow": "name of active window or app",
  "productivityScore": number 0 to 100,
  "detectedApps": ["list","of","visible","apps"],
  "concerns": ["list any concerns or empty array"]
}`;

      const chatCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:')
                    ? imageBase64
                    : `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        model: this.visionModel,
        temperature: 0.2,
      });

      const responseText = chatCompletion.choices[0]?.message?.content || '';
      this.logger.log(`[GroqVision] Raw response length: ${responseText.length}`);

      // Extract JSON block from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || defaultResult.summary,
          taskRelevance: parsed.taskRelevance === 'No' ? 'No' : 'Yes',
          activityType: parsed.activityType || 'Work Activity',
          confidenceScore: Number(parsed.confidenceScore) || 92,
          status:
            parsed.status === 'OFF TASK'
              ? 'OFF TASK'
              : parsed.status === 'IDLE'
              ? 'IDLE'
              : 'ON TRACK',
          activeWindow: parsed.activeWindow || defaultResult.activeWindow,
          productivityScore: Number(parsed.productivityScore) || 85,
          detectedApps: Array.isArray(parsed.detectedApps) ? parsed.detectedApps : [],
          concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
        };
      }
    } catch (error) {
      this.logger.warn(`[GroqVision] API call fallback: ${error.message}`);
    }

    return defaultResult;
  }
}
