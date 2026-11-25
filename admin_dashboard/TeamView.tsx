import React, { useCallback, useEffect, useState } from 'react';
import { Users, AlertTriangle, Loader2, AlertCircle } from 'lucide-react';
import { apiService, apiErrorMessage } from './src/services/api.service';

interface AgentRow {
  employeeId: string;
  employeeName: string;
  status: string;
  activityState?: string | null;
  activeSeconds?: number;
  idleSeconds?: number;
  productivityPercentage?: number;
  idleSince?: string | null;
  isCheckedIn?: boolean;
}

const fmt = (seconds = 0) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const STATE_LABEL: Record<string, string> = {
  ON_CALL: 'On call',
  DIALING: 'Dialing',
  OTHER_WORK: 'Active',
  UNPRODUCTIVE: 'Unproductive app',
  IDLE: 'Idle',
  SUSPICIOUS: 'Suspicious',
};

/**
 * Team Lead: productivity of their OWN agents only (the server scopes the
 * rows; dialer data is not included for Team Leads) + agents idle longer
 * than the organization's limit flagged. The Team Lead also gets a
 * notification when that happens.
 */
export const TeamView: React.FC = () => {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [limitMinutes, setLimitMinutes] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [summary, config]: any[] = await Promise.all([
        apiService.get('/tracking/idle-summary'),
        apiService.getActivityConfig(),
      ]);
      const data = summary?.data ?? summary;
      setRows(data?.employees || []);
      const cfg = config?.data ?? config;
      if (cfg?.teamIdleAlertMinutes) setLimitMinutes(cfg.teamIdleAlertMinutes);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your team.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30_000);
    const tick = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const idleMinutes = (r: AgentRow) => (r.idleSince ? Math.floor((Date.now() - new Date(r.idleSince).getTime()) / 60_000) : 0);
  const flagged = rows.filter((r) => idleMinutes(r) >= limitMinutes);

  return (
    <div className="w-full max-w-5xl space-y-6 font-sans">
      <div>
        <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
          <Users className="w-3.5 h-3.5" />
          <span>My Team</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Team productivity</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">
          Your agents today. An agent idle for {limitMinutes}+ minutes is flagged and you get a notification.
        </p>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-900 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <div className="text-sm text-rose-800 dark:text-rose-300">
            <p className="font-bold">Idle too long</p>
            <p className="text-xs mt-0.5">{flagged.map((r) => `${r.employeeName} (${idleMinutes(r)} min)`).join(', ')}</p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            No agents on your team yet. Ask an Admin to set you as their Team Lead on the Users page.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="py-3 px-5">Agent</th>
                <th className="py-3 px-5">Now</th>
                <th className="py-3 px-5">Active</th>
                <th className="py-3 px-5">Idle</th>
                <th className="py-3 px-5 text-right">Productivity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => {
                const mins = idleMinutes(r);
                const tooLong = mins >= limitMinutes;
                return (
                  <tr key={r.employeeId} className={tooLong ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}>
                    <td className="py-3 px-5 font-semibold text-slate-800 dark:text-slate-200">{r.employeeName}</td>
                    <td className="py-3 px-5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          tooLong
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                            : r.activityState === 'IDLE'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        }`}
                      >
                        {r.activityState ? STATE_LABEL[r.activityState] || r.activityState : r.status.replace(/_/g, ' ').toLowerCase()}
                        {mins > 0 && ` · ${mins} min`}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-slate-600 dark:text-slate-300">{fmt(r.activeSeconds)}</td>
                    <td className="py-3 px-5 text-slate-600 dark:text-slate-300">{fmt(r.idleSeconds)}</td>
                    <td className="py-3 px-5 text-right font-bold text-indigo-600">{Math.round(r.productivityPercentage || 0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default TeamView;
