import React from 'react';
import { LogOut, Coffee, CheckCircle2, LogIn, Clock } from 'lucide-react';
import { useEmployee } from './EmployeeContext';

export const AttendanceActionCards: React.FC = () => {
  const { session, handleCheckIn, handleCheckOut, handleToggleBreak } = useEmployee();

  const isCheckedIn = session.isActive;
  const isOnBreak = session.status === 'On Break';

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs}h ${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  return (
    <div className="w-full max-w-7xl font-sans space-y-6">
      
      {/* Header Banner */}
      <div className="bg-indigo-600 text-white rounded-3xl p-6 shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Attendance & Shift Tracker</h2>
          <p className="text-indigo-100 text-sm mt-1">Click Check In to mark present, reset timer to 0, and start shift automatically.</p>
        </div>
        <div className="flex items-center space-x-2 bg-indigo-500/40 px-4 py-2 rounded-full border border-indigo-400/30 text-xs font-semibold">
          <Clock className="w-4 h-4" />
          <span>Shift Goal: 8 Hours</span>
        </div>
      </div>

      {/* ================= TOP ACTION BUTTON CARDS ================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Card 1: Check Out / Check In Button */}
        {isCheckedIn ? (
          <button
            onClick={handleCheckOut}
            className="w-full p-8 rounded-3xl border border-[#f8d7da] dark:border-rose-900/50 bg-[#fce8ec] dark:bg-rose-950/40 text-[#ef4444] dark:text-rose-400 text-center transition-all duration-200 hover:shadow-md active:scale-[0.99] flex flex-col items-center justify-center min-h-[180px]"
          >
            <LogOut className="w-10 h-10 stroke-[2.5] mb-3 text-[#ef4444] dark:text-rose-400" />
            <h3 className="text-xl font-bold tracking-tight mb-1">Check Out</h3>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Shift Active · Click to check out & log total time
            </p>
          </button>
        ) : (
          <button
            onClick={handleCheckIn}
            className="w-full p-8 rounded-3xl border border-[#e0e7ff] dark:border-indigo-900/50 bg-[#eef2ff] dark:bg-indigo-950/40 text-[#6366f1] dark:text-indigo-400 text-center transition-all duration-200 hover:shadow-md active:scale-[0.99] flex flex-col items-center justify-center min-h-[180px]"
          >
            <LogIn className="w-10 h-10 stroke-[2.5] mb-3 text-[#6366f1] dark:text-indigo-400" />
            <h3 className="text-xl font-bold tracking-tight mb-1">Check In</h3>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Click to check in · Resets counter to 00:00:00 & starts shift</p>
          </button>
        )}

        {/* Card 2: Break Button */}
        <button
          onClick={handleToggleBreak}
          disabled={!isCheckedIn}
          className={`w-full p-8 rounded-3xl border text-center transition-all duration-200 flex flex-col items-center justify-center min-h-[180px] ${
            !isCheckedIn
              ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed opacity-60'
              : isOnBreak
              ? 'bg-[#fef3c7] dark:bg-amber-950/40 border-[#fde68a] dark:border-amber-900/50 text-[#d97706] dark:text-amber-400 hover:shadow-md active:scale-[0.99]'
              : 'bg-[#e0f2fe] dark:bg-sky-950/40 border-[#bae6fd] dark:border-sky-900/50 text-[#0284c7] dark:text-sky-400 hover:shadow-md active:scale-[0.99]'
          }`}
        >
          <Coffee className="w-10 h-10 stroke-[2.2] mb-3" />
          <h3 className="text-xl font-bold tracking-tight mb-1">
            {isOnBreak ? 'End Break' : 'Start Break'}
          </h3>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {isOnBreak ? 'On break (Timer paused)' : 'No active break'}
          </p>
        </button>

      </div>

      {/* ================= BOTTOM STATUS INFO CARDS ================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Card 3: Today's Status */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[140px] transition-colors">
          <p className="text-sm font-medium text-slate-400">Today's Status</p>
          
          <div className="flex items-center space-x-2 my-1">
            <CheckCircle2 className={`w-6 h-6 stroke-[2.5] ${isCheckedIn ? 'text-[#10b981]' : 'text-slate-400'}`} />
            <span className={`text-xl font-extrabold ${isCheckedIn ? 'text-[#10b981]' : 'text-slate-500'}`}>
              {isCheckedIn ? (isOnBreak ? 'On Break' : 'Present') : session.status}
            </span>
          </div>

          <p className="text-xs font-medium text-slate-400">
            {isCheckedIn ? (isOnBreak ? 'Break in progress' : 'Employee Present & Shift Active') : 'Awaiting Check In'}
          </p>
        </div>

        {/* Card 4: Working Hours Summary */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[140px] transition-colors">
          <p className="text-sm font-medium text-slate-400">Shift Live Counter</p>
          
          <h2 className="text-3xl font-black text-[#5850ec] dark:text-indigo-400 my-1 tracking-tight font-mono">
            {isCheckedIn ? formatTime(session.elapsedSeconds) : '0h 0m 00s'}
          </h2>

          <p className="text-xs font-medium text-slate-400">
            Break Time: <span className="text-slate-600 dark:text-slate-300 font-semibold">{Math.floor(session.breakSeconds / 60)} min</span>
          </p>
        </div>

      </div>

    </div>
  );
};

export default AttendanceActionCards;
