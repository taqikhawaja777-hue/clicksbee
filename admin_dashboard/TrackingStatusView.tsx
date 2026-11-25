import React, { useEffect, useState } from 'react';
import { ShieldCheck, Activity, Moon, Info } from 'lucide-react';
import { apiService } from './src/services/api.service';
import { useEmployee } from './EmployeeContext';

const fmt = (seconds = 0) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

/**
 * Home page for auto-tracked roles (Back Office, Validator, Closer, Team
 * Lead): tracking is automatic - no check-in - and this says so plainly,
 * along with what is (and is not) recorded.
 */
export const TrackingStatusView: React.FC = () => {
  const { user } = useEmployee();
  const [today, setToday] = useState<{ activeSeconds?: number; idleSeconds?: number } | null>(null);

  useEffect(() => {
    if (!user.id) return;
    const load = () =>
      apiService
        .get(`/tracking/shift-summary/${user.id}`)
        .then((res: any) => setToday(res?.data ?? res))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [user.id]);

  return (
    <div className="w-full max-w-3xl space-y-6 font-sans">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
            <ShieldCheck className="w-7 h-7 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-800 dark:text-white">Activity tracking is on</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {user.categoryLabel || 'Your account'} · tracked automatically from Windows sign-in, all day. No check-in needed.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>Active today (shift)</span>
              <Activity className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-slate-800 dark:text-white mt-2">{fmt(today?.activeSeconds)}</div>
          </div>
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>Idle today (shift)</span>
              <Moon className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-black text-slate-800 dark:text-white mt-2">{fmt(today?.idleSeconds)}</div>
          </div>
        </div>

        <div className="mt-6 p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 text-xs text-indigo-800 dark:text-indigo-300 flex gap-3">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              <span className="font-bold">Recorded:</span> which apps and windows you use (e.g. an Excel file name, WhatsApp, a browser
              tab title), when and for how long, and idle vs active time. Works at home or in the office; saved on this PC while offline
              and sent when the internet is back.
            </p>
            <p>
              <span className="font-bold">Never recorded:</span> what you type, passwords, or the content of messages.
            </p>
            <p>Closing the window keeps WorkTrackPro running in the system tray.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackingStatusView;
