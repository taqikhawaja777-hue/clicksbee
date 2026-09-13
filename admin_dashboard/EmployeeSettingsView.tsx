import React, { useState, useEffect } from 'react';
import { Settings, Wifi, Save, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Employee-side counterpart to ManagerSettingsView's "Local Screenshot
 * Server" section: where an employee points their app at the manager's PC
 * so captureService.ts's 5-minute capture loop knows where to send
 * screenshots. Replaces the old hardcoded MongoDB Atlas upload target -
 * this is the "make the admin PC's IP address a configurable setting"
 * requirement's employee-facing half.
 */
export const EmployeeSettingsView: React.FC = () => {
  const [adminPcIp, setAdminPcIp] = useState<string>('');
  const [adminPcPort, setAdminPcPort] = useState<number>(5000);
  const [loading, setLoading] = useState<boolean>(true);
  const [savedMsg, setSavedMsg] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'failure'>('idle');

  const getIpc = () => {
    if (typeof window === 'undefined' || !(window as any).require) return null;
    return (window as any).require('electron').ipcRenderer;
  };

  useEffect(() => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) {
      setLoading(false);
      return;
    }
    ipcRenderer
      .invoke('get-local-settings')
      .then(({ settings }: any) => {
        setAdminPcIp(settings.adminPcIp || '');
        setAdminPcPort(settings.adminPcPort || 5000);
      })
      .catch((e: any) => console.warn('[EmployeeSettingsView] Failed to load settings:', e))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) return;
    try {
      await ipcRenderer.invoke('set-local-settings', {
        adminPcIp: adminPcIp.trim(),
        adminPcPort: Number(adminPcPort),
      });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e) {
      console.warn('[EmployeeSettingsView] Failed to save settings:', e);
    }
  };

  const handleTestConnection = async () => {
    if (!adminPcIp.trim()) return;
    setTestResult('testing');
    try {
      const res = await fetch(`http://${adminPcIp.trim()}:${adminPcPort}/health`, {
        method: 'GET',
      });
      setTestResult(res.ok ? 'success' : 'failure');
    } catch (e) {
      setTestResult('failure');
    }
    setTimeout(() => setTestResult('idle'), 4000);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto font-sans select-none">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm mb-6">
        <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">
          <Settings className="w-3.5 h-3.5" />
          <span>Device Settings</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Settings</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">Configure where this device sends its automated desktop screenshots.</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-8 space-y-6 shadow-sm">
        <div className="flex items-center space-x-3 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white">Admin PC Connection</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Your desktop screenshots are sent directly to your manager's PC over the local network. Ask them for their PC's IP address and port (shown on their Settings page).
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">Loading settings…</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="font-bold text-xs text-slate-800 dark:text-white">Admin PC IP Address</h4>
                <p className="text-xs text-slate-400 mt-0.5">e.g. 192.168.1.50</p>
              </div>
              <input
                type="text"
                value={adminPcIp}
                onChange={(e) => setAdminPcIp(e.target.value)}
                placeholder="192.168.1.50"
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none w-48 font-mono"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="font-bold text-xs text-slate-800 dark:text-white">Admin PC Port</h4>
                <p className="text-xs text-slate-400 mt-0.5">Matches the "Server Port" shown on your manager's Settings page.</p>
              </div>
              <input
                type="number"
                min={1024}
                max={65535}
                value={adminPcPort}
                onChange={(e) => setAdminPcPort(Number(e.target.value))}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none w-28"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSave}
                className="px-6 py-3 bg-[#534bf3] text-white font-bold text-xs rounded-xl flex items-center space-x-2 shadow-md hover:bg-indigo-700 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Save</span>
              </button>

              <button
                onClick={handleTestConnection}
                disabled={!adminPcIp.trim() || testResult === 'testing'}
                className="px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center space-x-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer disabled:opacity-50"
              >
                <span>{testResult === 'testing' ? 'Testing…' : 'Test Connection'}</span>
              </button>

              {savedMsg && (
                <span className="px-3 py-1.5 bg-emerald-500 text-white font-extrabold text-xs rounded-full shadow-sm animate-pulse">
                  Saved!
                </span>
              )}
              {testResult === 'success' && (
                <span className="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Reachable</span>
                </span>
              )}
              {testResult === 'failure' && (
                <span className="flex items-center space-x-1.5 text-rose-500 text-xs font-bold">
                  <XCircle className="w-4 h-4" />
                  <span>Not reachable - check the IP/port and that the admin's app is running</span>
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-400 pt-2">
              Screenshots captured while this admin PC is unreachable are queued on this device and retried automatically once it comes back online.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default EmployeeSettingsView;
