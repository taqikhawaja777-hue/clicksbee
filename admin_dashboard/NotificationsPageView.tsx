import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Send, ShieldAlert, CheckCircle2, Clock, Coffee, Camera, ClipboardList, MessageSquare, AlertTriangle, Users, Paperclip, FileText, X } from 'lucide-react';
import { apiService } from './src/services/api.service';
import { useEmployee } from './EmployeeContext';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  sender?: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
}

interface EmployeeOption {
  id: string;
  name: string;
  designation?: string;
}

const ICONS_BY_TYPE: Record<string, React.ComponentType<{ className?: string }>> = {
  CHECK_IN: CheckCircle2,
  CHECK_OUT: CheckCircle2,
  IDLE_ALERT: Clock,
  LATE_BREAK_RETURN: Coffee,
  WASHROOM_LIMIT: Coffee,
  CAMERA_ANOMALY: Camera,
  COMPLIANCE_VIOLATION: AlertTriangle,
  TASK_ASSIGNED: ClipboardList,
  TASK_COMPLETED: ClipboardList,
  TASK_OVERDUE: AlertTriangle,
  MANUAL_MESSAGE: MessageSquare,
  ATTENDANCE_ALERT: ShieldAlert,
  SYSTEM_ALERT: ShieldAlert,
};

const COLOR_BY_TYPE: Record<string, string> = {
  IDLE_ALERT: 'text-amber-500 bg-amber-500/10',
  LATE_BREAK_RETURN: 'text-amber-500 bg-amber-500/10',
  WASHROOM_LIMIT: 'text-amber-500 bg-amber-500/10',
  CAMERA_ANOMALY: 'text-rose-500 bg-rose-500/10',
  COMPLIANCE_VIOLATION: 'text-rose-500 bg-rose-500/10',
  TASK_OVERDUE: 'text-rose-500 bg-rose-500/10',
  CHECK_IN: 'text-emerald-500 bg-emerald-500/10',
  CHECK_OUT: 'text-emerald-500 bg-emerald-500/10',
  TASK_COMPLETED: 'text-emerald-500 bg-emerald-500/10',
  TASK_ASSIGNED: 'text-indigo-500 bg-indigo-500/10',
  MANUAL_MESSAGE: 'text-indigo-500 bg-indigo-500/10',
};

// Mirrors backend NotificationsService.isManagementTier() exactly - this
// copy only drives which composer UI to show (which employees appear in
// the recipient dropdown, whether "All Employees" is offered). Real
// enforcement of who can actually message whom happens server-side in
// NotificationsController.sendNotification regardless of what this
// component renders - a floor-tier user tampering with the request body
// still gets a 403 from the backend.
const isManagementTier = (role: string, designation?: string): boolean => {
  if (designation === 'SM' || designation === 'HR') return true;
  if (designation === 'CSR' || designation === 'Team Lead' || designation === 'Employee') return false;
  return role === 'MANAGER';
};

const extractArray = (json: any): any[] => {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.data)) return json.data;
  return [];
};

const timeAgo = (iso: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

/**
 * Full-page Notifications view shared by every portal/tier - management
 * (ADMIN, MANAGER, or designation SM/HR) sees the org-wide admin feed and
 * can message anyone, including broadcasting to All Employees. Floor-tier
 * employees (designation CSR/Team Lead, or none) see only their own feed
 * and can message other floor-tier employees one at a time. Which rows
 * come back, and who's allowed to send to whom, is decided entirely by
 * the backend - see NotificationsService.scopedWhere() and
 * NotificationsController.sendNotification().
 */
export const NotificationsPageView: React.FC = () => {
  const { user } = useEmployee();
  const isManager = user.role === 'MANAGER';
  const senderIsManagement = isManagementTier(user.role, user.designation);
  // Plain "Employee" (or no designation at all) doesn't get the Send
  // Message composer - HR/CSR/SM/Team Lead, and the Manager Portal
  // itself, keep it exactly as before. This is a UI-only restriction;
  // the backend's tier permission check (isManagementTier) is unaffected
  // and unrelated to it.
  const showComposer = isManager || ['HR', 'CSR', 'SM', 'Team Lead'].includes(user.designation || '');

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [recipient, setRecipient] = useState<string>('');
  const [messageText, setMessageText] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchNotifications = useCallback(() => {
    setLoading(true);
    apiService
      .getNotifications(1, 50)
      .then((res) => setNotifications(res.data))
      .catch((e) => console.warn('[NotificationsPageView] Failed to fetch notifications:', e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Everyone in the org, not just role=EMPLOYEE accounts - CSR/HR/SM sign
  // up via the Manager tab (backend role ADMIN) and would never appear in
  // the regular /employees list, which hardcodes role=EMPLOYEE. Filtering
  // to "who's actually messageable for ME" happens below in
  // messageableEmployees, once designations are in hand.
  useEffect(() => {
    apiService
      .getMessageableUsers()
      .then((json: any) => {
        const list = extractArray(json).map((e: any) => ({
          id: e.id,
          name: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email,
          designation: e.designation || undefined,
        }));
        setEmployees(list);
      })
      .catch((e) => console.warn('[NotificationsPageView] Failed to fetch messageable users:', e));
  }, [user.id]);

  // Management tier can message anyone. Floor tier can only message other
  // floor-tier employees - this is a UX filter only, the real gate is the
  // backend's 403 on a disallowed recipientUserId regardless of this list.
  const messageableEmployees = senderIsManagement
    ? employees
    : employees.filter((e) => !isManagementTier('EMPLOYEE', e.designation));

  const handleMarkAllRead = async () => {
    try {
      await apiService.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (e) {
      console.warn('[NotificationsPageView] Failed to mark all as read:', e);
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (item.isRead) return;
    try {
      await apiService.markNotificationRead(item.id);
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
    } catch (e) {
      console.warn('[NotificationsPageView] Failed to mark notification as read:', e);
    }
  };

  const handleSend = async () => {
    if (!messageText.trim() || !recipient) return;
    setSending(true);
    setSendResult('idle');
    setSendError(null);
    try {
      let attachmentUrl: string | undefined;
      let attachmentName: string | undefined;
      if (attachedFile) {
        const uploaded = await apiService.uploadNotificationAttachment(attachedFile);
        attachmentUrl = uploaded.url;
        attachmentName = uploaded.fileName;
      }

      await apiService.sendNotification({
        ...(recipient === 'ALL' ? { allEmployees: true } : { recipientUserId: recipient }),
        message: messageText.trim(),
        attachmentUrl,
        attachmentName,
      });
      setMessageText('');
      setAttachedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSendResult('success');
      fetchNotifications();
    } catch (e: any) {
      console.warn('[NotificationsPageView] Failed to send notification:', e);
      setSendResult('error');
      setSendError(e?.message?.includes('403') || e?.message?.includes('Forbidden')
        ? "You don't have permission to message that recipient."
        : 'Failed to send - please try again.');
    } finally {
      setSending(false);
      setTimeout(() => setSendResult('idle'), 5000);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto font-sans select-none">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">
            <Bell className="w-3.5 h-3.5" />
            <span>{isManager ? 'Organization-wide Alerts' : 'Your Notifications & Messages'}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Notifications</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            {isManager
              ? 'Real-time alerts about every employee — check-ins, idle time, break compliance, and task activity.'
              : senderIsManagement
              ? 'Messages and confirmations about your own activity. As SM/HR, you can also message anyone in the organization.'
              : showComposer
              ? 'Messages from your manager, confirmations about your own activity, and messages from other CSR/Team Lead colleagues.'
              : 'Messages from your manager and confirmations about your own activity.'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-950/60 transition-colors shrink-0"
          >
            Mark all as read ({unreadCount})
          </button>
        )}
      </div>

      {showComposer && (
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-4">
        <div className="flex items-center space-x-2">
          <Send className="w-4 h-4 text-indigo-500" />
          <h3 className="font-bold text-sm text-slate-800 dark:text-white">Send Message</h3>
        </div>
        <p className="text-[11px] text-slate-400 -mt-2">
          {senderIsManagement
            ? 'Message any employee, or broadcast to everyone.'
            : 'Message another CSR or Team Lead colleague.'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative sm:w-56 shrink-0">
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full appearance-none pl-9 pr-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Select recipient…</option>
              {senderIsManagement && <option value="ALL">All Employees</option>}
              {messageableEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                  {emp.designation ? ` (${emp.designation})` : ''}
                </option>
              ))}
            </select>
            <Users className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Write a message…"
            className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!messageText.trim() || !recipient || sending}
            className="px-6 py-2.5 bg-[#534bf3] text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-2 shadow-md hover:bg-indigo-700 transition-all disabled:opacity-50 shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>{sending ? 'Sending…' : 'Send'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setAttachedFile(e.target.files?.[0] || null)}
            className="hidden"
            id="notification-attachment-input"
          />
          <label
            htmlFor="notification-attachment-input"
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Paperclip className="w-3.5 h-3.5" />
            <span>Attach PDF report</span>
          </label>
          {attachedFile && (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-semibold">
              <FileText className="w-3.5 h-3.5" />
              <span className="max-w-[160px] truncate">{attachedFile.name}</span>
              <X className="w-3.5 h-3.5 cursor-pointer" onClick={() => {
                setAttachedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }} />
            </span>
          )}
        </div>

        {sendResult === 'success' && <p className="text-xs text-emerald-500 font-semibold">Sent!</p>}
        {sendResult === 'error' && <p className="text-xs text-rose-500 font-semibold">{sendError}</p>}
      </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? (
          <p className="text-xs text-slate-400 text-center py-10">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-10">No notifications yet.</p>
        ) : (
          notifications.map((item) => {
            const Icon = ICONS_BY_TYPE[item.type] || ShieldAlert;
            const colorClasses = COLOR_BY_TYPE[item.type] || 'text-indigo-500 bg-indigo-500/10';
            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`flex items-start space-x-4 p-5 cursor-pointer transition-colors ${
                  item.isRead ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40' : 'bg-indigo-50/30 dark:bg-indigo-950/20'
                }`}
              >
                <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${colorClasses}`}>
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-white">{item.title}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400">{timeAgo(item.createdAt)}</span>
                      {!item.isRead && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.message}</p>
                  {item.attachmentUrl && (
                    <a
                      href={`http://localhost:3000${item.attachmentUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center space-x-1.5 mt-2 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{item.attachmentName || 'Attachment'}</span>
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default NotificationsPageView;
