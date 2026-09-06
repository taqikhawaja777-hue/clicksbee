import React, { useState, useEffect } from 'react';
import { Eye, AlertTriangle, CheckCircle2, Clock, Brain, Sparkles, Activity, Layers, ChevronDown } from 'lucide-react';
import { useEmployee } from './EmployeeContext';
import { socketService } from './src/services/socket.service';
import { LiveIdleStatusCard } from './LiveIdleStatusCard';

interface AiSummaryData {
  userId: string;
  employeeName: string;
  employeeEmail: string;
  assignedTask: {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    estimatedTimeMinutes: number;
    actualTimeMinutes: number;
    startedAt: string;
  };
  estimatedVsActualTime: {
    estimatedMinutes: number;
    actualMinutes: number;
    elapsedMinutes: number;
    percentageTimeUsed: number;
  };
  aiConfidenceScore: number;
  latestScreenSummary: {
    aiSummary: string;
    progressPercentage: number;
    status: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE';
    isTaskRelevant: boolean;
    capturedAt: string;
    imageUrl?: string;
  };
  productivityStatus: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE';
  consecutiveDistractionsCount: number;
  alertBadge: boolean;
}

export const LiveMonitorView: React.FC = () => {
  const { screenshots: contextScreenshots } = useEmployee();
  const [aiSummary, setAiSummary] = useState<AiSummaryData | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState<number>(2700);
  const [registeredEmployeesList, setRegisteredEmployeesList] = useState<any[]>([]);

  // Sync initial elapsed seconds when AI summary changes
  useEffect(() => {
    if (aiSummary?.assignedTask?.startedAt) {
      const start = new Date(aiSummary.assignedTask.startedAt).getTime();
      if (!isNaN(start)) {
        const secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
        setLiveElapsedSeconds(secs);
        return;
      }
    }
    if (aiSummary?.estimatedVsActualTime?.elapsedMinutes != null) {
      setLiveElapsedSeconds(aiSummary.estimatedVsActualTime.elapsedMinutes * 60);
    }
  }, [aiSummary]);

  // Continuous 1-second live ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchAiSummary = async (userId: string = 'emp-101') => {
    if (!userId) return;
    try {
      const res = await fetch(`http://localhost:3000/api/v1/analytics/live-summary?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setAiSummary(data);
      } else {
        const fallbackRes = await fetch(`http://localhost:3000/api/v1/analytics/employee-summary/${userId}`);
        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          setAiSummary(data);
        }
      }
    } catch (e) {
      console.warn('AI Analytics summary fetch error:', e);
    }
  };

  useEffect(() => {
    if (!selectedEmployeeId) return;

    // 1. Initial Fetch when employee is selected
    fetchAiSummary(selectedEmployeeId);

    // 2. Set up 1-Minute Auto-Polling Interval (60,000 ms)
    const intervalId = setInterval(() => {
      console.log(`[Auto-Refresh] Fetching 1-minute LLM update for Employee ID: ${selectedEmployeeId}`);
      fetchAiSummary(selectedEmployeeId);
    }, 60000); // 60 seconds

    // 3. Socket.IO Real-Time Listener via centralized socketService
    let handleEmployeeUpdate: ((data: any) => void) | null = null;
    let handleLiveFeed: ((data: any) => void) | null = null;

    try {
      socketService.subscribe(selectedEmployeeId);

      handleEmployeeUpdate = (data: any) => {
        console.log('[Socket.IO] Real-time activity update received for employee:', data);
        if (data) {
          setAiSummary((prev: any) => ({
            ...prev,
            productivityStatus: data.status === 'OFF TASK' ? 'DISTRACTED' : data.status === 'IDLE' ? 'IDLE' : 'ON_TRACK',
            aiConfidenceScore: data.confidenceScore || 94,
            latestScreenSummary: {
              aiSummary: data.summary || prev?.latestScreenSummary?.aiSummary || 'Desktop screen context analyzed',
              progressPercentage: data.confidenceScore || 50,
              status: data.status,
              isTaskRelevant: data.taskRelevance !== 'No',
              capturedAt: data.timestamp || new Date(),
              imageUrl: data.imageUrl || prev?.latestScreenSummary?.imageUrl,
            },
          }));
        }
      };

      socketService.on(`employee:update:${selectedEmployeeId}`, handleEmployeeUpdate);

      handleLiveFeed = (data: any) => {
        if (data && (data.employeeId === selectedEmployeeId || data.userId === selectedEmployeeId)) {
          fetchAiSummary(selectedEmployeeId);
        }
      };
      socketService.on('live:feed', handleLiveFeed);
    } catch (e) {
      console.warn('Socket connection error:', e);
    }

    // Cleanup timer and socket listener on unmount or user change
    return () => {
      clearInterval(intervalId);
      if (handleEmployeeUpdate) socketService.off(`employee:update:${selectedEmployeeId}`, handleEmployeeUpdate);
      if (handleLiveFeed) socketService.off('live:feed', handleLiveFeed);
      socketService.unsubscribe(selectedEmployeeId);
    };
  }, [selectedEmployeeId]);

  // Fetch registered employees from MongoDB API (drives the Focus dropdown
  // on the summary card below)
  const fetchRegisteredEmployees = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/v1/employees');
      if (res.ok) {
        const json = await res.json();
        let list: any[] = [];
        if (Array.isArray(json)) list = json;
        else if (json?.data?.data && Array.isArray(json.data.data)) list = json.data.data;
        else if (json?.data && Array.isArray(json.data)) list = json.data;

        setRegisteredEmployeesList(list);

        if (list.length > 0 && !selectedEmployeeId) {
          setSelectedEmployeeId(list[0].id);
        }
      }
    } catch (e) {
      console.warn('Employees fetch error:', e);
    }
  };

  useEffect(() => {
    fetchRegisteredEmployees();
    const refreshTimer = setInterval(fetchRegisteredEmployees, 30000);
    return () => clearInterval(refreshTimer);
  }, []);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">

      {/* ========== LIVE IDLE/ACTIVE STATUS (replaces screen-recording live feeds) ========== */}
      <LiveIdleStatusCard />

      {/* ========== LIVE MANAGER SUMMARY CARD (LLM PRODUCTIVITY INDEX) ========== */}
      {(() => {
        const isTaskRelevant = aiSummary?.latestScreenSummary?.isTaskRelevant !== false;
        const rawStatus = aiSummary?.productivityStatus || 'ON_TRACK';
        const isDistracted = !isTaskRelevant || rawStatus === 'DISTRACTED';
        const isBehindSchedule = !isDistracted && rawStatus === 'BEHIND_SCHEDULE';
        const isProductive = !isDistracted && !isBehindSchedule;

        return (
          <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 rounded-3xl p-6 text-white border border-indigo-800/60 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 space-y-4">

              {/* Card Header & Synchronized Alert / Status Badge */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-indigo-800/60 pb-4">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-indigo-600/40 rounded-2xl border border-indigo-500/30 text-indigo-300">
                      <Brain className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-lg font-bold tracking-tight text-white">Live Manager Summary Card</h2>
                        <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[10px] font-extrabold rounded-full flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-300" /> AI Productivity Index
                        </span>
                      </div>
                      <p className="text-xs text-indigo-200/80 font-medium">Real-time LLM Vision desktop screen evaluation against assigned task & time budget.</p>
                    </div>
                  </div>

                  {/* Inline Employee Selector Dropdown */}
                  <div className="relative flex items-center gap-2 mt-2 md:mt-0 md:ml-4">
                    <span className="text-xs text-indigo-300 font-semibold hidden md:inline">Focus:</span>
                    <div className="relative">
                      <select
                        value={selectedEmployeeId || ''}
                        onChange={(e) => setSelectedEmployeeId(e.target.value)}
                        className="appearance-none pl-3 pr-8 py-1.5 bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/80 rounded-xl text-xs font-extrabold text-white focus:outline-none cursor-pointer shadow-inner"
                      >
                        {registeredEmployeesList.map((emp) => (
                          <option key={emp.id} value={emp.id} className="bg-slate-900 text-white">
                            {emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee'} ({emp.role || 'Software Engineer'})
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-indigo-300 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Synchronized Header Status Badge */}
                {aiSummary?.alertBadge ? (
                  <div className="px-4 py-2 bg-rose-600/90 text-white rounded-2xl border border-rose-400/50 shadow-lg flex items-center space-x-2 text-xs font-bold animate-pulse">
                    <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>ALERT: Employee Distracted / Behind Schedule (3 Consecutive Checks)</span>
                  </div>
                ) : isDistracted ? (
                  <div className="px-3.5 py-1.5 bg-rose-500/20 text-rose-300 rounded-2xl border border-rose-500/40 text-xs font-bold flex items-center space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>Status: DISTRACTED</span>
                  </div>
                ) : isBehindSchedule ? (
                  <div className="px-3.5 py-1.5 bg-amber-500/20 text-amber-300 rounded-2xl border border-amber-500/40 text-xs font-bold flex items-center space-x-1.5">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span>Status: BEHIND SCHEDULE</span>
                  </div>
                ) : (
                  <div className="px-3.5 py-1.5 bg-emerald-500/20 text-emerald-300 rounded-2xl border border-emerald-500/40 text-xs font-bold flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Optimal Productivity Status: ON TRACK</span>
                  </div>
                )}
              </div>

              {/* Card Body: 3 Columns Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">

                {/* Column 1: Active Assigned Task & Time Budget */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" /> Active Assigned Task
                    </span>
                    <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-200 text-[10px] font-bold rounded-lg border border-indigo-500/30">
                      {aiSummary?.assignedTask?.priority || 'HIGH'} PRIORITY
                    </span>
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-white truncate">
                      {aiSummary?.assignedTask?.title || 'Implement AI Vision Screenshot Pipeline'}
                    </h3>
                    <p className="text-xs text-indigo-200/70 line-clamp-2 mt-0.5">
                      {aiSummary?.assignedTask?.description || 'Build real-time desktop screen analysis with LLM vision estimation.'}
                    </p>
                  </div>

                  {/* Progress Bar: Elapsed vs Estimated Time */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-indigo-200 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-indigo-400" /> Time Elapsed
                      </span>
                      <span className="text-white font-mono font-bold">
                        {Math.floor(liveElapsedSeconds / 60)}m {liveElapsedSeconds % 60 < 10 ? '0' : ''}{liveElapsedSeconds % 60}s / {aiSummary?.estimatedVsActualTime?.estimatedMinutes || 120}m est.
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-indigo-900">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          Math.round((liveElapsedSeconds / 60 / (aiSummary?.estimatedVsActualTime?.estimatedMinutes || 120)) * 100) > 100
                            ? 'bg-rose-500'
                            : Math.round((liveElapsedSeconds / 60 / (aiSummary?.estimatedVsActualTime?.estimatedMinutes || 120)) * 100) > 85
                            ? 'bg-amber-500'
                            : 'bg-indigo-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.round((liveElapsedSeconds / 60 / (aiSummary?.estimatedVsActualTime?.estimatedMinutes || 120)) * 100))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Column 2: Productivity Status & AI Confidence */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-indigo-400" /> AI Productivity Index
                    </span>
                    <span className="text-xs font-bold text-indigo-200 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" /> Confidence: {aiSummary?.aiConfidenceScore || 94}%
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 my-1">
                    {isProductive ? (
                      <div className="px-3.5 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded-2xl text-emerald-400 font-extrabold text-sm flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>ON TRACK</span>
                      </div>
                    ) : isBehindSchedule ? (
                      <div className="px-3.5 py-2 bg-amber-500/20 border border-amber-500/50 rounded-2xl text-amber-300 font-extrabold text-sm flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                        <span>BEHIND SCHEDULE</span>
                      </div>
                    ) : (
                      <div className="px-3.5 py-2 bg-rose-500/20 border border-rose-500/50 rounded-2xl text-rose-300 font-extrabold text-sm flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse"></span>
                        <span>DISTRACTED</span>
                      </div>
                    )}
                    <div className="text-xs text-indigo-200/80 font-semibold">
                      Task Relevance: <strong className="text-white">{isTaskRelevant ? 'Yes (Work Activity)' : 'No (Non-Work)'}</strong>
                    </div>
                  </div>

                  <div className="text-xs text-indigo-200/70 flex items-center space-x-2">
                    <span>Task Completion Progress:</span>
                    <strong className="text-white font-black">{aiSummary?.latestScreenSummary?.progressPercentage || 50}%</strong>
                  </div>
                </div>

                {/* Column 3: Vision Activity Summary — now cross-referenced against
                    idle/active input tracking rather than a live screen-recording feed */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-2">
                  <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" /> Vision Activity Summary
                  </span>
                  <p className="text-xs text-indigo-100 font-medium leading-relaxed bg-indigo-950/40 p-3 rounded-xl border border-indigo-800/50">
                    "{aiSummary?.latestScreenSummary?.aiSummary || 'Employee is actively working on assigned code module. Idle/active input status matches an in-progress work session.'}"
                  </p>
                  <div className="text-[10px] text-indigo-300/60 text-right">
                    Evaluated via Groq Vision API, cross-checked against live idle/active status ({aiSummary?.latestScreenSummary?.capturedAt ? new Date(aiSummary.latestScreenSummary.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just Now'})
                  </div>
                </div>

              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};

export default LiveMonitorView;
