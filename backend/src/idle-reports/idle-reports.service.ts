import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorService } from '../monitor/monitor.service';
import { hasFlexibleHours } from '../common/access/access.util';
import { isScheduledBreakTime, isWithinShift } from '../common/utils/shift-day.util';

export const CAMERA_STATUSES = ['PRESENT', 'AWAY', 'OFF'] as const;
export type CameraStatus = (typeof CAMERA_STATUSES)[number];

const MAX_EPISODE_AGE_MS = 12 * 60 * 60 * 1000;
// The app sends one capture a minute; anything faster is a retry or a loop.
const MIN_CAPTURE_GAP_MS = 40_000;
// 1600x900 JPEG (readable on the report's full-page view) is ~150-300 KB.
const MAX_SCREENSHOT_BYTES = 600 * 1024;
const MAX_CAMERA_BYTES = 150 * 1024;
const RETENTION_DAYS = 30;
// PDF size guard: at most this many screenshot/camera pairs per idle period,
// and only for the newest episodes in the range (the rest are text only).
// Once a period has ended, only these captures keep their pictures (pruneImages).
const IMAGES_PER_EPISODE = 3;
const MAX_EPISODES_WITH_IMAGES = 100;

export interface CaptureInput {
  idleSince: string;
  capturedAt?: string;
  /** JPEG kept for the report; the AI summary is made from it too. */
  screenshot: string;
  camera?: string;
  cameraStatus: CameraStatus;
}

interface CaptureUser {
  id: string;
  organizationId: string;
  role: string;
  designation?: string | null;
  officeCategory?: string | null;
}

/** data:image/jpeg;base64,... -> bytes (null if it is not a JPEG/PNG data URL or too large). */
export function decodeImage(dataUrl: string | undefined, maxBytes: number): Buffer | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null;
}

const toDataUrl = (bytes: Uint8Array | null | undefined) =>
  bytes ? `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` : null;

/** Indexes of the captures that get pictures: first, middle and last. */
export function pickImageIndexes(count: number, max = IMAGES_PER_EPISODE): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const picks = new Set<number>([0, count - 1]);
  for (let i = 1; picks.size < max; i++) picks.add(Math.round((i * (count - 1)) / (max - 1)));
  return [...picks].sort((a, b) => a - b);
}

/** One line for the whole idle period: what the screen showed, plus where the person was. */
export function summariseEpisode(captures: { summary: string | null; cameraStatus: string }[]): string {
  const seen = new Set<string>();
  const screen = captures
    .map((c) => (c.summary || '').trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  const present = captures.filter((c) => c.cameraStatus === 'PRESENT').length;
  const away = captures.filter((c) => c.cameraStatus === 'AWAY').length;
  const camera =
    present + away === 0
      ? 'Camera presence was not active.'
      : away === 0
        ? 'Camera: at the desk the whole time.'
        : present === 0
          ? 'Camera: away from the desk the whole time.'
          : `Camera: at the desk in ${present} and away in ${away} of ${present + away} checks.`;
  const screenText = screen.length ? screen.join(' Then: ') : 'No AI summary available.';
  return `${screenText} ${camera}`;
}

/**
 * Idle Alert Report. Only idle time is captured (the desktop app sends
 * nothing while the employee is active). Each screenshot is analysed
 * through the Live Monitor pipeline, so the summary also shows live there.
 */
@Injectable()
export class IdleReportsService {
  private readonly logger = new Logger(IdleReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly monitorService: MonitorService,
  ) {}

  async recordCapture(user: CaptureUser, input: CaptureInput, now: Date = new Date()) {
    const since = new Date(input.idleSince);
    if (Number.isNaN(since.getTime()) || since.getTime() > now.getTime() + 120_000 || now.getTime() - since.getTime() > MAX_EPISODE_AGE_MS) {
      throw new BadRequestException('idleSince must be a recent timestamp');
    }
    const parsedAt = input.capturedAt ? new Date(input.capturedAt) : now;
    const capturedAt = Number.isNaN(parsedAt.getTime()) || parsedAt > now || parsedAt < since ? now : parsedAt;

    // Same rule as idle alerts: breaks and off-shift time are never idle.
    if (!hasFlexibleHours(user) && (!isWithinShift(capturedAt) || isScheduledBreakTime(capturedAt))) {
      return { recorded: false, reason: 'Outside working time or during a scheduled break' };
    }

    const screenshot = decodeImage(input.screenshot, MAX_SCREENSHOT_BYTES);
    if (!screenshot) throw new BadRequestException('screenshot must be a JPEG or PNG data URL under 600 KB');
    const camera = input.cameraStatus === 'OFF' ? null : decodeImage(input.camera, MAX_CAMERA_BYTES);

    const episode = await this.prisma.idleEpisode.upsert({
      where: { userId_idleSince: { userId: user.id, idleSince: since } },
      create: { organizationId: user.organizationId, userId: user.id, idleSince: since },
      update: {},
    });

    const last = await this.prisma.idleCapture.findFirst({
      where: { episodeId: episode.id },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    });
    if (last && capturedAt.getTime() - last.capturedAt.getTime() < MIN_CAPTURE_GAP_MS) {
      return { recorded: false, reason: 'Duplicate' };
    }

    const capture = await this.prisma.idleCapture.create({
      data: { episodeId: episode.id, capturedAt, screenshot, camera, cameraStatus: camera ? input.cameraStatus : 'OFF' },
      select: { id: true },
    });

    // The AI call takes a few seconds - don't hold the desktop app's request open for it.
    void this.summarise(capture.id, user.id, input.screenshot, capturedAt);
    return { recorded: true, captureId: capture.id };
  }

  private async summarise(captureId: string, userId: string, image: string, capturedAt: Date): Promise<void> {
    try {
      const result = await this.monitorService.analyzeScreenshot({
        employeeId: userId,
        imageBase64: image,
        timestamp: capturedAt.toISOString(),
        persist: false,
      });
      if (result.success && result.data?.summary) {
        await this.prisma.idleCapture.update({ where: { id: captureId }, data: { summary: result.data.summary } });
      }
    } catch (err) {
      this.logger.warn(`Idle capture ${captureId}: AI summary failed - ${(err as Error).message}`);
    }
  }

  /** from/to are Asia/Karachi calendar dates (YYYY-MM-DD), inclusive. */
  async getReport(organizationId: string, from: string, to: string) {
    const start = new Date(`${from}T00:00:00.000+05:00`);
    const end = new Date(`${to}T23:59:59.999+05:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw new BadRequestException('from/to must be dates (YYYY-MM-DD), from <= to');
    }

    const episodes = await this.prisma.idleEpisode.findMany({
      where: { organizationId, idleSince: { gte: start, lte: end } },
      orderBy: { idleSince: 'desc' },
      include: {
        captures: {
          orderBy: { capturedAt: 'asc' },
          select: { id: true, capturedAt: true, cameraStatus: true, summary: true },
        },
      },
    });

    const withCaptures = episodes.filter((e) => e.captures.length > 0);
    const imageIds = withCaptures
      .slice(0, MAX_EPISODES_WITH_IMAGES)
      .flatMap((e) => pickImageIndexes(e.captures.length).map((i) => e.captures[i].id));
    const images = imageIds.length
      ? await this.prisma.idleCapture.findMany({
          where: { id: { in: imageIds } },
          select: { id: true, screenshot: true, camera: true },
        })
      : [];
    const imageById = new Map(images.map((img) => [img.id, img]));

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(withCaptures.map((e) => e.userId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    return {
      from,
      to,
      imagesLimited: withCaptures.length > MAX_EPISODES_WITH_IMAGES,
      episodes: withCaptures.map((e) => {
        const endedAt = e.endedAt || e.captures[e.captures.length - 1].capturedAt;
        return {
          id: e.id,
          userId: e.userId,
          employeeName: nameById.get(e.userId) || 'Unknown employee',
          idleSince: e.idleSince.toISOString(),
          endedAt: endedAt.toISOString(),
          stillOpen: !e.endedAt,
          idleSeconds: Math.max(0, Math.round((endedAt.getTime() - e.idleSince.getTime()) / 1000)),
          summary: summariseEpisode(e.captures),
          captures: e.captures.map((c) => {
            const img = imageById.get(c.id);
            return {
              capturedAt: c.capturedAt.toISOString(),
              cameraStatus: c.cameraStatus,
              summary: c.summary,
              screenshot: toDataUrl(img?.screenshot),
              camera: toDataUrl(img?.camera),
            };
          }),
        };
      }),
    };
  }

  /**
   * Storage: when an idle period has ended (or is over 12 h old), keep the
   * pictures only for the captures the report shows (first/middle/last);
   * the other minutes keep their time, camera result and AI summary.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async pruneImages(now: Date = new Date()): Promise<number> {
    const episodes = await this.prisma.idleEpisode.findMany({
      where: {
        imagesPruned: false,
        OR: [{ endedAt: { not: null } }, { idleSince: { lt: new Date(now.getTime() - MAX_EPISODE_AGE_MS) } }],
      },
      select: { id: true, captures: { orderBy: { capturedAt: 'asc' }, select: { id: true } } },
      take: 500,
    });
    for (const ep of episodes) {
      const keep = new Set(pickImageIndexes(ep.captures.length).map((i) => ep.captures[i].id));
      const drop = ep.captures.filter((c) => !keep.has(c.id)).map((c) => c.id);
      if (drop.length) {
        await this.prisma.idleCapture.updateMany({ where: { id: { in: drop } }, data: { screenshot: null, camera: null } });
      }
      await this.prisma.idleEpisode.update({ where: { id: ep.id }, data: { imagesPruned: true } });
    }
    return episodes.length;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async deleteOldCaptures(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const old = await this.prisma.idleEpisode.findMany({ where: { idleSince: { lt: cutoff } }, select: { id: true } });
      if (!old.length) return;
      const ids = old.map((e) => e.id);
      await this.prisma.idleCapture.deleteMany({ where: { episodeId: { in: ids } } });
      await this.prisma.idleEpisode.deleteMany({ where: { id: { in: ids } } });
      this.logger.log(`Deleted ${ids.length} idle report period(s) older than ${RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.warn(`Idle report cleanup failed: ${(err as Error).message}`);
    }
  }
}
