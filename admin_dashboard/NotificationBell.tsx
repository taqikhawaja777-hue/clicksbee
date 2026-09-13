import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, ShieldAlert, CheckCircle2, Clock, Coffee, Camera, ClipboardList, MessageSquare, AlertTriangle } from 'lucide-react';
import { apiService } from './src/services/api.service';
import { socketService } from './src/services/socket.service';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
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
  IDLE_ALERT: 'text-amber-500',
  LATE_BREAK_RETURN: 'text-amber-500',
  WASHROOM_LIMIT: 'text-amber-500',
  CAMERA_ANOMALY: 'text-rose-500',
  COMPLIANCE_VIOLATION: 'text-rose-500',
  TASK_OVERDUE: 'text-rose-500',
  CHECK_IN: 'text-emerald-500',
  CHECK_OUT: 'text-emerald-500',
  TASK_COMPLETED: 'text-emerald-500',
  TASK_ASSIGNED: 'text-indigo-500',
  MANUAL_MESSAGE: 'text-indigo-500',
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
 * One shared bell/panel component for BOTH the Manager and Employee
 * Portals - which notifications it shows is decided entirely by the
 * backend's role-scoped query (an EMPLOYEE JWT only ever gets rows
 * addressed to that user; an ADMIN/MANAGER JWT only ever gets the org-wide
 * admin feed - see NotificationsService.scopedWhere() on the backend).
 * This component never filters by role itself; it just renders whatever
 * the API returns.
 */
export const NotificationBell: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(() => {
    apiService
      .getUnreadNotificationCount()
      .then((res) => setUnreadCount(res.count))
      .catch((e) => console.warn('[NotificationBell] Failed to fetch unread count:', e));
  }, []);

  const fetchNotifications = useCallback(() => {
    setLoading(true);
    apiService
      .getNotifications(1, 20)
      .then((res) => setNotifications(res.data))
      .catch((e) => console.warn('[NotificationBell] Failed to fetch notifications:', e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshUnreadCount();
    const pollTimer = setInterval(refreshUnreadCount, 30000);

    // Real-time: the server only ever emits this into a room the socket
    // was actually joined to based on its own verified JWT (see
    // MonitorGateway.handleConnection / emitNotification) - so receiving
    // this event at all already means it's meant for this user.
    const handleNew = (notification: NotificationItem) => {
      setUnreadCount((prev) => prev + 1);
      setNotifications((prev) => [notification, ...prev].slice(0, 20));
    };
    socketService.on('notification:new', handleNew);

    return () => {
      clearInterval(pollTimer);
      socketService.off('notification:new', handleNew);
    };
  }, [refreshUnreadCount]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    if (next) fetchNotifications();
  };

  const handleMarkAllRead = async () => {
    try {
      await apiService.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (e) {
      console.warn('[NotificationBell] Failed to mark all as read:', e);
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (item.isRead) return;
    try {
      await apiService.markNotificationRead(item.id);
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (e) {
      console.warn('[NotificationBell] Failed to mark notification as read:', e);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className={`p-2.5 rounded-full relative transition-colors ${
          isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div
          className={`absolute right-0 mt-3 w-80 rounded-2xl shadow-2xl border p-4 z-50 transition-all max-h-[28rem] overflow-y-auto ${
            isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-200/50 dark:border-slate-800">
            <h3 className="font-bold text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <span
                onClick={handleMarkAllRead}
                className="text-xs text-indigo-500 font-semibold cursor-pointer hover:underline"
              >
                Mark all as read
              </span>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {loading ? (
              <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No notifications yet.</p>
            ) : (
              notifications.map((item) => {
                const Icon = ICONS_BY_TYPE[item.type] || ShieldAlert;
                const color = COLOR_BY_TYPE[item.type] || 'text-indigo-500';
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`flex items-start space-x-3 p-2 rounded-xl cursor-pointer transition-colors ${
                      item.isRead
                        ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        : isDarkMode
                        ? 'bg-indigo-950/30 hover:bg-indigo-950/50'
                        : 'bg-indigo-50/50 hover:bg-indigo-50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold truncate">{item.title}</p>
                        {!item.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{item.message}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{timeAgo(item.createdAt)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
