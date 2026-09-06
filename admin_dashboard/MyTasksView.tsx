import React, { useEffect, useState } from 'react';
import { ClipboardList, Inbox, CheckSquare, Calendar } from 'lucide-react';
import { apiService } from './src/services/api.service';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: Priority;
  dueDate?: string | null;
  createdAt: string;
  assigner?: { firstName: string; lastName: string } | null;
}

const priorityBadgeClasses: Record<Priority, string> = {
  LOW: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  MEDIUM: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400',
  HIGH: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400',
  URGENT: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400',
};

const formatDueDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
};

/**
 * Employee Dashboard — "My Tasks". Shows whatever a manager has assigned to
 * the logged-in employee (GET /tasks is scoped to their own tasks by the
 * backend). Empty state covers the case nothing has been assigned yet.
 */
export const MyTasksView: React.FC = () => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const loadTasks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result: any = await apiService.getTasks();
      const list = Array.isArray(result) ? result : result?.data || [];
      setTasks(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your tasks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId);
    try {
      await apiService.completeTask(taskId);
      await loadTasks();
    } catch (err) {
      console.warn('[MyTasksView] Failed to complete task:', err);
    } finally {
      setCompletingId(null);
    }
  };

  const openTasks = tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
  const closedTasks = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'CANCELLED');

  return (
    <div className="w-full max-w-4xl space-y-6 font-sans">
      <div>
        <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
          <ClipboardList className="w-3.5 h-3.5" />
          <span>Assigned Work</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">My Tasks</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">Tasks your manager has assigned to you.</p>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-sm font-medium">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Loading your tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 flex flex-col items-center justify-center">
            <Inbox className="w-10 h-10 mb-2 opacity-40 text-slate-400" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">No tasks assigned to you yet</p>
            <p className="text-xs mt-1 text-slate-400">When your manager assigns you a task, it'll show up here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {openTasks.map((task) => {
              const due = formatDueDate(task.dueDate);
              return (
                <div key={task.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <h4 className="font-semibold text-slate-800 dark:text-slate-200">{task.title}</h4>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${priorityBadgeClasses[task.priority]}`}>
                        {task.priority}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{task.description}</p>
                    )}
                    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-slate-400">
                      {task.assigner && (
                        <span>Assigned by {task.assigner.firstName} {task.assigner.lastName}</span>
                      )}
                      {due && (
                        <span className="inline-flex items-center space-x-1">
                          <Calendar className="w-3 h-3" />
                          <span>Due {due}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleComplete(task.id)}
                    disabled={completingId === task.id}
                    className="shrink-0 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>{completingId === task.id ? 'Completing...' : 'Mark Complete'}</span>
                  </button>
                </div>
              );
            })}

            {closedTasks.map((task) => (
              <div key={task.id} className="p-6 flex items-center justify-between gap-4 opacity-60">
                <div className="min-w-0">
                  <h4 className="font-semibold text-slate-600 dark:text-slate-400 line-through">{task.title}</h4>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyTasksView;
