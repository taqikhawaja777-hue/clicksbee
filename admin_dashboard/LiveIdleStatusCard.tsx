import React from 'react';
import { Radio, PhoneCall, Moon, CircleOff, Activity, Users, Coffee, LogOut, UserX } from 'lucide-react';
import { useIdleTimeSummary } from './src/hooks/useIdleTimeSummary';
import { EmployeeIdleStatus, IdleStatus } from './src/services/productivityApi.service';
import { ProductivityBadge } from './ProductivityBadge';

const STATUS_META: Record<
  IdleStatus,
  { label: string; icon: React.ElementType; classes: string; dot: string }
> = {
  ACTIVE_JABBER: {
    label: 'Active in Jabber',
    icon: PhoneCall,
    classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/40',
    dot: 'bg-emerald-500',
  },
  ACTIVE_WILDIX: {
    label: 'Active in Wildix',
    icon: PhoneCall,
    classes: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/40',
    dot: 'bg-indigo-500',
  },
  ACTIVE: {
    label: 'Active',
    icon: Activity,
    classes: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/40',
    dot: 'bg-emerald-500',
  },
  IDLE: {
    label: 'Idle',
    icon: Moon,
    classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/40',
    dot: 'bg-amber-500',
  },
  AWAY: {
    label: 'Away',
    icon: CircleOff,
    classes: 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/40',
    dot: 'bg-slate-400',
  },
  ON_BREAK: {
    label: 'On Break',
    icon: Coffee,
    classes: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/40',
    dot: 'bg-purple-500',
  },
  CHECKED_OUT: {
    label: 'Checked Out',
    icon: LogOut,
    classes: 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/40',
    dot: 'bg-slate-400',
  },
  NOT_CHECKED_IN: {
    label: 'Not Checked In',
    icon: UserX,
    classes: 'bg-slate-500/15 text-slate-400 dark:text-slate-500 border-slate-500/40',
    dot: 'bg-slate-300',
  },
};

function formatMinutes(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
}

const EmployeeStatusTile: React.FC<{ employee: EmployeeIdleStatus }> = ({ employee }) => {
  const meta = STATUS_META[employee.status] || STATUS_META.AWAY;
  const StatusIcon = meta.icon;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
            {employee.employeeName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
          </div>
          <div className="min-w-0">
            <h4 className="font-extrabold text-xs text-slate-800 dark:text-white truncate">
              {employee.employeeName}
            </h4>
            <span
              className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.classes}`}
            >
              <StatusIcon className="w-2.5 h-2.5" />
              {meta.label}
            </span>
          </div>
        </div>
        <ProductivityBadge score={employee.productivityPercentage} />
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-slate-400 font-medium">Active</span>
          <p className="font-bold text-slate-700 dark:text-slate-200">{formatMinutes(employee.activeSeconds)}</p>
        </div>
        <div>
          <span className="text-slate-400 font-medium">Idle</span>
          <p className="font-bold text-slate-700 dark:text-slate-200">{formatMinutes(employee.idleSeconds)}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Replaces the old Socket.IO screen-recording live-feed grid on the Manager
 * Supervisor Portal overview: per-employee current status derived from
 * mouse/keyboard idle detection and active-window recognition (Cisco
 * Jabber / Wildix called out specifically), polled from the FastAPI
 * idle-time service rather than pushed over a socket.
 */
export const LiveIdleStatusCard: React.FC = () => {
  const { summary, loading } = useIdleTimeSummary();
  const employees = summary?.employees || [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
        <div>
          <div className="inline-flex items-center space-x-2 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1 rounded-full text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 border border-emerald-200/60 dark:border-emerald-800/60">
            <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-500" />
            <span className="uppercase tracking-wider">Live Idle/Active Status</span>
          </div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">Team Input Activity</h2>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Mouse/keyboard idle detection & active-window tracking (Cisco Jabber / Wildix flagged) — no screen
            recording or streaming involved.
          </p>
        </div>

        <div className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded-2xl text-xs font-bold text-indigo-600 dark:text-indigo-300 flex items-center space-x-2">
          <Users className="w-4 h-4 text-indigo-500" />
          <span>
            Avg Productivity: <strong>{summary ? `${Math.round(summary.avgProductivityPercentage)}%` : '--'}</strong>
          </span>
        </div>
      </div>

      {loading && employees.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-8">Loading team status…</p>
      ) : employees.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <Activity className="w-10 h-10 text-indigo-400 mx-auto" />
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            No idle/active data logged yet today. The desktop app reports status automatically once an employee is
            signed in.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((employee) => (
            <EmployeeStatusTile key={employee.employeeId} employee={employee} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LiveIdleStatusCard;
