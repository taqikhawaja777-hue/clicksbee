import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface MonitoringBannerProps {
  isMonitoringActive: boolean;
}

export const MonitoringBanner: React.FC<MonitoringBannerProps> = ({ isMonitoringActive }) => {
  return (
    <div className={`w-full p-4 rounded-3xl border transition-all flex flex-col md:flex-row items-center justify-between gap-4 select-none font-sans ${
      isMonitoringActive
        ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-200/80 dark:border-indigo-900/50 text-indigo-900 dark:text-indigo-200'
        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
    }`}>

      {/* Status Information (no pause/resume control - monitoring runs for
          the whole shift with no employee-facing way to interrupt it) */}
      <div className="flex items-center space-x-3.5">
        <div className={`p-2.5 rounded-2xl ${
          isMonitoringActive ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-400 text-white'
        }`}>
          <ShieldCheck className="w-5 h-5" />
        </div>

        <div>
          <div className="flex items-center space-x-2">
            <span className="font-extrabold text-sm tracking-tight">
              {isMonitoringActive ? 'Active Shift Monitoring Enabled' : 'Monitoring Stopped'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              isMonitoringActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700'
            }`}>
              {isMonitoringActive ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isMonitoringActive
              ? 'Automated screenshots & app activity logged securely during shift.'
              : 'Check in to start shift monitoring.'}
          </p>
        </div>
      </div>

    </div>
  );
};
