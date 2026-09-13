import React, { useEffect, useState } from 'react';
import { productivityApiService, Employee, ShiftSummary } from './src/services/productivityApi.service';

const formatSeconds = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

/**
 * Manager-only "Productivity" page: replaces the old fabricated
 * Overall-Benchmark-Score/app-time-breakdown cards (hardcoded Figma/VS
 * Code/Chrome percentages, unrelated to any real tracked data) with a real
 * employee dropdown driving ProductivityService.get_shift_summary()'s
 * unified Overall Productivity formula - Attendance Ratio + App Focus
 * Score + Compliance Score, weighted. Every number here is real, sourced
 * from the same single calculation every other productivity percentage in
 * the app now reads from.
 */
const todayIsoDate = () => new Date().toISOString().split('T')[0];

export const ManagerProductivityView: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(todayIsoDate());
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    productivityApiService
      .listEmployees()
      .then((list) => {
        if (cancelled) return;
        const trackedEmployees = list.filter((e) => e.role === 'EMPLOYEE');
        setEmployees(trackedEmployees);
        // Functional update reading the current selection rather than one
        // closed over at mount - safe against a stale-closure reset on
        // whatever periodic refresh is added here later.
        setSelectedEmployeeId((prev) => prev || trackedEmployees[0]?.id || '');
      })
      .catch((e) => console.warn('[ManagerProductivityView] Failed to load employees:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    let cancelled = false;
    // Clear the previous employee/day's numbers immediately on switch,
    // rather than leaving the last selection's card up while the new
    // fetch is in flight - the stale data sitting there while nothing
    // visibly reacted to the dropdown is exactly what made this look
    // hardcoded/unresponsive.
    setSummary(null);

    const fetchSummary = (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      productivityApiService
        .getShiftSummary(selectedEmployeeId, selectedDate)
        .then((s) => {
          if (cancelled) return;
          setSummary(s);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn('[ManagerProductivityView] Failed to load shift summary:', e);
          setError('Failed to load real productivity data for this employee.');
        })
        .finally(() => {
          if (!cancelled && showLoading) setLoading(false);
        });
    };

    fetchSummary(true);
    // Only auto-refresh a live "today" view - re-polling a fixed
    // historical date every 30s would just repeat the exact same request.
    const interval = selectedDate === todayIsoDate() ? setInterval(() => fetchSummary(false), 30000) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [selectedEmployeeId, selectedDate]);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-3xl border shadow-sm bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-800 dark:text-white">Overall Productivity</h3>
          <p className="text-xs text-slate-400 mt-1">
            Real Attendance Ratio + App Focus Score + Compliance Score, computed by the unified productivity formula - recalculated per employee, per day selected below.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            max={todayIsoDate()}
            onChange={(e) => setSelectedDate(e.target.value || todayIsoDate())}
            className="px-4 py-2.5 rounded-xl border text-sm font-semibold bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-400"
          />
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            className="px-4 py-2.5 rounded-xl border text-sm font-semibold bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-400"
          >
            {employees.length === 0 && <option value="">No employees found</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && !summary ? (
        <div className="p-12 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          Loading real productivity data...
        </div>
      ) : error && !summary ? (
        <div className="p-12 text-center text-rose-500 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          {error}
        </div>
      ) : !summary ? (
        <div className="p-12 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          Select an employee to see their productivity breakdown.
        </div>
      ) : (
        <>
          {/* Which employee/day this data is actually for - explicit, not
              inferred, so it's never ambiguous whether the dropdown above
              did anything. */}
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 -mb-2">
            Showing real data for <span className="text-indigo-600 dark:text-indigo-400">{selectedEmployee?.fullName || summary.employeeId}</span> on {summary.date}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="p-6 rounded-3xl border shadow-sm bg-gradient-to-br from-indigo-600 to-indigo-700 border-indigo-700 text-white">
              <p className="text-xs font-medium text-indigo-100">Overall Productivity</p>
              <h4 className="text-4xl font-extrabold mt-2">{summary.productivityPercentage}%</h4>
              <p className="text-xs text-indigo-100 mt-1">
                {summary.weightsUsed.attendanceWeight}% Attendance + {summary.weightsUsed.appFocusWeight}% App Focus + {summary.weightsUsed.complianceWeight}% Compliance
              </p>
            </div>

            <div className="p-6 rounded-3xl border shadow-sm bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-400">Attendance Ratio</p>
              <h4 className="text-3xl font-extrabold text-emerald-500 mt-2">{summary.attendanceRatio}%</h4>
              <p className="text-xs text-slate-400 mt-1">Combined Active ÷ (Shift − Break)</p>
            </div>

            <div className="p-6 rounded-3xl border shadow-sm bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-400">App Focus Score</p>
              <h4 className="text-3xl font-extrabold text-cyan-500 mt-2">{summary.appFocusScore}%</h4>
              <p className="text-xs text-slate-400 mt-1">(Jabber + Wildix) ÷ Combined Active</p>
            </div>

            <div className="p-6 rounded-3xl border shadow-sm bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-400">Compliance Score</p>
              <h4 className="text-3xl font-extrabold text-amber-500 mt-2">{summary.complianceScore}%</h4>
              <p className="text-xs text-slate-400 mt-1">100 − idle/break/washroom penalties</p>
            </div>
          </div>

          <div className="p-6 rounded-3xl border shadow-sm bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
            <h4 className="text-lg font-bold text-slate-800 dark:text-white mb-4">
              Real Tracked Time — {selectedEmployee?.fullName || 'Employee'}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Combined Active</p>
                <p className="font-bold text-slate-800 dark:text-white">{formatSeconds(summary.combinedActiveSeconds)}</p>
              </div>
              <div>
                <p className="text-slate-400">Cisco Jabber</p>
                <p className="font-bold text-slate-800 dark:text-white">{formatSeconds(summary.jabberSeconds)}</p>
              </div>
              <div>
                <p className="text-slate-400">Wildix</p>
                <p className="font-bold text-slate-800 dark:text-white">{formatSeconds(summary.wildixSeconds)}</p>
              </div>
              <div>
                <p className="text-slate-400">Idle</p>
                <p className="font-bold text-slate-800 dark:text-white">{formatSeconds(summary.idleSeconds)}</p>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-3xl border shadow-sm bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800">
            <h4 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Compliance Penalty Breakdown</h4>
            <p className="text-xs text-slate-400 mb-4">
              Idle threshold: {Math.round(summary.complianceBreakdown.idleThresholdSeconds / 60)} min · washroom limits and call efficiency (once call-log tracking exists) will show here too.
            </p>
            <div className="space-y-3 text-sm divide-y divide-slate-100 dark:divide-slate-800">
              <div className="flex justify-between items-center pb-3">
                <span className="text-slate-500 dark:text-slate-400">
                  Idle time beyond threshold ({Math.round(summary.complianceBreakdown.idleSeconds / 60)}m tracked idle today)
                </span>
                <span className={`font-bold ${summary.complianceBreakdown.idlePenaltyPoints > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  -{summary.complianceBreakdown.idlePenaltyPoints} pts
                </span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-slate-500 dark:text-slate-400">
                  Late returns from scheduled breaks ({summary.complianceBreakdown.lateReturnCount})
                </span>
                <span className={`font-bold ${summary.complianceBreakdown.lateReturnPenaltyPoints > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  -{summary.complianceBreakdown.lateReturnPenaltyPoints} pts
                </span>
              </div>
              <div className="flex justify-between items-center pt-3">
                <span className="text-slate-500 dark:text-slate-400">
                  Washroom break limit violations ({summary.complianceBreakdown.washroomOverLimitCount} over count, {summary.complianceBreakdown.washroomOverDurationCount} over duration)
                </span>
                <span className={`font-bold ${summary.complianceBreakdown.washroomPenaltyPoints > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  -{summary.complianceBreakdown.washroomPenaltyPoints} pts
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ManagerProductivityView;
