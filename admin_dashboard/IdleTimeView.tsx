import React from 'react';
import { Activity, Clock, Moon, PhoneCall, TrendingUp, Users } from 'lucide-react';
import { useIdleTimeSummary } from './src/hooks/useIdleTimeSummary';
import { EmployeeIdleStatus, IdleStatus } from './src/services/productivityApi.service';
import { ProductivityBadge } from './ProductivityBadge';
import { PresenceVerificationCard } from './PresenceVerificationCard';

const STATUS_BADGE: Record<IdleStatus, { label: string; classes: string }> = {
  ACTIVE_JABBER: { label: 'Active · Jabber', classes: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50' },
  ACTIVE_WILDIX: { label: 'Active · Wildix', classes: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900/50' },
  ACTIVE: { label: 'Active', classes: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50' },
  IDLE: { label: 'Idle', classes: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/50' },
  AWAY: { label: 'Away', classes: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700' },
  ON_BREAK: { label: 'On Break', classes: 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900/50' },
  CHECKED_OUT: { label: 'Checked Out', classes: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700' },
  NOT_CHECKED_IN: { label: 'Not Checked In', classes: 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700' },
};

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function average(employees: EmployeeIdleStatus[], pick: (e: EmployeeIdleStatus) => number): number {
  if (employees.length === 0) return 0;
  return employees.reduce((sum, e) => sum + pick(e), 0) / employees.length;
}

/**
 * "Idle Time" — replaces the Recordings section in the sidebar. Per-employee
 * mouse/keyboard idle vs. active time, with Cisco Jabber / Wildix broken out
 * specifically, sourced from the FastAPI + Supabase idle-time service
 * (GET /api/idle-time/summary), polled every 20s.
 */
export const IdleTimeView: React.FC = () => {
  const { summary, loading } = useIdleTimeSummary();
  const employees = summary?.employees || [];

  const avgProductivity = summary?.avgProductivityPercentage ?? 0;
  const avgActiveSeconds = average(employees, (e) => e.activeSeconds);
  const avgIdleSeconds = average(employees, (e) => e.idleSeconds);
  const totalJabberSeconds = employees.reduce((sum, e) => sum + e.jabberSeconds, 0);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
            <Activity className="w-3.5 h-3.5" />
            <span>Idle Time</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Idle & Active Time Tracking</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Mouse/keyboard input & active-window tracking — Cisco Jabber and Wildix time is broken out separately.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Avg Productivity</span>
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950/50 rounded-2xl text-purple-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-purple-600 mt-4">{Math.round(avgProductivity)}%</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Avg Active Time</span>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-4">{formatDuration(avgActiveSeconds)}</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Avg Idle Time</span>
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/50 rounded-2xl text-amber-600">
              <Moon className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-4">{formatDuration(avgIdleSeconds)}</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Team Jabber Time</span>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600">
              <PhoneCall className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-4">{formatDuration(totalJabberSeconds)}</h3>
        </div>
      </div>

      {/* Per-employee table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center space-x-2">
          <Users className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-extrabold text-slate-800 dark:text-white">Today, per employee</h2>
        </div>

        {loading && employees.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-10">Loading idle/active data…</p>
        ) : employees.length === 0 ? (
          <div className="text-center py-14 space-y-2">
            <Clock className="w-10 h-10 text-indigo-400 mx-auto" />
            <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
              No idle/active data logged yet today. The desktop app reports this automatically once an employee is
              signed in.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-6 py-3 font-bold">Employee</th>
                  <th className="px-6 py-3 font-bold">Status</th>
                  <th className="px-6 py-3 font-bold">Active</th>
                  <th className="px-6 py-3 font-bold">Idle</th>
                  <th className="px-6 py-3 font-bold">Cisco Jabber</th>
                  <th className="px-6 py-3 font-bold">Wildix</th>
                  <th className="px-6 py-3 font-bold text-right">Productivity</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const badge = STATUS_BADGE[employee.status] || STATUS_BADGE.AWAY;
                  return (
                    <tr key={employee.employeeId} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                            {employee.employeeName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </div>
                          <span className="text-xs font-bold text-slate-800 dark:text-white">{employee.employeeName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold border ${badge.classes}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {formatDuration(employee.activeSeconds)}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {formatDuration(employee.idleSeconds)}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {formatDuration(employee.jabberSeconds)}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {formatDuration(employee.wildixSeconds)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ProductivityBadge score={employee.productivityPercentage} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Camera + input cross-check, per employee (opt-in, see Settings) */}
      <PresenceVerificationCard />
    </div>
  );
};

export default IdleTimeView;
