import {
  Controller,
  Get,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  Req,
  Query,
  Param,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RecordingsService } from './recordings.service';
import { Response, Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@ApiTags('Recordings')
@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  @ApiOperation({ summary: 'Upload screen recording clip to MongoDB VideoRecording collection' })
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadRecording(
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { durationMs?: string; durationSec?: string; sessionId?: string; title?: string; userId?: string; organizationId?: string; videoBase64?: string }
  ) {
    const userId = req.user?.id || body?.userId || 'emp-101';
    const orgId = req.user?.organizationId || body?.organizationId || 'org-101';

    let buffer: Buffer;
    if (file && file.buffer) {
      buffer = file.buffer;
    } else if (body && body.videoBase64) {
      const base64Data = body.videoBase64.replace(/^data:video\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      // Fallback 1KB demo webm buffer if no binary file sent
      buffer = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAA', 'base64');
    }

    let durationMs = 15000;
    if (body?.durationSec) {
      durationMs = parseInt(body.durationSec, 10) * 1000;
    } else if (body?.durationMs) {
      durationMs = parseInt(body.durationMs, 10);
    }

    return this.recordingsService.saveRecordingClip({
      userId,
      organizationId: orgId,
      sessionId: body?.sessionId,
      fileBuffer: buffer,
      durationMs,
      title: body?.title,
      originalName: file?.originalname || 'screen_recording.webm',
    });
  }

  @ApiOperation({ summary: 'Fetch live recordings feed from MongoDB VideoRecording collection' })
  @Get('feed')
  async getFeed(@Req() req: any, @Query('userId') filterUserId?: string) {
    const orgId = req.user?.organizationId || 'org-101';
    const userId = req.user?.id || 'emp-101';
    const isEmployee = req.user?.role === 'EMPLOYEE';

    const targetFilter = isEmployee ? userId : filterUserId;
    return this.recordingsService.getRecordingsFeed(orgId, targetFilter);
  }

  @ApiOperation({ summary: 'Stream video recording binary by ID with HTTP 206 Partial Content Range support' })
  @Get('stream/:id')
  async streamRecording(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const { absPath, stat } = await this.recordingsService.streamRecordingFile(id);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(absPath, { start, end });

        res.status(206);
        res.set({
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': 'video/webm',
          'Cache-Control': 'no-cache',
        });

        fileStream.pipe(res);
      } else {
        res.status(200);
        res.set({
          'Content-Type': 'video/webm',
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        });

        fs.createReadStream(absPath).pipe(res);
      }
    } catch (err) {
      res.status(404).json({
        statusCode: 404,
        message: `Video stream for ${id} unavailable: ${(err as Error).message}`,
      });
    }
  }

  @ApiOperation({ summary: 'Stream video file by filename with HTTP 206 Partial Content Range support' })
  @Get('file/:filename')
  getFile(
    @Param('filename') filename: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const uploadDir = path.join(process.cwd(), 'storage', 'uploads');
    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Recording video file not found on disk');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': 'video/webm',
        'Cache-Control': 'no-cache',
        'Content-Disposition': `inline; filename="${filename}"`,
      });

      fileStream.pipe(res);
    } else {
      res.status(200);
      res.set({
        'Content-Type': 'video/webm',
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Content-Disposition': `inline; filename="${filename}"`,
      });

      fs.createReadStream(filePath).pipe(res);
    }
  }
}
