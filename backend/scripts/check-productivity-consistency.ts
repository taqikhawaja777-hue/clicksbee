/**
 * Productivity Consistency Verification Script
 * 
 * Recomputes productivity for all employees in a date range using the
 * shared formula, and checks against stored values in MongoDB.
 * Prints any employee whose stored values differ from recomputed ones.
 * 
 * Usage:
 *   npx ts-node scripts/check-productivity-consistency.ts [startDate] [endDate]
 */
import { PrismaClient } from '@prisma/client';
import { computeProductivityMetrics } from '../src/common/utils/productivity.util';
import { getShiftDayString } from '../src/common/utils/shift-day.util';

const prisma = new PrismaClient();

async function checkConsistency(startDate?: string, endDate?: string) {
  const start = startDate || getShiftDayString();
  const end = endDate || start;

  console.log(`[Consistency Check] Verifying date range ${start} to ${end}...`);

  const [users, attendanceRecords, idleLogs, storedRecords] = await Promise.all([
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, email: true } }),
    prisma.attendance.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.idleTimeLog.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.productivityRecord.findMany({ where: { date: { gte: start, lte: end } } }),
  ]);

  const dialerAliases = ['jabber', 'ciscojabber', 'ciscocollabhost', 'wildix', 'x-bees', 'wixphone', 'yeastar', 'yeaster', 'linkus'];
  const storedMap = new Map(storedRecords.map((r) => [`${r.userId}_${r.date}`, r]));

  let totalChecked = 0;
  let discrepancies = 0;

  for (const user of users) {
    const userAttendance = attendanceRecords.filter((a) => a.userId === user.id);
    const userIdle = idleLogs.filter((i) => i.userId === user.id);
    const dates = Array.from(new Set([...userAttendance.map((a) => a.date), ...userIdle.map((i) => i.date)]));

    for (const date of dates) {
      totalChecked++;
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

      const recomputed = computeProductivityMetrics({
        activeSeconds,
        idleSeconds,
        dialerSeconds,
        shiftDurationSeconds,
      });

      const stored = storedMap.get(`${user.id}_${date}`);
      if (!stored) {
        discrepancies++;
        console.warn(`[DISCREPANCY] ${user.firstName} ${user.lastName} (${user.email}) on ${date}: Stored record MISSING. Expected: ${recomputed.overallProductivityPercentage}%`);
      } else if (Math.abs(stored.productivityPercentage - recomputed.overallProductivityPercentage) > 0.5) {
        discrepancies++;
        console.warn(`[DISCREPANCY] ${user.firstName} ${user.lastName} (${user.email}) on ${date}: Stored=${stored.productivityPercentage}%, Recomputed=${recomputed.overallProductivityPercentage}% (Diff: ${(stored.productivityPercentage - recomputed.overallProductivityPercentage).toFixed(1)}%)`);
      }
    }
  }

  console.log(`\n[Consistency Check] Summary: ${totalChecked} records checked. Discrepancies found: ${discrepancies}.`);
  if (discrepancies === 0) {
    console.log('[Consistency Check] ALL records are fully consistent with the unified productivity formula!');
  }
}

const args = process.argv.slice(2);
checkConsistency(args[0], args[1])
  .catch((e) => {
    console.error('[Consistency Check] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
