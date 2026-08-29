import React, { useState, useEffect } from 'react';
import { ShieldCheck, PauseCircle, PlayCircle, Clock, AlertCircle } from 'lucide-react';

interface MonitoringBannerProps {
  isMonitoringActive: boolean;
  isPaused: boolean;
  pausedSeconds: number;
  maxPauseSeconds?: number; // default 900 (15 mins)
  onResumeMonitoring: () => void;
  onPauseMonitoring: () => void;
}

export const MonitoringBanner: React.FC<MonitoringBannerProps> = ({
  isMonitoringActive,
  isPaused,
  pausedSeconds,
  maxPauseSeconds = 900,
  onResumeMonitoring,
  onPauseMonitoring,
}) => {
  const remainingPauseSecs = Math.max(0, maxPauseSeconds - pausedSeconds);

  const formatSecs = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  return (
    <div className={`w-full p-4 rounded-3xl border transition-all flex flex-col md:flex-row items-center justify-between gap-4 select-none font-sans ${
      isPaused 
        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200/80 dark:border-amber-900/50 text-amber-900 dark:text-amber-200'
        : isMonitoringActive
        ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-200/80 dark:border-indigo-900/50 text-indigo-900 dark:text-indigo-200'
        : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
    }`}>
      
      {/* Left Status Information */}
      <div className="flex items-center space-x-3.5">
        <div className={`p-2.5 rounded-2xl ${
          isPaused ? 'bg-amber-500 text-white' : isMonitoringActive ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-400 text-white'
        }`}>
          {isPaused ? <PauseCircle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
        </div>

        <div>
          <div className="flex items-center space-x-2">
            <span className="font-extrabold text-sm tracking-tight">
              {isPaused ? 'Monitoring Paused' : isMonitoringActive ? 'Active Shift Monitoring Enabled' : 'Monitoring Stopped'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              isPaused ? 'bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : isMonitoringActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700'
            }`}>
              {isPaused ? 'PAUSED' : isMonitoringActive ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isPaused ? (
              <span>Auto-resumes in <strong>{formatSecs(remainingPauseSecs)}</strong> (Max 15m break policy).</span>
            ) : isMonitoringActive ? (
              <span>Automated screenshots & app activity logged securely during shift.</span>
            ) : (
              <span>Check in to start shift monitoring.</span>
            )}
          </p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-3">
        {isPaused ? (
          <button
            onClick={onResumeMonitoring}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <PlayCircle className="w-4 h-4" />
            <span>Resume Monitoring Now</span>
          </button>
        ) : isMonitoringActive ? (
          <button
            onClick={onPauseMonitoring}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-2xl flex items-center space-x-1.5 shadow-md shadow-amber-500/20 transition-all cursor-pointer"
          >
            <PauseCircle className="w-4 h-4" />
            <span>Pause Monitoring (Take Break)</span>
          </button>
        ) : null}
      </div>

    </div>
  );
};
