import fs from 'fs';
import path from 'path';
import { getLocalSettings } from './localSettings';

/**
 * Deletes any screenshot file older than 24 hours from local disk. Runs on
 * a periodic sweep (checked hourly) rather than a single fixed-time daily
 * cron (e.g. node-schedule firing once at 2 AM) - the requirement is
 * age-based ("older than 24 hours"), and an hourly age-check sweep also
 * self-heals if the app was closed/asleep when a fixed-time job would have
 * fired, which a single daily trigger wouldn't. No new dependency needed
 * for this (setInterval is enough), unlike a real "run exactly at 2 AM
 * every day" cron requirement would be.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let sweepTimer: NodeJS.Timeout | null = null;

function sweepOnce(): void {
  const root = getLocalSettings().screenshotStoragePath;
  const now = Date.now();
  let deleted = 0;

  let employeeDirs: string[];
  try {
    employeeDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return; // storage root doesn't exist yet - nothing to clean
  }

  for (const employeeName of employeeDirs) {
    const employeeDir = path.join(root, employeeName);
    let dateDirs: string[];
    try {
      dateDirs = fs.readdirSync(employeeDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const date of dateDirs) {
      const dateDir = path.join(employeeDir, date);
      let files: string[];
      try {
        files = fs.readdirSync(dateDir);
      } catch {
        continue;
      }
      for (const fileName of files) {
        const filePath = path.join(dateDir, fileName);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch {
          // file removed by something else mid-sweep, or unreadable - skip
        }
      }
      // Clean up now-empty date/employee folders so the tree doesn't
      // accumulate thousands of empty directories over months of use.
      try {
        if (fs.readdirSync(dateDir).length === 0) fs.rmdirSync(dateDir);
      } catch {
        // not empty, or already gone - fine either way
      }
    }
    try {
      if (fs.readdirSync(employeeDir).length === 0) fs.rmdirSync(employeeDir);
    } catch {
      // not empty, or already gone - fine either way
    }
  }

  if (deleted > 0) {
    console.log(`[ScreenshotCleanup] Deleted ${deleted} screenshot(s) older than 24h.`);
  }
}

export function startScreenshotCleanupSweep(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepOnce(); // catch up immediately on startup, don't wait a full hour for the first sweep
  sweepTimer = setInterval(sweepOnce, SWEEP_INTERVAL_MS);
}

export function stopScreenshotCleanupSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
