import React, { useState, useEffect } from 'react';
import { Radio, Monitor, Wifi, Eye, RefreshCw, X, Zap, ShieldCheck, Database, Play, AlertTriangle, CheckCircle2, Clock, Brain, Sparkles, Activity, Layers, ChevronDown } from 'lucide-react';
import { captureRealLiveDesktopScreen, useEmployee } from './EmployeeContext';
import { socketService } from './src/services/socket.service';

interface LiveMonitorStreamItem {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  activeApp: string;
  windowTitle: string;
  fps: number;
  status: 'Live Streaming' | 'Idle' | 'Paused';
  imageUrl: string;
  timestamp: string;
}

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
  const [activeModalStream, setActiveModalStream] = useState<LiveMonitorStreamItem | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [autoRefreshCounter, setAutoRefreshCounter] = useState<number>(10); // 10s live stream frame ticker
  const [aiSummary, setAiSummary] = useState<AiSummaryData | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState<number>(2700);

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

  // Live Streams State (Fetched dynamically from MongoDB User collection)
  const [streams, setStreams] = useState<LiveMonitorStreamItem[]>([]);
  const [registeredEmployeesList, setRegisteredEmployeesList] = useState<any[]>([]);

  // Fetch registered employees from MongoDB API
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

        if (list.length > 0) {
          if (!selectedEmployeeId) {
            setSelectedEmployeeId(list[0].id);
          }

          const mappedStreams: LiveMonitorStreamItem[] = list.map((emp: any, idx: number) => ({
            id: `stream-${emp.id || idx}`,
            userId: emp.id,
            userName: emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Registered Employee',
            userRole: emp.role || 'Full Stack Engineer',
            activeApp: 'Employee Portal - Active Workstation',
            windowTitle: 'WorkTrackPro Dashboard - Active Shift Screen',
            fps: 30,
            status: emp.status === 'ACTIVE' ? 'Live Streaming' : 'Idle',
            imageUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=800&q=80',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));
          setStreams(mappedStreams);
        } else {
          setStreams([]);
        }
      }
    } catch (e) {
      console.warn('Employees fetch error:', e);
    }
  };

  const getDisplayImageUrl = (url: string | undefined | null) => {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('/api/v1/') || url.startsWith('/screenshots/file/') || url.startsWith('/recordings/stream/')) {
      return `http://localhost:3000${url}`;
    }
    return url;
  };

  // Sync latest MongoDB screenshot feed into registered user streams
  const syncLiveFeeds = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/v1/screenshots/feed');
      if (res.ok) {
        const mongoList = await res.json();
        const list = Array.isArray(mongoList)
          ? mongoList
          : Array.isArray(mongoList?.data)
            ? mongoList.data
            : [];

        if (list.length > 0) {
          const latestByUser = new Map<string, any>();
          list.forEach((item: any) => {
            if (!item?.userId) return;
            const existing = latestByUser.get(item.userId);
            const existingTime = existing?.isoTimestamp || existing?.timestamp;
            const itemTime = item?.isoTimestamp || item?.timestamp || new Date().toISOString();
            if (!existing || new Date(itemTime).getTime() > new Date(existingTime).getTime()) {
              latestByUser.set(item.userId, item);
            }
          });

          setStreams(prev => {
            if (prev.length > 0) {
              return prev.map(st => {
                const latestShot = latestByUser.get(st.userId);
                if (latestShot) {
                  return {
                    ...st,
                    imageUrl: getDisplayImageUrl(latestShot.imageUrl || st.imageUrl),
                    timestamp: latestShot.timestamp || st.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    windowTitle: latestShot.activeWindowName || st.windowTitle,
                    status: 'Live Streaming',
                  };
                }
                return st;
              });
            }

            return Array.from(latestByUser.values()).map((item, idx) => ({
              id: item.id || `stream-${idx}`,
              userId: item.userId || `user-${idx}`,
              userName: item.userName || `Registered Employee`,
              userRole: item.userRole || 'Full Stack Engineer',
              activeApp: item.activeWindowName || 'Employee Portal - Active Workstation',
              windowTitle: item.activeWindowName || 'Employee Portal - Active Workstation',
              fps: 30,
              status: 'Live Streaming',
              imageUrl: getDisplayImageUrl(item.imageUrl),
              timestamp: item.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }));
          });
        }
      }
    } catch (e) {
      console.log('Live monitor feed sync fallback:', e);
    }
  };

  useEffect(() => {
    fetchRegisteredEmployees();
    syncLiveFeeds();

    // 10-second ticker loop to sync live frames
    const ticker = setInterval(() => {
      setAutoRefreshCounter(prev => {
        if (prev <= 1) {
          syncLiveFeeds();
          fetchRegisteredEmployees();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    // Listen for cross-tab BroadcastChannel events
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('stitch_screen_capture_channel');
      bc.onmessage = (e) => {
        if (e.data && e.data.type === 'REAL_SCREENSHOT_CAPTURED') {
          syncLiveFeeds();
          if (selectedEmployeeId) {
            fetchAiSummary(selectedEmployeeId);
          }
        }
      };
    }

    return () => {
      clearInterval(ticker);
      if (bc) bc.close();
    };
  }, [selectedEmployeeId]);

  // Force Immediate Live Capture for Target Employee
  const triggerLiveFrameRefresh = async (targetUserId?: string) => {
    const activeId = targetUserId || selectedEmployeeId || 'emp-101';
    setIsRefreshing(true);
    setToastMessage('Triggering live frame capture & streaming to Manager socket room...');

    try {
      const realImg = await captureRealLiveDesktopScreen('umer Sohail', 'Full Stack Engineer');
      if (!realImg) {
        console.warn('Live frame refresh skipped: no real screenshot available.');
        return;
      }

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Send to MongoDB Atlas
      await fetch('http://localhost:3000/api/v1/screenshots/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'umer Sohail',
          userId: activeId,
          userRole: 'Full Stack Engineer',
          imageUrl: realImg,
          activeWindowName: 'Employee Portal - Active Workstation Screen',
          timestamp: timeStr,
          date: new Date().toISOString().split('T')[0],
          isIdle: false,
        }),
      });

      setStreams(prev => prev.map(st => {
        if (st.userId === activeId) {
          return {
            ...st,
            imageUrl: realImg,
            timestamp: timeStr,
            status: 'Live Streaming',
          };
        }
        return st;
      }));

      await fetchAiSummary(activeId);
      setToastMessage('Live frame captured and stream updated!');
    } catch (e) {
      console.error('Live refresh error:', e);
    } finally {
      setIsRefreshing(false);
      setAutoRefreshCounter(10);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 bg-rose-50 dark:bg-rose-950/50 px-3 py-1 rounded-full text-xs font-bold text-rose-600 dark:text-rose-400 mb-2 border border-rose-200/60 dark:border-rose-800/60">
            <Radio className="w-3.5 h-3.5 animate-pulse text-rose-500" />
            <span className="uppercase tracking-wider">Socket.IO Gateway Live Monitor</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Active Employee Workstation Live Feeds</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">Real-time low-latency desktop screen streaming for active employee workstations (*umer Sohail*).</p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded-2xl text-xs font-bold text-indigo-600 dark:text-indigo-300 flex items-center space-x-2">
            <RefreshCw className={`w-4 h-4 text-indigo-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Live Ticker: <strong>{autoRefreshCounter}s</strong></span>
          </div>

          <button
            onClick={() => triggerLiveFrameRefresh(selectedEmployeeId || undefined)}
            disabled={isRefreshing}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-2xl flex items-center space-x-2 shadow-lg shadow-rose-500/25 transition-all cursor-pointer disabled:opacity-50"
          >
            <Zap className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : 'text-amber-300'}`} />
            <span>{isRefreshing ? 'Capturing...' : 'Force Live Frame Now'}</span>
          </button>
        </div>
      </div>

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

                {/* Column 3: Latest LLM Vision Activity Summary */}
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-indigo-800/40 flex flex-col justify-between space-y-2">
                  <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" /> Vision Activity Summary
                  </span>
                  <p className="text-xs text-indigo-100 font-medium leading-relaxed bg-indigo-950/40 p-3 rounded-xl border border-indigo-800/50">
                    "{aiSummary?.latestScreenSummary?.aiSummary || 'Employee is actively working on assigned code module. Active window context matches work session.'}"
                  </p>
                  <div className="text-[10px] text-indigo-300/60 text-right">
                    Evaluated via Groq Vision API ({aiSummary?.latestScreenSummary?.capturedAt ? new Date(aiSummary.latestScreenSummary.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just Now'})
                  </div>
                </div>

              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast Alert */}
      {toastMessage && (
        <div className="p-4 bg-rose-600 text-white rounded-2xl shadow-xl flex items-center space-x-3 text-xs font-bold animate-bounce">
          <Radio className="w-4 h-4 text-amber-300 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Grid of Live Desktop Streams */}
      {streams.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 border border-slate-200/80 dark:border-slate-800 text-center space-y-3 shadow-sm">
          <Monitor className="w-12 h-12 text-indigo-500 mx-auto" />
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white">No Registered Employees Found</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            No registered employees found in the database. New user signups will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {streams.map((st) => (
          <div 
            key={st.id} 
            onClick={() => setSelectedEmployeeId(st.userId)}
            className={`bg-white dark:bg-slate-900 rounded-3xl border shadow-sm overflow-hidden flex flex-col justify-between transition-all cursor-pointer hover:shadow-md ${
              st.userId === selectedEmployeeId 
                ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-indigo-500/20 shadow-lg' 
                : 'border-slate-200/80 dark:border-slate-800'
            }`}
          >
            
            {/* Stream Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                  {st.userName.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <h3 className="font-extrabold text-xs text-slate-800 dark:text-white flex items-center space-x-2">
                    <span>{st.userName}</span>
                    {st.userId === selectedEmployeeId && (
                      <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] rounded-full font-extrabold flex items-center gap-1 shadow-sm">
                        <Sparkles className="w-2.5 h-2.5 text-amber-300" /> FOCUSED IN SUMMARY
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">{st.userRole}</p>
                </div>
              </div>

              {st.status === 'Live Streaming' ? (
                <span className="px-2.5 py-1 bg-rose-500 text-white font-extrabold text-[10px] rounded-full flex items-center space-x-1 animate-pulse shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                  <span>LIVE ({st.fps} FPS)</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold rounded-full">
                  IDLE
                </span>
              )}
            </div>

            {/* Stream Preview Image */}
            <div 
              className="relative aspect-video bg-slate-950 overflow-hidden group cursor-pointer"
              onClick={() => setActiveModalStream(st)}
            >
              <img 
                src={st.imageUrl} 
                alt={st.userName} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-95"
              />

              {/* Hover Overlay with Watch Live Icon */}
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center text-white space-y-2">
                <div className="p-3 bg-rose-600 rounded-full text-white shadow-xl animate-pulse">
                  <Eye className="w-6 h-6" />
                </div>
                <span className="text-xs font-extrabold tracking-wide">Watch Live Screen Stream</span>
              </div>

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent p-4 flex flex-col justify-end">
                <p className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <Monitor className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{st.activeApp}</span>
                </p>
                <p className="text-[11px] text-slate-300 truncate mt-0.5">{st.windowTitle}</p>
              </div>

              <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-md text-white px-2.5 py-1 rounded-lg text-[10px] font-bold border border-white/10">
                Last Frame: {st.timestamp}
              </div>
            </div>

            {/* Stream Footer Actions */}
            <div className="p-3 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-1.5 text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span className="font-semibold text-[11px]">Socket.IO Room Subscribed</span>
              </div>

              <button
                onClick={() => setActiveModalStream(st)}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 font-extrabold text-[11px] rounded-xl flex items-center space-x-1 transition-all cursor-pointer"
              >
                <Play className="w-3 h-3" />
                <span>Expand Live Stream</span>
              </button>
            </div>

          </div>
        ))}
      </div>
      )}

      {/* Modal: High-Resolution Live Monitor */}
      {activeModalStream && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-rose-600 text-white font-bold text-xs flex items-center justify-center shadow-md">
                  {activeModalStream.userName.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center space-x-2">
                    <span>Live Desktop Monitor — {activeModalStream.userName}</span>
                    <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full animate-pulse">
                      LIVE STREAMING
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">{activeModalStream.userRole} · {activeModalStream.windowTitle}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => triggerLiveFrameRefresh(activeModalStream.userId)}
                  disabled={isRefreshing}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Zap className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isRefreshing ? 'Refreshing...' : 'Refresh Frame'}</span>
                </button>

                <button 
                  onClick={() => setActiveModalStream(null)}
                  className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* High Resolution Live Stream Display */}
            <div className="flex-1 overflow-auto bg-slate-950 p-4 flex items-center justify-center">
              <img 
                src={activeModalStream.imageUrl} 
                alt="Live Stream Frame" 
                className="max-w-full max-h-[72vh] object-contain rounded-xl shadow-2xl"
              />
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-emerald-500" />
                <span>Socket.IO Channel Room: <code className="text-indigo-400 font-mono">live_room_{activeModalStream.userId}</code></span>
              </div>

              <div className="flex items-center space-x-3">
                <span className="font-bold text-slate-400">Frame Timestamp: {activeModalStream.timestamp}</span>
                <button 
                  onClick={() => setActiveModalStream(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl"
                >
                  Close Live View
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default LiveMonitorView;
