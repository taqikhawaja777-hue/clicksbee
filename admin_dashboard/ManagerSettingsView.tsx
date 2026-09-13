import React, { useState, useEffect } from 'react';
import { Settings, Shield, Camera, Clock, Save, HardDrive, Wifi } from 'lucide-react';
import { productivityApiService, Employee } from './src/services/productivityApi.service';

export const ManagerSettingsView: React.FC = () => {
  const [screenshotInterval, setScreenshotInterval] = useState<number>(10);
  const [idleTimeout, setIdleTimeout] = useState<number>(5);
  const [blurScreenshots, setBlurScreenshots] = useState<boolean>(false);
  const [savedMsg, setSavedMsg] = useState<boolean>(false);

  // Local Screenshot Server - real, disk-persisted settings (localSettings.ts
  // in the Electron main process), unlike the mock fields in the form above.
  // Replaces the old MongoDB Atlas upload path: employee machines POST
  // screenshots straight to THIS PC over the LAN, received by
  // localScreenshotServer.ts and written to screenshotStoragePath.
  const [localServerPort, setLocalServerPort] = useState<number>(5000);
  const [screenshotStoragePath, setScreenshotStoragePath] = useState<string>('');
  const [lanIpAddresses, setLanIpAddresses] = useState<string[]>([]);
  const [serverRunning, setServerRunning] = useState<boolean>(false);
  const [localServerLoading, setLocalServerLoading] = useState<boolean>(true);
  const [localServerSavedMsg, setLocalServerSavedMsg] = useState<boolean>(false);

  const getIpc = () => {
    if (typeof window === 'undefined' || !(window as any).require) return null;
    return (window as any).require('electron').ipcRenderer;
  };

  const refreshLocalServerStatus = async () => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) return;
    try {
      const status = await ipcRenderer.invoke('get-local-server-status');
      setServerRunning(!!status?.running);
    } catch (e) {
      console.warn('[ManagerSettingsView] Failed to read local server status:', e);
    }
  };

  useEffect(() => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) {
      setLocalServerLoading(false);
      return;
    }
    ipcRenderer
      .invoke('get-local-settings')
      .then(({ settings, lanIpAddresses: ips }: any) => {
        setLocalServerPort(settings.localServerPort);
        setScreenshotStoragePath(settings.screenshotStoragePath);
        setLanIpAddresses(ips || []);
      })
      .catch((e: any) => console.warn('[ManagerSettingsView] Failed to load local server settings:', e))
      .finally(() => setLocalServerLoading(false));
    refreshLocalServerStatus();
  }, []);

  const flashLocalServerSaved = () => {
    setLocalServerSavedMsg(true);
    setTimeout(() => setLocalServerSavedMsg(false), 2000);
  };

  const handleSaveLocalServerSettings = async () => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) return;
    try {
      await ipcRenderer.invoke('set-local-settings', {
        localServerPort: Number(localServerPort),
        screenshotStoragePath,
      });
      // Port may have changed - rebind the listener on the new port.
      await ipcRenderer.invoke('restart-local-screenshot-server', Number(localServerPort));
      await refreshLocalServerStatus();
      flashLocalServerSaved();
    } catch (e) {
      console.warn('[ManagerSettingsView] Failed to save local server settings:', e);
    }
  };

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

      {/* Local Screenshot Server — replaces the old MongoDB Atlas upload
          path. Employee machines POST screenshots straight to this PC's IP
          over the LAN; received here, written to screenshotStoragePath. */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-8 space-y-6 shadow-sm">
        <div className="flex items-center justify-between pb-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800 dark:text-white">Local Screenshot Server</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Employee screenshots are received directly by this PC over your local network and stored on disk here - no cloud database involved.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            {localServerSavedMsg && (
              <span className="px-3 py-1 bg-emerald-500 text-white font-extrabold text-[11px] rounded-full shadow-sm animate-pulse">
                Saved
              </span>
            )}
            <span className={`px-3 py-1 font-extrabold text-[11px] rounded-full ${
              serverRunning
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
            }`}>
              {serverRunning ? 'Running' : 'Not Running'}
            </span>
          </div>
        </div>

        {localServerLoading ? (
          <p className="text-xs text-slate-400">Loading local server settings…</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="font-bold text-xs text-slate-800 dark:text-white">This PC's LAN IP Address</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Give this (and the port below) to employees for their "Admin PC IP" setting.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Wifi className="w-4 h-4 text-indigo-500" />
                <span className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white font-mono">
                  {lanIpAddresses.length > 0 ? lanIpAddresses.join(', ') : 'No LAN IP detected'}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="font-bold text-xs text-slate-800 dark:text-white">Server Port</h4>
                <p className="text-xs text-slate-400 mt-0.5">Port this PC listens on for incoming screenshot uploads.</p>
              </div>
              <input
                type="number"
                min={1024}
                max={65535}
                value={localServerPort}
                onChange={(e) => setLocalServerPort(Number(e.target.value))}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none w-28"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
              <div>
                <h4 className="font-bold text-xs text-slate-800 dark:text-white">Storage Folder</h4>
                <p className="text-xs text-slate-400 mt-0.5">Where received screenshots are saved on this PC (organized by employee, then date).</p>
              </div>
              <input
                type="text"
                value={screenshotStoragePath}
                onChange={(e) => setScreenshotStoragePath(e.target.value)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none w-full sm:w-80 font-mono"
              />
            </div>

            <button
              onClick={handleSaveLocalServerSettings}
              className="px-6 py-3 bg-[#534bf3] text-white font-bold text-xs rounded-xl flex items-center space-x-2 shadow-md hover:bg-indigo-700 transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save & Restart Local Server</span>
            </button>

            <p className="text-[11px] text-slate-400 pt-2">
              Screenshots older than 24 hours are deleted automatically from this folder every hour.
            </p>
          </>
        )}
      </div>

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
