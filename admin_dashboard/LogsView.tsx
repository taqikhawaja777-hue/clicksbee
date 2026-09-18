import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { apiService } from './src/services/api.service';

interface LogRow {
  id: string;
  userId: string;
  userName: string;
  action: string;
  description: string;
  timestamp: string;
}

interface EmployeeOption {
  id: string;
  name: string;
}

// Mirrors AuditLogsService's real, always-populated action vocabulary
// (backend/src/audit-logs/audit-logs.service.ts) - not a fixed enum on the
// Prisma side, just every action type that service can actually produce.
const ACTION_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'LOGIN', label: 'Logged In', color: 'bg-indigo-100/80 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300' },
  { value: 'CHECK_IN', label: 'Checked In', color: 'bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' },
  { value: 'CHECK_OUT', label: 'Checked Out', color: 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
  { value: 'BREAK_START', label: 'Break Started', color: 'bg-amber-100/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
  { value: 'BREAK_END', label: 'Break Ended', color: 'bg-amber-100/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
  { value: 'TASK_ASSIGNED', label: 'Task Assigned', color: 'bg-sky-100/80 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300' },
  { value: 'TASK_COMPLETED', label: 'Task Completed', color: 'bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' },
  { value: 'TASK_OVERDUE', label: 'Task Overdue', color: 'bg-rose-100/80 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300' },
  { value: 'SCREENSHOT_CAPTURED', label: 'Screenshot Captured', color: 'bg-violet-100/80 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300' },
  { value: 'IDLE_ALERT', label: 'Idle Alert', color: 'bg-orange-100/80 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
  { value: 'CAMERA_ANOMALY', label: 'Camera Anomaly', color: 'bg-rose-100/80 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300' },
  { value: 'WASHROOM_LIMIT', label: 'Washroom Limit', color: 'bg-rose-100/80 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300' },
  { value: 'LATE_BREAK_RETURN', label: 'Late Break Return', color: 'bg-rose-100/80 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300' },
  { value: 'MANUAL_MESSAGE', label: 'Message Received', color: 'bg-sky-100/80 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300' },
];

const actionMeta = (action: string) =>
  ACTION_OPTIONS.find((a) => a.value === action) || {
    value: action,
    label: action.replace(/_/g, ' '),
    color: 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  };

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const PAGE_SIZE = 50;

export const LogsView: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  // Left blank until the backend tells us which shift-day it resolved
  // "today" to (see below) - computing that client-side would use the
  // browser's own local midnight instead of the org's 19:00 Asia/Karachi
  // shift-day rollover, and could show the wrong day's log for part of
  // the evening.
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [resolvedDate, setResolvedDate] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [rows, setRows] = useState<LogRow[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res: any = await apiService.getEmployees();
        const list = res?.data?.data || [];
        setEmployees(list.map((e: any) => ({ id: e.id, name: e.name })));
      } catch (e) {
        console.warn('[LogsView] Failed to fetch employee list:', e);
      }
    })();
  }, []);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res: any = await apiService.getAuditLogs({
        date: selectedDate || undefined,
        userId: selectedEmployee || undefined,
        action: selectedAction || undefined,
        page,
        limit: PAGE_SIZE,
      });
      // Unlike getEmployees()/getNotifications() (which return {data, ...
      // other keys} and so get generically wrapped as one outer `data`),
      // AuditLogsService.getLogs() returns {data, pagination} - the
      // backend's TransformInterceptor special-cases that exact shape and
      // flattens both to the top level instead of nesting them, so `data`
      // here is already the rows array, not one more level in.
      setRows(res?.data || []);
      setTotalPages(res?.pagination?.totalPages || 1);
      setTotal(res?.pagination?.total || 0);
      if (res?.pagination?.date) setResolvedDate(res.pagination.date);
    } catch (e: any) {
      console.warn('[LogsView] Failed to fetch logs:', e);
      setError('Failed to load activity logs. Please try again.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate, selectedEmployee, selectedAction, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Any filter change starts back at page 1 - staying on e.g. page 3 of a
  // now much-shorter filtered result would just show an empty page.
  const handleDateChange = (v: string) => { setSelectedDate(v); setPage(1); };
  const handleEmployeeChange = (v: string) => { setSelectedEmployee(v); setPage(1); };
  const handleActionChange = (v: string) => { setSelectedAction(v); setPage(1); };

  const displayDate = selectedDate || resolvedDate;

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Activity Logs
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Every action taken during a shift-day - login, check-in/out, breaks, tasks, and alerts
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={isLoading}
          className="px-4 py-2 bg-[#534bf3] hover:bg-[#4338ca] disabled:opacity-60 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-indigo-500/20 transition-all active:scale-98 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Date</label>
          <input
            type="date"
            value={displayDate}
            max={resolvedDate || undefined}
            onChange={(e) => handleDateChange(e.target.value)}
            className="px-4 py-2 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Employee</label>
          <div className="relative">
            <select
              value={selectedEmployee}
              onChange={(e) => handleEmployeeChange(e.target.value)}
              className="appearance-none px-4 py-2 pr-8 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer min-w-[180px]"
            >
              <option value="">All Employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Action</label>
          <div className="relative">
            <select
              value={selectedAction}
              onChange={(e) => handleActionChange(e.target.value)}
              className="appearance-none px-4 py-2 pr-8 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer min-w-[160px]"
            >
              <option value="">All Actions</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {(selectedEmployee || selectedAction || selectedDate) && (
          <button
            onClick={() => { setSelectedEmployee(''); setSelectedAction(''); setSelectedDate(''); setPage(1); }}
            className="self-end px-3 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {displayDate
              ? new Date(`${displayDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
              : 'Today'}
          </h2>
          <span className="text-xs font-semibold text-slate-400">{total} action{total === 1 ? '' : 's'}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/70 dark:bg-slate-800/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-y border-slate-100 dark:border-slate-800">
                <th className="py-4 px-6">TIME</th>
                <th className="py-4 px-6">EMPLOYEE</th>
                <th className="py-4 px-6">ACTION</th>
                <th className="py-4 px-6">DETAILS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {rows.map((row) => {
                const meta = actionMeta(row.action);
                return (
                  <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-6 text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatTime(row.timestamp)}
                    </td>
                    <td className="py-4 px-6 font-bold text-slate-900 dark:text-white text-xs whitespace-nowrap">
                      {row.userName}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-block px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${meta.color}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600 dark:text-slate-300 font-medium">
                      {row.description}
                    </td>
                  </tr>
                );
              })}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 px-6 text-center text-sm text-slate-400 font-medium">
                    {error || 'No actions recorded for this selection.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-400">Page {page} of {totalPages}</span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-slate-100/80 dark:bg-slate-800 text-slate-500 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg bg-slate-100/80 dark:bg-slate-800 text-slate-500 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogsView;
