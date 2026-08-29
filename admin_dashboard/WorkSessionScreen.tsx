import React from 'react';
import { Square, Play } from 'lucide-react';
import { WeeklySessionStatisticsWidget } from './WeeklySessionStatisticsWidget';
import { SessionHistoryTable } from './SessionHistoryTable';
import { useEmployee } from './EmployeeContext';

export const WorkSessionScreen: React.FC = () => {
  const { session, handleCheckIn, handleCheckOut } = useEmployee();

  const seconds = session.elapsedSeconds;
  const isActive = session.isActive;

  // Format seconds into HH:MM:SS format
  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const pad = (num: number) => String(num).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  };

  // Format total seconds into hours and minutes string (e.g. "6h 23m")
  const formatTotalHours = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs === 0 && mins === 0) return `${secs}s`;
    return `${hrs}h ${mins}m`;
  };

  // Break Time
  const breakSeconds = session.breakSeconds;
  
  // Active Time = Total Seconds - Break Seconds
  const activeSeconds = Math.max(0, seconds - breakSeconds);

  return (
    <div className="w-full max-w-7xl font-sans space-y-6">
      
      {/* Main Work Session Card */}
      <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-12 flex flex-col items-center justify-center transition-colors">
        
        {/* Circular Live Timer Dial */}
        <div className="relative w-64 h-64 rounded-full border-4 border-[#534bf3] dark:border-indigo-500 bg-[#f2f1ff] dark:bg-slate-800 flex flex-col items-center justify-center shadow-sm transition-colors">
          {/* Digital Clock Display */}
          <h1 className="text-4xl font-extrabold text-[#534bf3] dark:text-indigo-400 tracking-wider font-mono">
            {formatTime(seconds)}
          </h1>
          <p className="text-sm font-medium text-slate-400 dark:text-slate-400 mt-2">
            {isActive ? (session.status === 'On Break' ? 'On Break' : 'Active Session') : 'Session Paused'}
          </p>
        </div>

        {/* Resume / Pause Controls */}
        <div className="mt-8 flex items-center justify-center">
          {isActive ? (
            <button
              onClick={handleCheckOut}
              className="px-8 py-3.5 bg-[#ef4444] hover:bg-red-600 text-white font-bold text-base rounded-2xl flex items-center space-x-2.5 shadow-md shadow-red-200 dark:shadow-none transition-all active:scale-95 cursor-pointer"
            >
              <Square className="w-5 h-5 fill-current stroke-none" />
              <span>End Session</span>
            </button>
          ) : (
            <button
              onClick={handleCheckIn}
              className="px-8 py-3.5 bg-[#534bf3] hover:bg-indigo-700 text-white font-bold text-base rounded-2xl flex items-center space-x-2.5 shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-95 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current stroke-none" />
              <span>Start Session</span>
            </button>
          )}
        </div>

        {/* Bottom 3 Summary Metric Boxes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-12">
          
          {/* Total Today */}
          <div className="bg-[#eeeff5] dark:bg-slate-800 p-6 rounded-2xl text-center flex flex-col justify-center transition-colors">
            <h2 className="text-2xl font-extrabold text-[#534bf3] dark:text-indigo-400 font-mono">
              {formatTotalHours(seconds)}
            </h2>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 mt-1">
              Total Today
            </p>
          </div>

          {/* Break Time */}
          <div className="bg-[#eeeff5] dark:bg-slate-800 p-6 rounded-2xl text-center flex flex-col justify-center transition-colors">
            <h2 className="text-2xl font-extrabold text-[#f59e0b] dark:text-amber-400 font-mono">
              {Math.floor(breakSeconds / 60)} min
            </h2>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 mt-1">
              Break Time
            </p>
          </div>

          {/* Active Time */}
          <div className="bg-[#eeeff5] dark:bg-slate-800 p-6 rounded-2xl text-center flex flex-col justify-center transition-colors">
            <h2 className="text-2xl font-extrabold text-[#10b981] dark:text-emerald-400 font-mono">
              {formatTotalHours(activeSeconds)}
            </h2>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 mt-1">
              Active Time
            </p>
          </div>

        </div>

      </div>

      {/* Weekly Session Statistics Chart Widget */}
      <WeeklySessionStatisticsWidget />

      {/* Session History Table Widget */}
      <SessionHistoryTable />

    </div>
  );
};

export default WorkSessionScreen;
