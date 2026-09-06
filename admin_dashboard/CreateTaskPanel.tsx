import React, { useEffect, useState } from 'react';
import { ClipboardList, Mail, CheckCircle2, AlertCircle, Inbox } from 'lucide-react';
import { apiService } from './src/services/api.service';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: Priority;
  estimatedMinutes?: number;
  dueDate?: string | null;
  createdAt: string;
  assignee?: { firstName: string; lastName: string; avatar?: string | null } | null;
}

const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const priorityBadgeClasses: Record<Priority, string> = {
  LOW: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  MEDIUM: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400',
  HIGH: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400',
  URGENT: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400',
};

/**
 * Manager Portal — "Create a Task" panel. Styled to match the app's own
 * card/section layout (white rounded-3xl cards, indigo accents) rather than
 * a third-party look. Assigns by employee email (resolved to a user id
 * server-side) so a manager never needs to know internal IDs.
 */
export const CreateTaskPanel: React.FC = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToEmail, setAssignedToEmail] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);

  const loadTasks = async () => {
    setIsLoadingTasks(true);
    try {
      const result: any = await apiService.getTasks();
      const list = Array.isArray(result) ? result : result?.data || [];
      setTasks(list);
    } catch (err) {
      console.warn('[CreateTaskPanel] Failed to load tasks:', err);
    } finally {
      setIsLoadingTasks(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!title.trim() || !assignedToEmail.trim()) return;

    setIsSubmitting(true);
    try {
      await apiService.createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedToEmail: assignedToEmail.trim().toLowerCase(),
        priority,
        dueDate: dueDate || undefined,
        estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : undefined,
      });

      setSuccessMsg(`Task assigned to ${assignedToEmail.trim()}.`);
      setTitle('');
      setDescription('');
      setAssignedToEmail('');
      setPriority('MEDIUM');
      setDueDate('');
      setEstimatedMinutes('');
      await loadTasks();
    } catch (err: any) {
      setError(err?.message || 'Failed to create task. Check the email is a registered employee.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-4xl space-y-6 font-sans">
      {/* Header */}
      <div>
        <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
          <ClipboardList className="w-3.5 h-3.5" />
          <span>Task Assignment</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Create a Task</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">
          Assign work directly to an employee by email — it shows up on their dashboard immediately.
        </p>
      </div>

      {/* Form Card */}
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-8 space-y-6"
      >
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Task Details</h3>

        {error && (
          <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl flex items-start space-x-2.5 text-xs text-rose-800 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl flex items-start space-x-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
            Task Name
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Prepare Q3 client report"
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details for the employee"
            rows={3}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
            Assign To (Employee Email)
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              required
              value={assignedToEmail}
              onChange={(e) => setAssignedToEmail(e.target.value)}
              placeholder="employee@stitchmonitor.com"
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              Estimated Minutes
            </label>
            <input
              type="number"
              min={0}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              placeholder="Auto-estimated if blank"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !title.trim() || !assignedToEmail.trim()}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-2xl shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-95 cursor-pointer"
          >
            {isSubmitting ? 'Assigning...' : 'Create & Assign Task'}
          </button>
        </div>
      </form>

      {/* Recently Assigned Tasks */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white">Assigned Tasks</h3>
        </div>

        {isLoadingTasks ? (
          <div className="p-12 text-center text-slate-400">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center">
            <Inbox className="w-10 h-10 mb-2 opacity-40 text-slate-400" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">No tasks created yet</p>
            <p className="text-xs mt-1 text-slate-400">Assign your first task using the form above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                  <th className="py-4 px-6">TASK</th>
                  <th className="py-4 px-6">ASSIGNED TO</th>
                  <th className="py-4 px-6">PRIORITY</th>
                  <th className="py-4 px-6">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-6 text-slate-800 dark:text-slate-200 font-semibold">{task.title}</td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">
                      {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : '—'}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${priorityBadgeClasses[task.priority]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{task.status.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreateTaskPanel;
