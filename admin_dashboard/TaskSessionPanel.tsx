import React, { useEffect, useState } from 'react';
import { Play, Square, CheckCircle2, X, Users } from 'lucide-react';
import { apiService } from './src/services/api.service';
import { useEmployee } from './EmployeeContext';

interface TaskSessionPanelProps {
  onTaskClosed?: () => void;
}

interface MemberOption {
  id: string;
  name: string;
  designation?: string;
}

interface SessionTask {
  id: string;
  title: string;
  estimatedMinutes: number;
  startedAt?: string | null;
}

interface Ticket {
  ticketNumber: string | null;
  title: string;
  estimatedMinutes: number;
  actualMinutes: number;
  onTime: boolean | null;
}

const extractArray = (json: any): any[] => {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.data)) return json.data;
  return [];
};

const unwrap = (json: any) => (json && typeof json === 'object' && 'data' in json ? json.data : json);

/**
 * "Pick a team member, start a task, complete it to generate a ticket" -
 * all against the NestJS task API. Completing stamps actualMinutes (from
 * startedAt) and a ticket number, which is what the task-based score reads.
 */
export const TaskSessionPanel: React.FC<TaskSessionPanelProps> = ({ onTaskClosed }) => {
  const { user } = useEmployee();
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [memberId, setMemberId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [estimated, setEstimated] = useState('');

  const [task, setTask] = useState<SessionTask | null>(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiService
      .getMessageableUsers()
      .then((json) => {
        const list = extractArray(json).map((u: any) => ({
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
          designation: u.designation || undefined,
        }));
        const self = user.id ? [{ id: user.id, name: `${user.name} (me)`, designation: user.designation }] : [];
        setMembers([...self, ...list]);
      })
      .catch((e) => console.warn('[TaskSessionPanel] Failed to load members:', e));
  }, [user.id, user.name, user.designation]);

  useEffect(() => {
    if (!task?.startedAt) return;
    const tick = () => setElapsedMinutes(Math.max(0, (Date.now() - new Date(task.startedAt!).getTime()) / 60000));
    tick();
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, [task?.startedAt]);

  const handleStart = async () => {
    if (!memberId || !taskTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created: any = unwrap(
        await apiService.createTask({
          title: taskTitle.trim(),
          assignedTo: memberId,
          estimatedMinutes: estimated ? Number(estimated) : undefined,
        }),
      );
      const started: any = unwrap(await apiService.startTask(created.id));
      setTask({ id: created.id, title: created.title, estimatedMinutes: created.estimatedMinutes, startedAt: started.startedAt });
    } catch (err: any) {
      setError(err?.message || 'Failed to start task');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      const done: any = unwrap(await apiService.completeTask(task.id));
      setTicket({
        ticketNumber: done.ticketNumber,
        title: done.title,
        estimatedMinutes: done.estimatedMinutes,
        actualMinutes: done.actualMinutes,
        onTime: done.onTime ?? null,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to complete task');
    } finally {
      setBusy(false);
    }
  };

  const handleAcknowledge = () => {
    setTicket(null);
    setTask(null);
    setTaskTitle('');
    setEstimated('');
    onTaskClosed?.();
  };

  const inputClasses =
    'px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-400';

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6">
      <h3 className="text-xl font-bold text-slate-800 dark:text-white">Task Session</h3>
      <p className="text-xs text-slate-400 mt-0.5 mb-6">
        Pick a team member, start a task, then complete it to generate a ticket. Tracked time runs from Start to Complete.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
          {error}
        </div>
      )}

      {!task ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative sm:w-64 shrink-0">
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={`w-full appearance-none pl-9 ${inputClasses}`}>
              <option value="">Select team member…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.designation ? ` (${m.designation})` : ''}
                </option>
              ))}
            </select>
            <Users className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task title" className={`flex-1 ${inputClasses}`} />
          <input
            type="number"
            min={0}
            value={estimated}
            onChange={(e) => setEstimated(e.target.value)}
            placeholder="Est. minutes"
            className={`sm:w-32 ${inputClasses}`}
          />
          <button
            onClick={handleStart}
            disabled={busy || !memberId || !taskTitle.trim()}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-all active:scale-95 cursor-pointer flex items-center justify-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current stroke-none" />
            <span>{busy ? 'Starting…' : 'Start Task'}</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-200">{task.title}</p>
            <p className="text-xs text-slate-400 mt-1">
              Running {elapsedMinutes.toFixed(1)}m · estimated {task.estimatedMinutes}m
            </p>
          </div>
          <button
            onClick={handleComplete}
            disabled={busy}
            className="px-5 py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-all active:scale-95 cursor-pointer flex items-center space-x-2"
          >
            <Square className="w-4 h-4 fill-current stroke-none" />
            <span>{busy ? 'Completing…' : 'Complete Task'}</span>
          </button>
        </div>
      )}

      {ticket && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
                <h4 className="font-bold text-lg text-slate-800 dark:text-white">Ticket Generated</h4>
              </div>
              <button onClick={handleAcknowledge} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Ticket</span>
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{ticket.ticketNumber || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Task</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[60%]">{ticket.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tracked / Estimated</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {ticket.actualMinutes} min / {ticket.estimatedMinutes} min
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Due date</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {ticket.onTime === null ? 'None set' : ticket.onTime ? 'Met' : 'Missed'}
                </span>
              </div>
            </div>

            <button
              onClick={handleAcknowledge}
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
