import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera,
  Calendar,
  Users,
  Eye,
  X,
  Clock,
  Monitor,
  ShieldCheck,
  ImageOff,
  HardDrive,
  Trash2,
  Lock,
  ShieldAlert,
  EyeOff,
  WifiOff,
} from 'lucide-react';
import { useEmployee } from './EmployeeContext';

interface GalleryScreenshot {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string;
  timestamp: string;
  date: string;
  imageUrl: string; // file:// URL
  isIdle: boolean;
  activeWindowName: string;
}

const toFileUrl = (filePath: string): string => {
  // Windows paths ("C:\WorkTrackPro-Screenshots\...") need forward slashes
  // and a leading slash before the drive letter to become a valid
  // file:// URL Chromium's renderer will actually load.
  const normalized = filePath.replace(/\\/g, '/');
  return `file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}`;
};

const toGalleryShape = (entry: any): GalleryScreenshot => ({
  id: entry.id,
  userId: entry.employeeId,
  userName: entry.employeeName,
  userRole: entry.employeeRole || 'Employee',
  timestamp: new Date(entry.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  date: entry.date,
  imageUrl: toFileUrl(entry.filePath),
  isIdle: !!entry.isIdle,
  activeWindowName: entry.activeWindowName || 'Active Desktop Application',
});

export const ScreenshotsGallery: React.FC = () => {
  const { user } = useEmployee();
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [screenshots, setScreenshots] = useState<GalleryScreenshot[]>([]);
  const [activeModalImage, setActiveModalImage] = useState<GalleryScreenshot | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<{ running: boolean; port: number; lanIpAddresses: string[] } | null>(null);

  const getIpc = () => {
    if (typeof window === 'undefined' || !(window as any).require) return null;
    return (window as any).require('electron').ipcRenderer;
  };

  // Reads straight from this PC's local screenshot folder
  // (screenshotStoragePath/<employee>/<date>/) via localScreenshotServer.ts's
  // list-local-screenshots IPC handler - replaces the old MongoDB Atlas
  // /screenshots/feed fetch + localStorage/BroadcastChannel merge (three
  // separate sources of the same data, now down to the one real one: this
  // PC's disk).
  const fetchLocalScreenshots = useCallback(async () => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) return;
    try {
      const entries = await ipcRenderer.invoke('list-local-screenshots');
      setScreenshots((Array.isArray(entries) ? entries : []).map(toGalleryShape));
    } catch (e) {
      console.warn('[ScreenshotsGallery] Failed to list local screenshots:', e);
    }
  }, []);

  const fetchServerStatus = useCallback(async () => {
    const ipcRenderer = getIpc();
    if (!ipcRenderer) return;
    try {
      const status = await ipcRenderer.invoke('get-local-server-status');
      setServerStatus(status);
    } catch (e) {
      console.warn('[ScreenshotsGallery] Failed to read local server status:', e);
    }
  }, []);

  useEffect(() => {
    if (user.role === 'EMPLOYEE') return;

    fetchLocalScreenshots();
    fetchServerStatus();

    const ipcRenderer = getIpc();
    // Live-refresh the moment a screenshot lands on disk - either from a
    // remote employee machine over the LAN (local-screenshot-received,
    // broadcast by localScreenshotServer.ts) or one captured on this same
    // machine (screenshot-captured-event, broadcast by captureService.ts,
    // relevant if this admin account is itself being tracked).
    const handleUpdate = () => fetchLocalScreenshots();
    if (ipcRenderer) {
      ipcRenderer.on('local-screenshot-received', handleUpdate);
      ipcRenderer.on('screenshot-captured-event', handleUpdate);
    }

    // Fallback safety-net poll - covers the (rare) case a broadcast is
    // missed, without depending on it for correctness.
    const pollTimer = setInterval(() => {
      fetchLocalScreenshots();
      fetchServerStatus();
    }, 60000);

    return () => {
      if (ipcRenderer) {
        ipcRenderer.removeListener('local-screenshot-received', handleUpdate);
        ipcRenderer.removeListener('screenshot-captured-event', handleUpdate);
      }
      clearInterval(pollTimer);
    };
  }, [user.role, fetchLocalScreenshots, fetchServerStatus]);

  // RESTRICT ACCESS IF LOGGED IN USER IS AN EMPLOYEE
  if (user.role === 'EMPLOYEE') {
    return (
      <div className="w-full max-w-5xl mx-auto font-sans space-y-6 select-none py-6">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
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
  }

  // Delete All Screenshots Action - now a real delete of every file under
  // screenshotStoragePath (previously this only cleared localStorage/UI
  // state despite the confirm dialog claiming to delete "from MongoDB
  // Atlas and local storage" - it never actually deleted anything real).
  const handleDeleteAllScreenshots = async () => {
    if (!confirm('Are you sure you want to permanently delete all locally stored screenshots from this PC?')) {
      return;
    }
    const ipcRenderer = getIpc();
    if (!ipcRenderer) return;

    try {
      const result = await ipcRenderer.invoke('delete-all-local-screenshots');
      if (result?.success) {
        setScreenshots([]);
        setToastMessage('All local screenshots deleted successfully!');
      } else {
        setToastMessage('Failed to delete local screenshots.');
      }
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      console.error('Delete error:', err);
      setToastMessage('Failed to delete local screenshots.');
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  const employeeNames = Array.from(new Set(screenshots.map((s) => s.userName))).sort();

  const filteredScreenshots = screenshots.filter((shot) => {
    const matchesUser = selectedUser === 'ALL' || shot.userName === selectedUser;
    const matchesDate = !selectedDate || shot.date === selectedDate;
    return matchesUser && matchesDate;
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">

      {/* 1. Header Banner & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center space-x-2">
            <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
              <Camera className="w-3.5 h-3.5" />
              <span>Real-time 5-Min Desktop Capture Sync</span>
            </div>
            {serverStatus?.running ? (
              <div className="inline-flex items-center space-x-1.5 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1 rounded-full text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 border border-emerald-200/60 dark:border-emerald-800/60">
                <HardDrive className="w-3.5 h-3.5" />
                <span>
                  Local Server Listening on Port {serverStatus.port}
                  {serverStatus.lanIpAddresses.length > 0 ? ` (${serverStatus.lanIpAddresses[0]})` : ''}
                </span>
              </div>
            ) : (
              <div className="inline-flex items-center space-x-1.5 bg-rose-50 dark:bg-rose-950/50 px-3 py-1 rounded-full text-xs font-bold text-rose-600 dark:text-rose-400 mb-2 border border-rose-200/60 dark:border-rose-800/60">
                <WifiOff className="w-3.5 h-3.5" />
                <span>Local Screenshot Server Not Running</span>
              </div>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Manager Desktop Screenshots Gallery
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Real PC desktop screen captures received directly from employee machines over the local network and stored on this PC's disk under <code className="text-indigo-500 font-mono">{serverStatus?.port ? 'WorkTrackPro-Screenshots' : '...'}</code>.
          </p>
        </div>

        {/* Filter Controls Bar & Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Employee Selector Dropdown */}
          <div className="relative">
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="appearance-none pl-9 pr-8 py-2.5 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-2xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Employees</option>
              {employeeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Users className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Date Picker Filter */}
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-2xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            />
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            onClick={handleDeleteAllScreenshots}
            className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/50 font-extrabold text-xs rounded-2xl flex items-center space-x-1.5 transition-all active:scale-95 cursor-pointer"
            title="Delete all screenshots"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete All</span>
          </button>

        </div>
      </div>

      {/* Toast Notification Alert */}
      {toastMessage && (
        <div className="p-4 bg-indigo-600 text-white rounded-2xl shadow-xl flex items-center space-x-3 text-xs font-bold animate-bounce">
          <HardDrive className="w-4 h-4 text-emerald-300 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 2. Screenshot Cards Responsive Grid or Empty State */}
      {filteredScreenshots.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-16 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-4">
            <ImageOff className="w-8 h-8 opacity-60" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">No Screenshots Found Locally</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            No screenshot files exist on this PC's disk for the selected employee/date yet. New captures arrive here automatically every 5 minutes while an employee is signed in and their "Admin PC IP" setting points at this machine.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredScreenshots.map((shot) => (
            <div
              key={shot.id}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between transition-all hover:shadow-md"
            >

              {/* Card Header: Employee Details & Status */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                    {(shot.userName || '?').split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-xs text-slate-900 dark:text-white">{shot.userName}</h3>
                    <span className="inline-block bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5">
                      {shot.userRole}
                    </span>
                  </div>
                </div>

                {/* Status Indicator */}
                {shot.isIdle ? (
                  <span className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 rounded-full text-[10px] font-bold flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>Idle ({'>'}60s)</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 rounded-full text-[10px] font-bold flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Active Screen</span>
                  </span>
                )}
              </div>

              {/* Real Screen Preview Image & Hover Controls */}
              <div className="relative aspect-video bg-slate-950 overflow-hidden group cursor-pointer" onClick={() => setActiveModalImage(shot)}>
                <img
                  src={shot.imageUrl}
                  alt={`Capture ${shot.timestamp}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-95"
                />

                {/* Hover Overlay with Eye / Zoom Icon */}
                <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center text-white space-y-2">
                  <div className="p-3 bg-white/20 backdrop-blur-md rounded-full border border-white/30 text-white shadow-xl">
                    <Eye className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-extrabold tracking-wide">Click to Expand High-Res View</span>
                </div>
              </div>

              {/* Card Footer Information */}
              <div className="p-4 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center space-x-1.5 truncate">
                    <Monitor className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="font-bold text-slate-700 dark:text-slate-200 truncate" title={shot.activeWindowName}>
                      {shot.activeWindowName}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 shrink-0 font-bold text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{shot.timestamp}</span>
                  </div>
                </div>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* 3. High-Resolution Full-Screen Modal Preview */}
      {activeModalImage && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">

            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  {(activeModalImage.userName || '?').split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">{activeModalImage.userName} ({activeModalImage.userRole})</h3>
                  <p className="text-xs text-slate-400">{activeModalImage.timestamp} · {activeModalImage.activeWindowName}</p>
                </div>
              </div>

              <button
                onClick={() => setActiveModalImage(null)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* High Resolution Image View */}
            <div className="flex-1 overflow-auto bg-slate-950 p-4 flex items-center justify-center">
              <img src={activeModalImage.imageUrl} />
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-4 h-4 text-emerald-500" />
                <span>Stored locally on this PC's disk (Real PC Desktop Capture)</span>
              </div>
              <button
                onClick={() => setActiveModalImage(null)}
                className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl shadow-sm hover:bg-indigo-700"
              >
                Close Preview
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default ScreenshotsGallery;
