import React, { useState, useEffect } from 'react';
import { Eye, AlertTriangle, CheckCircle2, Clock, Brain, Sparkles, Activity, Layers, ChevronDown, MonitorSmartphone, Building2, UserX } from 'lucide-react';
import { useEmployee } from './EmployeeContext';
import { socketService } from './src/services/socket.service';

interface AiSummaryData {
  userId: string;
  employeeName: string;
  employeeEmail: string;
  department: string | null;
  isActive: boolean;
  hasAnalysis: boolean;
  assignedTask: {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    estimatedTimeMinutes: number;
    actualTimeMinutes: number;
    startedAt: string;
  } | null;
  estimatedVsActualTime: {
    estimatedMinutes: number | null;
    actualMinutes: number | null;
    elapsedMinutes: number | null;
    percentageTimeUsed: number | null;
  };
  aiConfidenceScore: number | null;
  latestScreenSummary: {
    aiSummary: string;
    progressPercentage: number | null;
    status: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE';
    isTaskRelevant: boolean | null;
    capturedAt: string | null;
    imageUrl?: string;
    // "What the LLM actually sees" - the raw detected window/apps, distinct
    // from aiSummary's one-sentence interpretation. Only ever populated by
    // a live WebSocket push (Screenshot rows don't persist these two
    // fields - see monitor.service.ts's persist:false live-only path).
    activeWindow?: string;
    detectedApps?: string[];
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

    // 1. Initial Fetch when employee is selected - a one-time DB read so
    // the card isn't empty for the first ~10s before the first live
    // WebSocket push arrives.
    fetchAiSummary(selectedEmployeeId);

    // A recurring poll used to re-fetch this same DB read every 60s and
    // fully replace the card's state with it (setAiSummary(data), not a
    // merge). Since the live 10-second capture loop deliberately never
    // persists to the database (persist:false - see monitor.service.ts,
    // avoids flooding the Screenshot gallery), that DB read always came
    // back with "no analysis yet" - so every 60s this was overwriting
    // perfectly good live data with an empty state, which is exactly the
    // "shows briefly then disappears" symptom this was reported as. The
    // WebSocket below is the actual real-time channel; nothing here needs
    // to re-poll the database on a timer.

    // 2. Socket.IO Real-Time Listener via centralized socketService
    let handleEmployeeUpdate: ((data: any) => void) | null = null;

    try {
      socketService.subscribe(selectedEmployeeId);

      handleEmployeeUpdate = (data: any) => {
        console.log('[Socket.IO] Real-time activity update received for employee:', data);
        if (data) {
          setAiSummary((prev: any) => ({
            ...prev,
            department: data.department ?? prev?.department ?? null,
            isActive: data.employeeIsActive ?? prev?.isActive ?? true,
            hasAnalysis: true,
            productivityStatus: data.status === 'OFF TASK' ? 'DISTRACTED' : data.status === 'IDLE' ? 'IDLE' : 'ON_TRACK',
            aiConfidenceScore: typeof data.confidenceScore === 'number' ? data.confidenceScore : (prev?.aiConfidenceScore ?? null),
            latestScreenSummary: {
              aiSummary: data.summary || prev?.latestScreenSummary?.aiSummary || 'Desktop screen context analyzed',
              progressPercentage: typeof data.confidenceScore === 'number' ? data.confidenceScore : (prev?.latestScreenSummary?.progressPercentage ?? null),
              status: data.status,
              isTaskRelevant: data.taskRelevance !== 'No',
              capturedAt: data.timestamp || new Date(),
              imageUrl: data.imageUrl || prev?.latestScreenSummary?.imageUrl,
              activeWindow: data.activeWindow || prev?.latestScreenSummary?.activeWindow,
              detectedApps: Array.isArray(data.detectedApps) ? data.detectedApps : prev?.latestScreenSummary?.detectedApps,
            },
          }));
        }
      };

      // Only the employee-scoped channel is needed here - 'live:feed' is a
      // second, broadcast-to-everyone channel carrying the exact same
      // payload as this one, and its only effect in this component was to
      // immediately trigger a DB re-fetch (see the note above) right after
      // this handler had just correctly merged the live data in - the two
      // listeners were fighting over the same event on every single
      // 10-second cycle.
      socketService.on(`employee:update:${selectedEmployeeId}`, handleEmployeeUpdate);
    } catch (e) {
      console.warn('Socket connection error:', e);
    }

    // Cleanup socket listener on unmount or user change
    return () => {
      if (handleEmployeeUpdate) socketService.off(`employee:update:${selectedEmployeeId}`, handleEmployeeUpdate);
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

        // Functional update reading the CURRENT selection, not the value
        // closed over when this effect's setInterval was created (that
        // closure only ever saw selectedEmployeeId's initial null forever,
        // since the effect below has an empty dependency array - every
        // 30s poll was silently resetting the dropdown back to whichever
        // employee the backend returns first, discarding the manager's
        // actual selection every cycle).
        if (list.length > 0) {
          setSelectedEmployeeId((prev) => prev || list[0].id);
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

      {/* ========== LIVE MANAGER SUMMARY CARD (LLM PRODUCTIVITY INDEX) ========== */}
      {(() => {
        const isResigned = aiSummary?.isActive === false;
        const hasAnalysis = !!aiSummary?.hasAnalysis;
        const isTaskRelevant = aiSummary?.latestScreenSummary?.isTaskRelevant !== false;
        const rawStatus = aiSummary?.productivityStatus || 'IDLE';
        const isDistracted = hasAnalysis && (!isTaskRelevant || rawStatus === 'DISTRACTED');
        const isBehindSchedule = hasAnalysis && !isDistracted && rawStatus === 'BEHIND_SCHEDULE';
        const isProductive = hasAnalysis && !isDistracted && !isBehindSchedule;

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
                    {/* Department badge - real, from MongoDB, used to give
                        the vision LLM job-appropriate context rather than
                        judging every screen the same way. */}
                    {aiSummary?.department && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800/80 border border-slate-700 rounded-lg text-[10px] font-bold text-slate-300">
                        <Building2 className="w-3 h-3 text-indigo-400" /> {aiSummary.department}
                      </span>
                    )}
                  </div>
                </div>

                {/* Synchronized Header Status Badge */}
                {isResigned ? (
                  <div className="px-3.5 py-1.5 bg-slate-700/40 text-slate-300 rounded-2xl border border-slate-600/50 text-xs font-bold flex items-center space-x-1.5">
                    <UserX className="w-4 h-4 text-slate-400" />
                    <span>Resigned - Not Monitored</span>
                  </div>
                ) : !hasAnalysis ? (
                  <div className="px-3.5 py-1.5 bg-slate-700/40 text-slate-300 rounded-2xl border border-slate-600/50 text-xs font-bold flex items-center space-x-1.5">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <span>Awaiting First Analysis...</span>
                  </div>
                ) : aiSummary?.alertBadge ? (
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

              {/* Card Body: 4 Columns Grid - the 4th ("What The LLM Sees")
                  surfaces the raw detected window/apps distinctly from the
                  interpreted one-sentence summary next to it, per the
                  explicit ask for both. Department/resignation context
                  already sits in the header above. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">

                {/* Column 1: Active Assigned Task & Time Budget */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" /> Active Assigned Task
                    </span>
                    {aiSummary?.assignedTask && (
                      <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-200 text-[10px] font-bold rounded-lg border border-indigo-500/30">
                        {aiSummary.assignedTask.priority} PRIORITY
                      </span>
                    )}
                  </div>
                  {aiSummary?.assignedTask ? (
                    <>
                      <div>
                        <h3 className="font-extrabold text-sm text-white truncate">
                          {aiSummary.assignedTask.title}
                        </h3>
                        <p className="text-xs text-indigo-200/70 line-clamp-2 mt-0.5">
                          {aiSummary.assignedTask.description}
                        </p>
                      </div>

                      {/* Progress Bar: Elapsed vs Estimated Time */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-indigo-200 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" /> Time Elapsed
                          </span>
                          <span className="text-white font-mono font-bold">
                            {Math.floor(liveElapsedSeconds / 60)}m {liveElapsedSeconds % 60 < 10 ? '0' : ''}{liveElapsedSeconds % 60}s / {aiSummary.estimatedVsActualTime?.estimatedMinutes ?? '--'}m est.
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-indigo-900">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              !aiSummary.estimatedVsActualTime?.estimatedMinutes ? 'bg-indigo-500' :
                              Math.round((liveElapsedSeconds / 60 / aiSummary.estimatedVsActualTime.estimatedMinutes) * 100) > 100
                                ? 'bg-rose-500'
                                : Math.round((liveElapsedSeconds / 60 / aiSummary.estimatedVsActualTime.estimatedMinutes) * 100) > 85
                                ? 'bg-amber-500'
                                : 'bg-indigo-500'
                            }`}
                            style={{ width: `${aiSummary.estimatedVsActualTime?.estimatedMinutes ? Math.min(100, Math.round((liveElapsedSeconds / 60 / aiSummary.estimatedVsActualTime.estimatedMinutes) * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-indigo-300/60 italic py-2">No task currently assigned to this employee.</p>
                  )}
                </div>

                {/* Column 2: Productivity Status & AI Confidence */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-indigo-400" /> AI Productivity Index
                    </span>
                    <span className="text-xs font-bold text-indigo-200 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" /> Confidence: {aiSummary?.aiConfidenceScore != null ? `${aiSummary.aiConfidenceScore}%` : 'N/A'}
                    </span>
                  </div>

                  {hasAnalysis ? (
                    <>
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
                        <strong className="text-white font-black">{aiSummary?.latestScreenSummary?.progressPercentage != null ? `${aiSummary.latestScreenSummary.progressPercentage}%` : 'N/A'}</strong>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-indigo-300/60 italic py-2">
                      {isResigned ? 'Not monitored - employee has resigned.' : 'No AI vision analysis yet - waiting for the next screenshot.'}
                    </p>
                  )}
                </div>

                {/* Column 3: Vision Activity Summary - the interpreted
                    one-sentence read of what's happening */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-2">
                  <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" /> Vision Activity Summary
                  </span>
                  <p className="text-xs text-indigo-100 font-medium leading-relaxed bg-indigo-950/40 p-3 rounded-xl border border-indigo-800/50">
                    "{aiSummary?.latestScreenSummary?.aiSummary || 'No AI vision analysis available yet.'}"
                  </p>
                  <div className="text-[10px] text-indigo-300/60 text-right">
                    Evaluated via Gemini Vision API ({aiSummary?.latestScreenSummary?.capturedAt ? new Date(aiSummary.latestScreenSummary.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not yet'})
                  </div>
                </div>

                {/* Column 4: What The LLM Actually Sees - the raw detected
                    window/app list, distinct from Column 3's interpreted
                    summary. Live-only (not persisted on the Screenshot
                    row), so this only ever has data right after a live
                    WebSocket push, not from the initial polled fetch. */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-2">
                  <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                    <MonitorSmartphone className="w-3.5 h-3.5 text-indigo-400" /> What The LLM Sees
                  </span>
                  {aiSummary?.latestScreenSummary?.activeWindow || (aiSummary?.latestScreenSummary?.detectedApps?.length ?? 0) > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-indigo-100">
                        <span className="text-indigo-300/70">Active Window: </span>
                        <span className="font-bold">{aiSummary?.latestScreenSummary?.activeWindow || 'Unknown'}</span>
                      </div>
                      {(aiSummary?.latestScreenSummary?.detectedApps?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {aiSummary!.latestScreenSummary!.detectedApps!.map((app, i) => (
                            <span key={i} className="px-2 py-0.5 bg-indigo-950/60 border border-indigo-800/60 rounded-lg text-[10px] font-semibold text-indigo-200">
                              {app}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-indigo-300/60 italic py-2">
                      {isResigned ? 'Not monitored - employee has resigned.' : 'No live detection data yet - updates every 10 seconds while this employee is checked in.'}
                    </p>
                  )}
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
