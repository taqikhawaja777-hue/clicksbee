import React, { useState, useEffect } from 'react';
import { Settings, Shield, Camera, Clock, Save } from 'lucide-react';
import { productivityApiService, Employee } from './src/services/productivityApi.service';

export const ManagerSettingsView: React.FC = () => {
  const [screenshotInterval, setScreenshotInterval] = useState<number>(10);
  const [idleTimeout, setIdleTimeout] = useState<number>(5);
  const [blurScreenshots, setBlurScreenshots] = useState<boolean>(false);
  const [savedMsg, setSavedMsg] = useState<boolean>(false);

  // Camera presence monitoring: real backend-backed toggles (unlike the
  // three fields above, which are local-only mocks today). Team-level
  // grouping isn't available here since this service has no concept of
  // teams (only the main NestJS app does) - per-employee + a global kill
  // switch is what's wired up.
  const [globallyEnabled, setGloballyEnabled] = useState<boolean>(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cameraSettingsLoading, setCameraSettingsLoading] = useState<boolean>(true);
  const [cameraSavedMsg, setCameraSavedMsg] = useState<boolean>(false);

  useEffect(() => {
    Promise.all([productivityApiService.listEmployees(), productivityApiService.getGlobalCameraConfig()])
      .then(([employeeList, globalConfig]) => {
        setEmployees(employeeList);
        setGloballyEnabled(globalConfig.globallyEnabled);
      })
      .catch((e) => console.warn('[ManagerSettingsView] Failed to load camera settings:', e))
      .finally(() => setCameraSettingsLoading(false));
  }, []);

  const flashCameraSaved = () => {
    setCameraSavedMsg(true);
    setTimeout(() => setCameraSavedMsg(false), 2000);
  };

  const handleToggleGlobal = async (enabled: boolean) => {
    setGloballyEnabled(enabled);
    try {
      await productivityApiService.setGlobalCameraConfig(enabled);
      flashCameraSaved();
    } catch (e) {
      console.warn('[ManagerSettingsView] Failed to update global camera config:', e);
    }
  };

  const handleToggleEmployee = async (employeeId: string, enabled: boolean) => {
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, cameraMonitoringEnabled: enabled } : e)));
    try {
      await productivityApiService.setEmployeeCameraConfig(employeeId, enabled);
      flashCameraSaved();
    } catch (e) {
      console.warn('[ManagerSettingsView] Failed to update employee camera config:', e);
    }
  };

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

      {/* Camera Presence Monitoring — real backend-backed toggles, saved
          immediately on change (unlike the mock fields in the form above) */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-8 space-y-6 shadow-sm">
        <div className="flex items-center justify-between pb-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800 dark:text-white">Camera Presence Monitoring</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Opt-in webcam presence checks, combined with input activity. Employees are asked to consent before
                it activates on their machine.
              </p>
            </div>
          </div>
          {cameraSavedMsg && (
            <span className="px-3 py-1 bg-emerald-500 text-white font-extrabold text-[11px] rounded-full shadow-sm animate-pulse shrink-0">
              Saved
            </span>
          )}
        </div>

        {/* Global kill switch */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h4 className="font-bold text-xs text-slate-800 dark:text-white">Enable Globally</h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Master switch. Off disables camera monitoring for everyone, regardless of per-employee settings below.
            </p>
          </div>
          <input
            type="checkbox"
            checked={globallyEnabled}
            onChange={(e) => handleToggleGlobal(e.target.checked)}
            className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
          />
        </div>

        {/* Per-employee toggles */}
        <div>
          <h4 className="font-bold text-xs text-slate-800 dark:text-white mb-1">Per-Employee</h4>
          <p className="text-xs text-slate-400 mb-4">
            Team-level grouping isn't available here yet — this service doesn't share the main app's team data, so
            enablement is per-employee only.
          </p>

          {cameraSettingsLoading ? (
            <p className="text-xs text-slate-400 py-4">Loading employees…</p>
          ) : employees.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">
              No employees registered in the productivity service yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {employees.map((emp) => (
                <div key={emp.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{emp.fullName}</p>
                    <p className="text-[11px] text-slate-400">{emp.email}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={emp.cameraMonitoringEnabled}
                    onChange={(e) => handleToggleEmployee(emp.id, e.target.checked)}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagerSettingsView;
