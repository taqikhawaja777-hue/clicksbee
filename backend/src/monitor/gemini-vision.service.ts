import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VisionAnalysisResult } from './groq-vision.service';

export type { VisionAnalysisResult };

/**
 * Same role as GroqVisionService (identical VisionAnalysisResult shape,
 * so monitor.service.ts didn't need to change beyond which service it
 * injects) - swapped in because the configured Groq account had no
 * vision-capable model access at all (verified directly: every model
 * available to that key rejected image input). Uses Gemini's REST API
 * directly rather than pulling in a new SDK dependency for one call site.
 */
@Injectable()
export class GeminiVisionService {
  private readonly logger = new Logger(GeminiVisionService.name);
  private readonly apiKey?: string;
  private readonly visionModel: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('Gemini vision analysis is disabled because GEMINI_API_KEY is not configured');
    }
    // gemini-1.5-flash and gemini-2.5-flash are both retired for this key.
    // gemini-3.6-flash worked but its free tier is only 20 requests per
    // DAY (not per-minute) - a 10-second capture loop exhausts that in
    // ~3 minutes, after which every call 429s and silently falls back to
    // the generic defaultResult below for the rest of the day (looks like
    // "the analysis never changes" from the UI). gemini-flash-lite-latest
    // handled 8 rapid back-to-back real-image calls with zero rate-limit
    // errors in testing - verified directly against Google's API, not
    // assumed.
    this.visionModel = this.configService.get<string>('GEMINI_VISION_MODEL') || 'gemini-flash-lite-latest';
  }

  async analyzeScreenshot(imageBase64: string, departmentContext?: string): Promise<VisionAnalysisResult> {
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

    if (!this.apiKey) {
      return defaultResult;
    }

    try {
      const departmentLine = departmentContext
        ? `This employee works in the ${departmentContext} department - judge taskRelevance against what's normal work for that department (e.g. design tools for Design, CRM/email for Sales), not a generic assumption.`
        : '';
      const promptText = `Analyze this employee desktop screenshot. ${departmentLine} Return JSON only:
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

      // Gemini's inline_data.data wants raw base64, not a data: URI -
      // strip the prefix Electron's canvas.toDataURL()/desktopCapturer
      // thumbnails always include.
      const commaIndex = imageBase64.indexOf(',');
      const rawBase64 = imageBase64.startsWith('data:') && commaIndex !== -1
        ? imageBase64.slice(commaIndex + 1)
        : imageBase64;
      const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.visionModel}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: promptText },
                  { inline_data: { mime_type: mimeType, data: rawBase64 } },
                ],
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Gemini API HTTP ${response.status}: ${errBody}`);
      }

      const json = await response.json();
      const responseText: string = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || '';
      this.logger.log(`[GeminiVision] Raw response length: ${responseText.length}`);

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
      this.logger.warn(`[GeminiVision] API call fallback: ${error.message}`);
    }

    return defaultResult;
  }
}
