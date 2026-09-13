import http, { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { getLocalSettings, getLanIpAddresses } from './localSettings';

/**
 * Replaces the MongoDB Atlas upload pipeline: this admin-side HTTP server
 * (runs inside the manager's WorkTrackPro app) receives screenshots POSTed
 * directly from employee machines over the LAN and writes them straight to
 * local disk under screenshotStoragePath/<employee>/<date>/. No database
 * involved at all for this data now - the gallery reads the same folder
 * tree back (see list-local-screenshots below).
 *
 * Built on Node's built-in http module rather than adding an express
 * dependency - this app has exactly one real endpoint to serve
 * (POST /upload) plus a couple of read-only IPC-driven folder scans, which
 * doesn't justify a new dependency.
 */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB - comfortably above a 1920x1080 PNG data URL

let server: http.Server | null = null;

function sanitizeForPath(name: string): string {
  // Strip characters invalid in Windows (and awkward on any OS) path
  // segments, and collapse whitespace - an employee's display name is
  // free text (could contain "/", ":", etc.) but becomes a real folder
  // name here.
  return (name || 'unknown-employee').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'unknown-employee';
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: any;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { success: false, error: 'Invalid or oversized request body' });
    return;
  }

  const { employeeId, employeeName, image, timestamp, activeWindowName, isIdle, date } = payload || {};
  if (!employeeId || !employeeName || !image) {
    sendJson(res, 400, { success: false, error: 'employeeId, employeeName, and image are required' });
    return;
  }

  const commaIndex = String(image).indexOf(',');
  const rawBase64 = String(image).startsWith('data:') && commaIndex !== -1 ? image.slice(commaIndex + 1) : image;

  const capturedAt = timestamp ? new Date(timestamp) : new Date();
  const dateFolder = date || capturedAt.toISOString().split('T')[0];
  const settings = getLocalSettings();
  const employeeFolder = sanitizeForPath(employeeName);
  const targetDir = path.join(settings.screenshotStoragePath, employeeFolder, dateFolder);

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const hhmmss = capturedAt.toTimeString().slice(0, 8).replace(/:/g, '-');
    const baseName = `${hhmmss}_${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(targetDir, `${baseName}.png`);
    fs.writeFileSync(filePath, Buffer.from(rawBase64, 'base64'));

    // Sidecar metadata (same basename, .json) - the folder/filename alone
    // only carries employee name + date, not role/idle-state/active-window,
    // which the gallery still needs to show. Read back by
    // list-local-screenshots() below.
    const metaPath = path.join(targetDir, `${baseName}.json`);
    const meta = {
      employeeId,
      employeeName,
      employeeRole: payload.employeeRole || null,
      activeWindowName: activeWindowName || null,
      isIdle: !!isIdle,
      capturedAt: capturedAt.toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');

    console.log(`[LocalScreenshotServer] Saved screenshot for ${employeeName} -> ${filePath}`);

    // Live-update the gallery in this window (or any open window) the
    // moment a screenshot lands on disk from a remote employee machine -
    // this admin process's own 'screenshot-captured-event' (captureService.ts)
    // only fires for a capture taken ON this machine, which doesn't cover
    // uploads arriving over the LAN from someone else's computer.
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('local-screenshot-received', { employeeName, date: dateFolder, filePath, ...meta });
      }
    });

    sendJson(res, 201, {
      success: true,
      filePath,
      employeeId,
      employeeName,
      capturedAt: capturedAt.toISOString(),
      activeWindowName: activeWindowName || null,
      isIdle: !!isIdle,
    });
  } catch (err) {
    console.error('[LocalScreenshotServer] Failed to write screenshot to disk:', err);
    sendJson(res, 500, { success: false, error: 'Failed to write screenshot to disk' });
  }
}

function requestListener(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/upload') {
    void handleUpload(req, res);
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  sendJson(res, 404, { success: false, error: 'Not found' });
}

export function startLocalScreenshotServer(port?: number): void {
  stopLocalScreenshotServer();
  const settings = getLocalSettings();
  const listenPort = port ?? settings.localServerPort;

  server = http.createServer(requestListener);
  server.on('error', (err) => {
    console.error(`[LocalScreenshotServer] Failed to start on port ${listenPort}:`, err);
  });
  // Bind on all interfaces (0.0.0.0), not just localhost - this server
  // exists specifically to accept connections from OTHER machines on the
  // LAN, unlike every other localhost-only endpoint this app talks to.
  server.listen(listenPort, '0.0.0.0', () => {
    console.log(`[LocalScreenshotServer] Listening on 0.0.0.0:${listenPort} - LAN IPs: ${getLanIpAddresses().join(', ') || 'none detected'}`);
  });
}

export function stopLocalScreenshotServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}

export function isLocalScreenshotServerRunning(): boolean {
  return !!server && server.listening;
}

// ---- reading the stored screenshot tree back for the Gallery -------------

export interface LocalScreenshotEntry {
  id: string;
  employeeId: string | null;
  employeeName: string;
  employeeRole: string | null;
  date: string;
  fileName: string;
  filePath: string;
  capturedAt: string; // from the sidecar .json when present, else file mtime
  activeWindowName: string | null;
  isIdle: boolean;
}

function walkScreenshotTree(root: string): LocalScreenshotEntry[] {
  const entries: LocalScreenshotEntry[] = [];
  let employeeDirs: string[];
  try {
    employeeDirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return entries; // storage root doesn't exist yet - nothing captured so far
  }

  for (const employeeName of employeeDirs) {
    const employeeDir = path.join(root, employeeName);
    let dateDirs: string[];
    try {
      dateDirs = fs.readdirSync(employeeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const date of dateDirs) {
      const dateDir = path.join(employeeDir, date);
      let files: string[];
      try {
        files = fs.readdirSync(dateDir).filter((f) => f.toLowerCase().endsWith('.png'));
      } catch {
        continue;
      }
      for (const fileName of files) {
        const filePath = path.join(dateDir, fileName);
        const metaPath = filePath.replace(/\.png$/i, '.json');

        let capturedAt: string;
        try {
          capturedAt = fs.statSync(filePath).mtime.toISOString();
        } catch {
          capturedAt = new Date().toISOString();
        }

        let employeeId: string | null = null;
        let employeeRole: string | null = null;
        let activeWindowName: string | null = null;
        let isIdle = false;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          employeeId = meta.employeeId ?? null;
          employeeRole = meta.employeeRole ?? null;
          activeWindowName = meta.activeWindowName ?? null;
          isIdle = !!meta.isIdle;
          if (meta.capturedAt) capturedAt = meta.capturedAt;
        } catch {
          // Sidecar missing (older capture, or written by a future/older
          // build without one) - the image itself still displays fine,
          // just with less metadata.
        }

        entries.push({
          id: filePath,
          employeeId,
          employeeName,
          employeeRole,
          date,
          fileName,
          filePath,
          capturedAt,
          activeWindowName,
          isIdle,
        });
      }
    }
  }

  return entries.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}

export function registerLocalScreenshotServerIpcHandlers(): void {
  ipcMain.handle('get-local-server-status', async () => {
    return {
      running: isLocalScreenshotServerRunning(),
      port: getLocalSettings().localServerPort,
      lanIpAddresses: getLanIpAddresses(),
      storagePath: getLocalSettings().screenshotStoragePath,
    };
  });

  ipcMain.handle('list-local-screenshots', async () => {
    return walkScreenshotTree(getLocalSettings().screenshotStoragePath);
  });

  ipcMain.handle('delete-all-local-screenshots', async () => {
    const root = getLocalSettings().screenshotStoragePath;
    try {
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
      return { success: true };
    } catch (err) {
      console.error('[LocalScreenshotServer] Failed to delete all local screenshots:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('restart-local-screenshot-server', async (_event, port: number) => {
    startLocalScreenshotServer(port);
    return { running: isLocalScreenshotServerRunning(), port };
  });
}
