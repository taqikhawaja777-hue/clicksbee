import React from 'react';
import { Camera, ShieldCheck, Lock, EyeOff, ShieldAlert } from 'lucide-react';
import { useEmployee } from './EmployeeContext';
import { ScreenshotsGallery } from './ScreenshotsGallery';

export const ScreenshotsView: React.FC = () => {
  const { user } = useEmployee();

  // ONLY Manager or Admin has rights to view Employee Screen Screenshots & Controls
  if (user.role === 'MANAGER' || user.role === 'ADMIN') {
    return <ScreenshotsGallery />;
  }

  // Employee Portal View (umer Sohail): Restricted Access & Privacy Compliance Notice
  return (
    <div className="w-full max-w-5xl mx-auto font-sans space-y-6 select-none py-6">
      
      {/* Header Info Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 transition-colors">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl shrink-0">
            <Camera className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Automated Screen Monitoring</h2>
            <p className="text-xs text-slate-400 font-medium mt-1">Background desktop capture service active for compliance and work shift auditing.</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold border border-emerald-200/60 dark:border-emerald-900/50 shrink-0">
          <ShieldCheck className="w-4 h-4" />
          <span>Encrypted & Privacy Protected</span>
        </div>
      </div>

      {/* Access Restricted Compliance Notice Box */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 mb-2">
          <Lock className="w-8 h-8 text-amber-500" />
        </div>

        <div className="inline-flex items-center space-x-2 px-3 py-1 bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-900/50 rounded-full text-xs font-bold text-amber-700 dark:text-amber-400">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Employee Access Restricted</span>
        </div>

        <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
          Screen Capture Access Reserved for Managers
        </h3>

        <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
          In accordance with organizational monitoring policy, employee desktop screenshots are captured silently during active work shifts for supervisor compliance. Employees do not have authorization to view, download, capture, or delete screen monitoring logs.
        </p>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 w-full max-w-md flex items-center justify-center space-x-2 text-xs text-slate-500">
          <EyeOff className="w-4 h-4 text-indigo-500" />
          <span>Restricted to Authorized Managers & System Administrators</span>
        </div>
      </div>

    </div>
  );
};

export default ScreenshotsView;
