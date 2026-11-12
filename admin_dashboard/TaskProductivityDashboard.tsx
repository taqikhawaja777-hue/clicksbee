import React, { useCallback, useEffect, useState } from 'react';
import { Users, TrendingUp, Ticket as TicketIcon, ArrowLeft, CalendarRange } from 'lucide-react';
import { apiService, TeamProductivityMember, TeamProductivityResponse } from './src/services/api.service';
import { ProductivityBadge } from './ProductivityBadge';
import { TicketHistory } from './TicketHistory';
import { TaskSessionPanel } from './TaskSessionPanel';
import { getShiftDayKey } from './src/utils/shiftDay';

const POLL_INTERVAL_MS = 15000;

type RangeKey = 'today' | 'week' | 'month';

const shiftDayFromDate = (d: Date) => getShiftDayKey(d);

const rangeFor = (key: RangeKey): { from: string; to: string } => {
  const to = getShiftDayKey();
  const now = new Date();
  if (key === 'today') return { from: to, to };
  const start = new Date(now);
  if (key === 'week') {
    const day = (start.getDay() + 6) % 7; // Monday = 0
    start.setDate(start.getDate() - day);
  } else {
    start.setDate(1);
  }
  return { from: shiftDayFromDate(start), to };
};

/**
 * Task-based productivity for the non-employee team (manager, HR, SM, team
 * lead, CSR): summary cards, a per-member table, a ticket history per
 * member and the start/complete task session panel. Every number comes
 * from the NestJS /tasks/productivity endpoint over the MongoDB Task
 * collection - employees' dialer/idle score lives on the Productivity page.
 */
export const TaskProductivityDashboard: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('today');
  const [data, setData] = useState<TeamProductivityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamProductivityMember | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { from, to } = rangeFor(range);
      const res = await apiService.getTaskProductivity(from, to);
      const next = (res as any)?.data ?? res;
      setData(next);
      setSelected((prev) => (prev ? next.members.find((m: TeamProductivityMember) => m.userId === prev.userId) || prev : prev));
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load team productivity');
    } finally {
      setIsLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const summary = data?.summary || { avgScore: 0, activeMemberCount: 0, memberCount: 0, ticketsGeneratedToday: 0 };
  const weights = data?.config.weights || { onTime: 40, throughput: 30, accuracy: 20, overdue: 10 };

  if (selected) {
    return (
      <div className="space-y-6 font-sans">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center space-x-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">{selected.name}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {selected.designation || selected.role} · {data?.from === data?.to ? data?.from : `${data?.from} → ${data?.to}`}
              </p>
            </div>
            <ProductivityBadge score={selected.score} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-sm">
            {[
              { label: `On-time rate (${weights.onTime}%)`, value: `${selected.onTimeRate}%`, hint: `${selected.completedOnTime}/${selected.completedWithDueDate} with a due date` },
              { label: `Throughput (${weights.throughput}%)`, value: `${selected.throughputScore}%`, hint: `${selected.teamCompleted + selected.ownCompleted} completed vs daily target` },
              { label: `Estimate accuracy (${weights.accuracy}%)`, value: `${selected.accuracyScore}%`, hint: 'tracked vs estimated minutes' },
              { label: `Overdue hygiene (${weights.overdue}%)`, value: `${selected.overdueScore}%`, hint: `${selected.overdueOpen} open past due` },
            ].map((c) => (
              <div key={c.label} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold text-slate-400">{c.label}</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{c.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{c.hint}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs text-slate-500 dark:text-slate-400">
            <span>Created: <b>{selected.tasksCreated}</b></span>
            <span>Team completed: <b>{selected.teamCompleted}</b></span>
            <span>Own completed: <b>{selected.ownCompleted}</b></span>
            <span>Open: <b>{selected.openTasks}</b></span>
            <span>In progress: <b>{selected.inProgress.length}</b></span>
          </div>
        </div>
        <TicketHistory userId={selected.userId} />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Avg Productivity</span>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-4">{summary.avgScore}%</h3>
          <p className="text-[11px] text-slate-400 mt-1">
            {weights.onTime}% on-time + {weights.throughput}% throughput + {weights.accuracy}% accuracy + {weights.overdue}% overdue
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Active Team Members</span>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-emerald-600 mt-4">
            {summary.activeMemberCount}
            <span className="text-base text-slate-400 font-semibold"> / {summary.memberCount}</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-1">with task activity in this period</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Tickets Generated Today</span>
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950/50 rounded-2xl text-purple-600">
              <TicketIcon className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-purple-600 mt-4">{summary.ticketsGeneratedToday}</h3>
          <p className="text-[11px] text-slate-400 mt-1">one ticket per completed task</p>
        </div>
      </div>

      {/* Team Table */}
      <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Team Productivity</h3>
            <p className="text-xs text-slate-400 mt-0.5">Managers, HR, SM, team leads and CSRs - click a row to view that member's ticket history</p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
            <CalendarRange className="w-3.5 h-3.5 text-slate-400 ml-2" />
            {(['today', 'week', 'month'] as RangeKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  range === key ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500'
                }`}
              >
                {key === 'today' ? 'Today' : key === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        </div>

        {isLoading && !data ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : !data || data.members.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800">
            No manager, HR, SM, team-lead or CSR accounts found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">MEMBER</th>
                  <th className="py-4 px-6">CURRENT TASK</th>
                  <th className="py-4 px-6">CREATED</th>
                  <th className="py-4 px-6">COMPLETED</th>
                  <th className="py-4 px-6">ON TIME</th>
                  <th className="py-4 px-6">OVERDUE</th>
                  <th className="py-4 px-6">SCORE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
                {data.members.map((m) => (
                  <tr
                    key={m.userId}
                    onClick={() => setSelected(m)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <td className="py-4 px-6">
                      <div className="text-slate-800 dark:text-slate-200 font-semibold">{m.name}</div>
                      <div className="text-[11px] text-slate-400">{m.designation || m.role}</div>
                    </td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">
                      {m.inProgress.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <>
                          <div className="truncate max-w-[260px]">{m.inProgress[0].title}</div>
                          {m.inProgress.length > 1 && <div className="text-[11px] text-slate-400">+{m.inProgress.length - 1} more</div>}
                        </>
                      )}
                    </td>
                    <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">{m.tasksCreated}</td>
                    <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">
                      {m.teamCompleted + m.ownCompleted}
                      {m.ownCompleted > 0 && <span className="text-[11px] text-slate-400 font-medium"> ({m.ownCompleted} own)</span>}
                    </td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">
                      {m.completedWithDueDate > 0 ? `${m.completedOnTime}/${m.completedWithDueDate}` : '—'}
                    </td>
                    <td className={`py-4 px-6 font-bold ${m.overdueOpen > 0 ? 'text-rose-500' : 'text-slate-400'}`}>{m.overdueOpen}</td>
                    <td className="py-4 px-6">
                      {m.hasActivity ? (
                        <ProductivityBadge score={m.score} />
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-400">
                          No activity
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TaskSessionPanel onTaskClosed={refresh} />
    </div>
  );
};

export default TaskProductivityDashboard;
