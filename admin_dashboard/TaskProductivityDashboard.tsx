import React, { useCallback, useEffect, useState } from 'react';
import { Users, TrendingUp, Ticket as TicketIcon, ArrowLeft } from 'lucide-react';
import {
  productivityApiService,
  ActiveEmployee,
  DashboardSummary,
} from './src/services/productivityApi.service';
import { ProductivityBadge } from './ProductivityBadge';
import { TicketHistory } from './TicketHistory';
import { TaskSessionPanel } from './TaskSessionPanel';

const POLL_INTERVAL_MS = 15000;

/**
 * Per-task productivity tracking dashboard: summary cards, a live table of
 * who's working on what right now, and a task-session panel that generates
 * a ticket when a task is closed. Named distinctly from dashboard.tsx's
 * `EmployeeDashboard` export (the full app shell) to avoid a collision.
 */
export const TaskProductivityDashboard: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary>({
    avgProductivity: 0,
    activeEmployeeCount: 0,
    ticketsGeneratedToday: 0,
  });
  const [activeEmployees, setActiveEmployees] = useState<ActiveEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<ActiveEmployee | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [summaryData, employeesData] = await Promise.all([
        productivityApiService.getDashboardSummary(),
        productivityApiService.getActiveEmployees(),
      ]);
      setSummary(summaryData);
      setActiveEmployees(employeesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load productivity dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  if (selectedEmployee) {
    return (
      <div className="space-y-6 font-sans">
        <button
          onClick={() => setSelectedEmployee(null)}
          className="inline-flex items-center space-x-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">{selectedEmployee.employeeName}</h2>
          <p className="text-xs text-slate-400 mt-0.5">Currently working on: {selectedEmployee.taskTitle}</p>
        </div>
        <TicketHistory employeeId={selectedEmployee.employeeId} />
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
          <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-4">{summary.avgProductivity}%</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Active Employees</span>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-emerald-600 mt-4">{summary.activeEmployeeCount}</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Tickets Generated Today</span>
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950/50 rounded-2xl text-purple-600">
              <TicketIcon className="w-5 h-5" />
            </div>
          </div>
          <h3 className="text-3xl font-black text-purple-600 mt-4">{summary.ticketsGeneratedToday}</h3>
        </div>
      </div>

      {/* Employee Table */}
      <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white">Currently Working</h3>
          <p className="text-xs text-slate-400 mt-0.5">Click a row to view that employee's ticket history</p>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : activeEmployees.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800">
            No employees currently working on a task.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">EMPLOYEE</th>
                  <th className="py-4 px-6">CURRENT TASK</th>
                  <th className="py-4 px-6">TRACKED TODAY</th>
                  <th className="py-4 px-6">SCORE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
                {activeEmployees.map((emp) => (
                  <tr
                    key={emp.taskId}
                    onClick={() => setSelectedEmployee(emp)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <td className="py-4 px-6 text-slate-800 dark:text-slate-200 font-semibold">{emp.employeeName}</td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{emp.taskTitle}</td>
                    <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">
                      {emp.trackedMinutes.toFixed(1)}m
                    </td>
                    <td className="py-4 px-6">
                      <ProductivityBadge score={emp.score} />
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
