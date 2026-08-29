import React, { useState } from 'react';
import { Settings, Shield, Camera, Clock, Save } from 'lucide-react';

export const ManagerSettingsView: React.FC = () => {
  const [screenshotInterval, setScreenshotInterval] = useState<number>(10);
  const [idleTimeout, setIdleTimeout] = useState<number>(5);
  const [blurScreenshots, setBlurScreenshots] = useState<boolean>(false);
  const [savedMsg, setSavedMsg] = useState<boolean>(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">
            <Settings className="w-3.5 h-3.5" />
            <span>Monitoring Policies & Controls</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Portal Settings</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">Configure screen capture frequencies, idle detection, and privacy rules.</p>
        </div>

        {savedMsg && (
          <span className="px-3.5 py-1.5 bg-emerald-500 text-white font-extrabold text-xs rounded-full shadow-sm animate-pulse">
            Settings Saved Successfully!
          </span>
        )}
      </div>

      <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-8 space-y-6 shadow-sm">
        
        {/* Screenshot Interval */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white">Auto Screenshot Frequency</h3>
            <p className="text-xs text-slate-400 mt-0.5">Frequency of automated desktop screen captures per workstation.</p>
          </div>
          <select 
            value={screenshotInterval}
            onChange={(e) => setScreenshotInterval(Number(e.target.value))}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none"
          >
            <option value={5}>Every 5 Minutes</option>
            <option value={10}>Every 10 Minutes</option>
            <option value={15}>Every 15 Minutes</option>
          </select>
        </div>

        {/* Idle Timeout */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white">Idle Timeout Limit</h3>
            <p className="text-xs text-slate-400 mt-0.5">Inactivity threshold before alerting and pausing shift timers.</p>
          </div>
          <select 
            value={idleTimeout}
            onChange={(e) => setIdleTimeout(Number(e.target.value))}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none"
          >
            <option value={3}>3 Minutes</option>
            <option value={5}>5 Minutes</option>
            <option value={10}>10 Minutes</option>
          </select>
        </div>

        {/* Privacy Blur Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white">Sensitive Content Blur</h3>
            <p className="text-xs text-slate-400 mt-0.5">Automatically blur sensitive text fields in screen capture logs.</p>
          </div>
          <input 
            type="checkbox"
            checked={blurScreenshots}
            onChange={(e) => setBlurScreenshots(e.target.checked)}
            className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
          />
        </div>

        <button
          type="submit"
          className="px-6 py-3 bg-[#534bf3] text-white font-bold text-xs rounded-xl flex items-center space-x-2 shadow-md hover:bg-indigo-700 transition-all cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>Save Monitoring Rules</span>
        </button>

      </form>
    </div>
  );
};

export default ManagerSettingsView;
