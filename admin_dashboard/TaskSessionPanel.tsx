import React, { useState } from 'react';
import { Play, Square, CheckCircle2, X } from 'lucide-react';
import { productivityApiService, Employee, Task, Ticket } from './src/services/productivityApi.service';
import { ProductivityBadge } from './ProductivityBadge';
import { useProductivity } from './src/hooks/useProductivity';

interface TaskSessionPanelProps {
  onTaskClosed?: () => void;
}

/**
 * Self-contained "start a task, watch live productivity, close it" panel.
 * This is where POST /api/tasks/{taskId}/close is wired up: closing shows
 * the returned ticket in a confirmation modal before handing control back
 * to the dashboard.
 */
export const TaskSessionPanel: React.FC<TaskSessionPanelProps> = ({ onTaskClosed }) => {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employeeName, setEmployeeName] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');

  const [task, setTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState('');

  const [isClosing, setIsClosing] = useState(false);
  const [closedTicket, setClosedTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { trackedMs, score, loading } = useProductivity(task?.id ?? null);

  const handleRegisterEmployee = async () => {
    if (!employeeName || !employeeEmail) return;
    try {
      setError(null);
      const created = await productivityApiService.registerEmployee(employeeName, employeeEmail);
      setEmployee(created);
    } catch (err: any) {
      setError(err.message || 'Failed to register employee');
    }
  };

  const handleStartTask = async () => {
    if (!employee || !taskTitle) return;
    try {
      setError(null);
      const created = await productivityApiService.createTask(employee.id, taskTitle);
      setTask(created);
    } catch (err: any) {
      setError(err.message || 'Failed to start task');
    }
  };

  const handleCloseTask = async () => {
    if (!task) return;
    try {
      setIsClosing(true);
      setError(null);
      const ticket = await productivityApiService.closeTask(task.id);
      setClosedTicket(ticket);
    } catch (err: any) {
      setError(err.message || 'Failed to close task');
    } finally {
      setIsClosing(false);
    }
  };

  const handleAcknowledgeTicket = () => {
    setClosedTicket(null);
    setTask(null);
    setTaskTitle('');
    onTaskClosed?.();
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6">
      <h3 className="text-xl font-bold text-slate-800 dark:text-white">Task Session</h3>
      <p className="text-xs text-slate-400 mt-0.5 mb-6">
        Register an employee, start a task, then close it to auto-generate a ticket.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
          {error}
        </div>
      )}

      {!employee ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
            placeholder="Employee full name"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:border-indigo-400"
          />
          <input
            value={employeeEmail}
            onChange={(e) => setEmployeeEmail(e.target.value)}
            placeholder="Employee email"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:border-indigo-400"
          />
          <button
            onClick={handleRegisterEmployee}
            disabled={!employeeName || !employeeEmail}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-all active:scale-95 cursor-pointer"
          >
            Register Employee
          </button>
        </div>
      ) : !task ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <span className="px-4 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-sm font-semibold">
            {employee.fullName}
          </span>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:border-indigo-400"
          />
          <button
            onClick={handleStartTask}
            disabled={!taskTitle}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-all active:scale-95 cursor-pointer flex items-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current stroke-none" />
            <span>Start Task</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-200">{task.title}</p>
            <p className="text-xs text-slate-400 mt-1">
              Tracked {(trackedMs / 60000).toFixed(1)}m (via Jibble)
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <ProductivityBadge score={score} loading={loading} />
            <button
              onClick={handleCloseTask}
              disabled={isClosing}
              className="px-5 py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-all active:scale-95 cursor-pointer flex items-center space-x-2"
            >
              <Square className="w-4 h-4 fill-current stroke-none" />
              <span>{isClosing ? 'Closing...' : 'Close Task'}</span>
            </button>
          </div>
        </div>
      )}

      {closedTicket && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
                <h4 className="font-bold text-lg text-slate-800 dark:text-white">Ticket Generated</h4>
              </div>
              <button onClick={handleAcknowledgeTicket} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Productivity Score</span>
                <ProductivityBadge score={closedTicket.productivityScore} />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tracked Time</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {(closedTicket.trackedMs / 60000).toFixed(1)} min
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Source</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                  {closedTicket.source}
                </span>
              </div>
            </div>

            <button
              onClick={handleAcknowledgeTicket}
              className="mt-6 w-full px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all active:scale-95 cursor-pointer"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskSessionPanel;
