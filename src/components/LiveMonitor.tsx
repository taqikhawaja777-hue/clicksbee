import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Activity,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Wifi,
  WifiOff,
  Layers,
  ChevronDown,
} from 'lucide-react';

export interface ActivityData {
  summary: string;
  status: 'ON TRACK' | 'IDLE' | 'OFF TASK';
  confidenceScore: number;
  taskRelevance: 'Yes' | 'No';
  activeWindow: string;
  timestamp: string;
  employeeId?: string;
  imageUrl?: string;
}

export interface LiveMonitorProps {
  selectedEmployeeId?: string;
  registeredEmployees?: Array<{ id: string; name: string; role?: string }>;
  onSelectEmployee?: (empId: string) => void;
  backendUrl?: string;
}

export const LiveMonitor: React.FC<LiveMonitorProps> = ({
  selectedEmployeeId = 'emp-101',
  registeredEmployees = [],
  onSelectEmployee,
  backendUrl = 'http://localhost:3000',
}) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEmployeeId) return;

    // Connect to WebSocket Server
    const socket: Socket = io(backendUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      console.log('[LiveMonitor] Connected to WebSocket server');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[LiveMonitor] Disconnected from WebSocket server');
      setIsConnected(false);
    });

    const handleUpdate = (payload: any) => {
      console.log('[LiveMonitor] WebSocket activity update received:', payload);
      setActivityData({
        summary: payload.summary || 'Employee is working on assigned workstation tasks.',
        status:
          payload.status === 'OFF TASK'
            ? 'OFF TASK'
            : payload.status === 'IDLE'
            ? 'IDLE'
            : 'ON TRACK',
        confidenceScore: payload.confidenceScore ?? 94,
        taskRelevance: payload.taskRelevance === 'No' ? 'No' : 'Yes',
        activeWindow: payload.activeWindow || payload.activeWindowName || 'Developer Workstation',
        timestamp: payload.timestamp || new Date().toISOString(),
        imageUrl: payload.imageUrl,
      });

      const formattedTime = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setLastUpdateTime(formattedTime);
    };

    // 1. Listen to specific employee channel
    socket.on(`employee:update:${selectedEmployeeId}`, handleUpdate);

    // 2. Listen to general live feed channel
    socket.on('live:feed', (data: any) => {
      if (data && (data.employeeId === selectedEmployeeId || data.userId === selectedEmployeeId)) {
        handleUpdate(data);
      }
    });

    // 3. Listen for back-compat evaluation channel
    socket.on('NEW_SCREENSHOT_EVALUATED', (data: any) => {
      if (data && (data.employeeId === selectedEmployeeId || data.userId === selectedEmployeeId)) {
        handleUpdate(data);
      }
    });

    // Cleanup socket connection on unmount or employee selection change
    return () => {
      socket.off(`employee:update:${selectedEmployeeId}`);
      socket.off('live:feed');
      socket.off('NEW_SCREENSHOT_EVALUATED');
      socket.disconnect();
    };
  }, [selectedEmployeeId, backendUrl]);

  const rawStatus = activityData?.status || 'ON TRACK';
  const isOffTask = rawStatus === 'OFF TASK';
  const isIdle = rawStatus === 'IDLE';

  return (
    <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 rounded-3xl p-6 text-white border border-indigo-800/60 shadow-xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-indigo-800/60 pb-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-indigo-600/40 rounded-2xl border border-indigo-500/30 text-indigo-300">
                <Brain className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-bold tracking-tight text-white">Live Monitor Summary Card</h2>
                  
                  {/* Connection Status Badge */}
                  <span
                    className={`px-2.5 py-0.5 border text-[10px] font-extrabold rounded-full flex items-center gap-1.5 ${
                      isConnected
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                      }`}
                    />
                    {isConnected ? (
                      <>
                        <Wifi className="w-3 h-3 text-emerald-400" /> LIVE
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3 h-3 text-rose-400" /> DISCONNECTED
                      </>
                    )}
                  </span>
                </div>

                <p className="text-xs text-indigo-200/80 font-medium mt-0.5">
                  Real-time LLM Vision desktop screen evaluation (Auto-refreshes every 60s).
                  {lastUpdateTime && (
                    <span className="ml-2 text-amber-300 font-semibold">
                      Last update: {lastUpdateTime}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Employee Dropdown Selection */}
            {registeredEmployees.length > 0 && onSelectEmployee && (
              <div className="relative flex items-center gap-2 mt-2 md:mt-0 md:ml-4">
                <span className="text-xs text-indigo-300 font-semibold hidden md:inline">Focus:</span>
                <div className="relative">
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => onSelectEmployee(e.target.value)}
                    className="appearance-none pl-3 pr-8 py-1.5 bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/80 rounded-xl text-xs font-extrabold text-white focus:outline-none cursor-pointer shadow-inner"
                  >
                    {registeredEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id} className="bg-slate-900 text-white">
                        {emp.name} ({emp.role || 'Employee'})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-indigo-300 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          {/* Activity Status Badge */}
          {isOffTask ? (
            <div className="px-3.5 py-1.5 bg-rose-500/20 text-rose-300 rounded-2xl border border-rose-500/40 text-xs font-bold flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>Status: OFF TASK</span>
            </div>
          ) : isIdle ? (
            <div className="px-3.5 py-1.5 bg-amber-500/20 text-amber-300 rounded-2xl border border-amber-500/40 text-xs font-bold flex items-center space-x-1.5">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Status: IDLE</span>
            </div>
          ) : (
            <div className="px-3.5 py-1.5 bg-emerald-500/20 text-emerald-300 rounded-2xl border border-emerald-500/40 text-xs font-bold flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Status: ON TRACK</span>
            </div>
          )}
        </div>

        {/* Content Body */}
        {!activityData ? (
          <div className="py-8 text-center text-indigo-300/80 text-sm font-semibold flex items-center justify-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
            <span>Waiting for first update... (Electron capturing every 60s)</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
            {/* Column 1: Active Window & Activity Summary */}
            <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" /> Active Application
                </span>
                <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-200 text-[10px] font-bold rounded-lg border border-indigo-500/30 truncate max-w-[120px]">
                  {activityData.activeWindow}
                </span>
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-white line-clamp-1">
                  {activityData.activeWindow}
                </h3>
                <p className="text-xs text-indigo-200/80 line-clamp-3 mt-1 leading-relaxed">
                  {activityData.summary}
                </p>
              </div>
            </div>

            {/* Column 2: Status & Confidence Score */}
            <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" /> AI Vision Index
                </span>
                <span className="text-xs font-bold text-indigo-200 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" /> Confidence: {activityData.confidenceScore}%
                </span>
              </div>

              <div className="flex items-center space-x-3 my-1">
                {isOffTask ? (
                  <div className="px-3.5 py-2 bg-rose-500/20 border border-rose-500/50 rounded-2xl text-rose-300 font-extrabold text-sm flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse" />
                    <span>OFF TASK</span>
                  </div>
                ) : isIdle ? (
                  <div className="px-3.5 py-2 bg-amber-500/20 border border-amber-500/50 rounded-2xl text-amber-300 font-extrabold text-sm flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <span>IDLE</span>
                  </div>
                ) : (
                  <div className="px-3.5 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-2xl text-emerald-400 font-extrabold text-sm flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>ON TRACK</span>
                  </div>
                )}

                <div className="text-xs text-indigo-200/80 font-semibold">
                  Task Relevance: <strong className="text-white">{activityData.taskRelevance}</strong>
                </div>
              </div>

              <div className="text-xs text-indigo-200/70 flex items-center justify-between">
                <span>Timestamp:</span>
                <strong className="text-white font-mono">{activityData.timestamp}</strong>
              </div>
            </div>

            {/* Column 3: Live Image Frame Preview */}
            <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col items-center justify-center overflow-hidden min-h-[110px]">
              {activityData.imageUrl ? (
                <img
                  src={activityData.imageUrl}
                  alt="Live Employee Desktop Frame"
                  className="w-full h-28 object-cover rounded-xl border border-indigo-700/50"
                />
              ) : (
                <div className="text-center p-4">
                  <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center mx-auto mb-2 text-indigo-300">
                    <Brain className="w-4 h-4" />
                  </div>
                  <p className="text-[11px] text-indigo-300/70 font-semibold">
                    Live desktop frame preview automatically rendered on WebSocket update
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveMonitor;
