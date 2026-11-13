import React, { useEffect, useRef, useState } from 'react';
import { ClipboardList, Inbox, CheckSquare, Calendar, Paperclip, Send, X, Reply, FileText } from 'lucide-react';
import { apiService, TaskSheetSummary } from './src/services/api.service';
import { useEmployee } from './EmployeeContext';
import { AttachmentPreviewModal, AttachmentRef, ACCEPTED_DOC_TYPES } from './AttachmentPreviewModal';
import { TaskDocuments, TaskReply } from './TaskDocuments';
import { TaskSheetChip, TaskSheetWorkspace } from './TaskSheetWorkspace';

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
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachments?: TaskReply[];
  sheets?: TaskSheetSummary[];
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
 * backend), including any document attached to the task, and lets the
 * employee reply with a note and/or a file of their own.
 */
export const MyTasksView: React.FC = () => {
  const { user } = useEmployee();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRef | null>(null);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);

  const [replyingTaskId, setReplyingTaskId] = useState<string | null>(null);
  const [replyNote, setReplyNote] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);

  const loadTasks = async (quiet = false) => {
    if (!quiet) setIsLoading(true);
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

  const handleComplete = async (task: TaskItem) => {
    const sheet = task.sheets?.[0];
    if (
      sheet &&
      sheet.status !== 'SUBMITTED' &&
      !window.confirm(`You haven't sent "${sheet.fileName}" to your manager yet. Mark this task complete anyway?`)
    ) {
      return;
    }
    const taskId = task.id;
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

  const resetReplyForm = () => {
    setReplyingTaskId(null);
    setReplyNote('');
    setReplyFile(null);
    setReplyError(null);
    if (replyFileInputRef.current) replyFileInputRef.current.value = '';
  };

  const openReplyForm = (taskId: string) => {
    if (replyingTaskId === taskId) {
      resetReplyForm();
      return;
    }
    setReplyingTaskId(taskId);
    setReplyNote('');
    setReplyFile(null);
    setReplyError(null);
    if (replyFileInputRef.current) replyFileInputRef.current.value = '';
  };

  const handleSendReply = async (taskId: string) => {
    if (!replyNote.trim() && !replyFile) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      let attachmentUrl: string | undefined;
      let attachmentName: string | undefined;
      if (replyFile) {
        const uploaded = await apiService.uploadTaskAttachment(replyFile);
        attachmentUrl = uploaded.url;
        attachmentName = uploaded.fileName;
      }
      await apiService.replyToTask(taskId, {
        note: replyNote.trim() || undefined,
        attachmentUrl,
        attachmentName,
      });
      resetReplyForm();
      await loadTasks();
    } catch (err: any) {
      console.warn('[MyTasksView] Failed to send reply:', err);
      setReplyError('Failed to send - please try again.');
    } finally {
      setSendingReply(false);
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
        <p className="text-xs text-slate-400 font-medium mt-0.5">
          Tasks your manager has assigned to you. Open any attached document here, and reply with a note or your own file.
        </p>
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
              const isReplying = replyingTaskId === task.id;
              return (
                <div key={task.id} className="p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
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
                      <TaskDocuments
                        task={task}
                        currentUserId={user.id}
                        briefLabel="Document from manager"
                        onOpen={setPreviewAttachment}
                      />
                      {task.sheets?.[0] && (
                        <TaskSheetChip
                          sheet={task.sheets[0]}
                          actionLabel={task.sheets[0].status === 'SUBMITTED' ? 'View spreadsheet' : 'Open & fill in'}
                          onOpen={() => setSheetTaskId(task.id)}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openReplyForm(task.id)}
                        className={`px-4 py-2 font-semibold text-xs rounded-xl transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5 ${
                          isReplying
                            ? 'bg-indigo-600 text-white'
                            : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/60'
                        }`}
                      >
                        <Reply className="w-3.5 h-3.5" />
                        <span>Reply / Send file</span>
                      </button>
                      <button
                        onClick={() => handleComplete(task)}
                        disabled={completingId === task.id}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>{completingId === task.id ? 'Completing...' : 'Mark Complete'}</span>
                      </button>
                    </div>
                  </div>

                  {isReplying && (
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700 space-y-3">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={replyNote}
                          onChange={(e) => setReplyNote(e.target.value)}
                          placeholder="Write a note for your manager…"
                          className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={() => handleSendReply(task.id)}
                          disabled={sendingReply || (!replyNote.trim() && !replyFile)}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all shrink-0"
                        >
                          <Send className="w-4 h-4" />
                          <span>{sendingReply ? 'Sending…' : 'Send'}</span>
                        </button>
                      </div>
                      <div className="flex items-center flex-wrap gap-2">
                        <input
                          ref={replyFileInputRef}
                          type="file"
                          accept={ACCEPTED_DOC_TYPES}
                          onChange={(e) => setReplyFile(e.target.files?.[0] || null)}
                          className="hidden"
                          id={`task-reply-file-${task.id}`}
                        />
                        <label
                          htmlFor={`task-reply-file-${task.id}`}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>Attach file</span>
                        </label>
                        {replyFile && (
                          <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-semibold">
                            <FileText className="w-3.5 h-3.5" />
                            <span className="max-w-[180px] truncate">{replyFile.name}</span>
                            <X
                              className="w-3.5 h-3.5 cursor-pointer"
                              onClick={() => {
                                setReplyFile(null);
                                if (replyFileInputRef.current) replyFileInputRef.current.value = '';
                              }}
                            />
                          </span>
                        )}
                        {replyError && <span className="text-xs text-rose-500 font-semibold">{replyError}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {closedTasks.map((task) => (
              <div key={task.id} className="p-6 flex items-start justify-between gap-4 opacity-60">
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-slate-600 dark:text-slate-400 line-through">{task.title}</h4>
                  <TaskDocuments
                    task={task}
                    currentUserId={user.id}
                    briefLabel="Document from manager"
                    onOpen={setPreviewAttachment}
                  />
                  {task.sheets?.[0] && (
                    <TaskSheetChip sheet={task.sheets[0]} actionLabel="View spreadsheet" onOpen={() => setSheetTaskId(task.id)} />
                  )}
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        allowDownload={false}
      />

      {sheetTaskId && (
        <TaskSheetWorkspace
          taskId={sheetTaskId}
          onClose={() => setSheetTaskId(null)}
          onChanged={() => loadTasks(true)}
        />
      )}
    </div>
  );
};

export default MyTasksView;
