import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface IStorageService {
  upload(
    fileBuffer: Buffer,
    organizationId: string,
    userId: string,
    fileName: string,
    mimeType: string,
  ): Promise<{ filePath: string; fileUrl: string; fileSize: number }>;
  delete(filePath: string): Promise<boolean>;
  getUrl(filePath: string): string;
  exists(filePath: string): Promise<boolean>;
}

@Injectable()
export class StorageService implements IStorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly basePath: string;

  constructor(private readonly configService: ConfigService) {
    const rawPath = this.configService.get<string>('STORAGE_PATH') || './storage';
    this.basePath = path.resolve(rawPath);
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async upload(
    fileBuffer: Buffer,
    organizationId: string,
    userId: string,
    fileName: string,
    mimeType: string,
  ): Promise<{ filePath: string; fileUrl: string; fileSize: number }> {
    const safeOrg = organizationId.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeFile = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');

    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const relativeDir = path.join('screenshots', safeOrg, safeUser, year, month, day);
    const absoluteDir = path.join(this.basePath, relativeDir);

    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }

    const uniqueFileName = `${Date.now()}_${safeFile}`;
    const absolutePath = path.join(absoluteDir, uniqueFileName);
    const relativePath = path.join(relativeDir, uniqueFileName).replace(/\\/g, '/');

    // Prevent directory traversal
    if (!absolutePath.startsWith(this.basePath)) {
      throw new Error('Invalid file path: Directory traversal prohibited');
    }

    await fs.promises.writeFile(absolutePath, fileBuffer);
    const fileSize = fileBuffer.length;

    const fileUrl = `/api/v1/screenshots/file/${encodeURIComponent(relativePath)}`;

    return {
      filePath: relativePath,
      fileUrl,
      fileSize,
    };
  }

  /**
   * Archive screenshot: screenshots/<Employee Name>/<YYYY-MM-DD>/<YYYY-MM-DD_HH-mm-ss>.<ext>
   * Folder and file names use Asia/Karachi wall-clock time.
   */
  async uploadScreenshot(
    fileBuffer: Buffer,
    employeeName: string,
    capturedAt: Date,
    mimeType: string,
  ): Promise<{ filePath: string; fileUrl: string; fileSize: number }> {
    const safeName =
      employeeName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'unknown-employee';
    const karachi = new Date(capturedAt.getTime() + 5 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const day = `${karachi.getUTCFullYear()}-${pad(karachi.getUTCMonth() + 1)}-${pad(karachi.getUTCDate())}`;
    const time = `${pad(karachi.getUTCHours())}-${pad(karachi.getUTCMinutes())}-${pad(karachi.getUTCSeconds())}`;
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    const relativeDir = path.join('screenshots', safeName, day);
    const absoluteDir = path.join(this.basePath, relativeDir);
    if (!absoluteDir.startsWith(this.basePath)) {
      throw new Error('Invalid file path: Directory traversal prohibited');
    }
    fs.mkdirSync(absoluteDir, { recursive: true });

    const fileName = `${day}_${time}.${ext}`;
    const absolutePath = path.join(absoluteDir, fileName);
    const relativePath = path.join(relativeDir, fileName).replace(/\\/g, '/');
    await fs.promises.writeFile(absolutePath, fileBuffer);

    return {
      filePath: relativePath,
      fileUrl: `/api/v1/screenshots/file/${encodeURIComponent(relativePath)}`,
      fileSize: fileBuffer.length,
    };
  }

  async delete(filePath: string): Promise<boolean> {
    const safeRelativePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(this.basePath, safeRelativePath);

    if (!absolutePath.startsWith(this.basePath)) {
      this.logger.warn(`Blocked directory traversal attempt: ${filePath}`);
      return false;
    }

    try {
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
        return true;
      }
    } catch (err) {
      this.logger.error(`Error deleting file ${absolutePath}: ${err.message}`);
    }
    return false;
  }

  getUrl(filePath: string): string {
    return `/api/v1/screenshots/file/${encodeURIComponent(filePath)}`;
  }

  async exists(filePath: string): Promise<boolean> {
    const safeRelativePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(this.basePath, safeRelativePath);
    return fs.existsSync(absolutePath) && absolutePath.startsWith(this.basePath);
  }

  getAbsPath(filePath: string): string {
    const safeRelativePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(this.basePath, safeRelativePath);
    if (!absolutePath.startsWith(this.basePath)) {
      throw new Error('Invalid path access');
    }
    return absolutePath;
  }
}
