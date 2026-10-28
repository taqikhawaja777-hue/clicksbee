/**
 * Safe, Re-runnable Productivity Backfill Script
 * 
 * Recomputes historical daily productivity for all employees in a date range
 * using the unified formula (90% App Focus + 5% Compliance + 5% Attendance).
 * Does NOT delete any raw data.
 * 
 * Usage:
 *   npx ts-node scripts/backfill-productivity.ts [startDate] [endDate]
 * Example:
 *   npx ts-node scripts/backfill-productivity.ts 2026-10-01 2026-10-28
 */
import { PrismaClient } from '@prisma/client';
import { computeProductivityMetrics } from '../src/common/utils/productivity.util';
import { getShiftDayString } from '../src/common/utils/shift-day.util';

const prisma = new PrismaClient();

async function backfill(startDate?: string, endDate?: string) {
  const start = startDate || getShiftDayString();
  const end = endDate || start;

  console.log(`[Backfill] Starting productivity backfill from ${start} to ${end}...`);

  const [users, attendanceRecords, idleLogs] = await Promise.all([
    prisma.user.findMany({ select: { id: true, organizationId: true, firstName: true, lastName: true } }),
    prisma.attendance.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.idleTimeLog.findMany({ where: { date: { gte: start, lte: end } } }),
  ]);

  console.log(`[Backfill] Loaded ${users.length} users, ${attendanceRecords.length} attendance rows, ${idleLogs.length} idle logs.`);

  const dialerAliases = ['jabber', 'ciscojabber', 'ciscocollabhost', 'wildix', 'x-bees', 'wixphone', 'yeastar', 'yeaster', 'linkus'];

  let processedCount = 0;

  for (const user of users) {
    const userAttendance = attendanceRecords.filter((a) => a.userId === user.id);
    const userIdle = idleLogs.filter((i) => i.userId === user.id);

    const dates = Array.from(new Set([...userAttendance.map((a) => a.date), ...userIdle.map((i) => i.date)]));

    for (const date of dates) {
      const att = userAttendance.find((a) => a.date === date);
      const idle = userIdle.find((i) => i.date === date);

      const activeSeconds = idle?.activeSeconds || 0;
      const idleSeconds = idle?.idleSeconds || 0;
      const appFocus = (idle?.appFocusSeconds || {}) as Record<string, number>;

      const dialerSeconds = Object.entries(appFocus).reduce((sum, [name, sec]) => {
        const lower = name.toLowerCase();
        return dialerAliases.some((alias) => lower.includes(alias)) ? sum + (Number(sec) || 0) : sum;
      }, 0);

      const shiftDurationSeconds = att?.totalWorkDuration || (activeSeconds + idleSeconds);

      const metrics = computeProductivityMetrics({
        activeSeconds,
        idleSeconds,
        dialerSeconds,
        shiftDurationSeconds,
      });

      await prisma.productivityRecord.upsert({
        where: {
          userId_date: {
            userId: user.id,
            date,
          },
        },
        create: {
          organizationId: user.organizationId,
          userId: user.id,
          date,
          activeSeconds,
          idleSeconds,
          productiveSeconds: dialerSeconds,
          breakSeconds: 0,
          totalTrackedSeconds: activeSeconds + idleSeconds,
          productivityPercentage: metrics.overallProductivityPercentage,
        },
        update: {
          activeSeconds,
          idleSeconds,
          productiveSeconds: dialerSeconds,
          totalTrackedSeconds: activeSeconds + idleSeconds,
          productivityPercentage: metrics.overallProductivityPercentage,
        },
      });

      processedCount++;
    }
  }

  console.log(`[Backfill] Completed! Recomputed ${processedCount} employee-day records without modifying raw data.`);
}

const args = process.argv.slice(2);
backfill(args[0], args[1])
  .catch((e) => {
    console.error('[Backfill] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
