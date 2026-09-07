import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { apiService } from './src/services/api.service';
import { productivityApiService } from './src/services/productivityApi.service';
import { useShiftSummary } from './src/hooks/useShiftSummary';
import { SHIFT_STATE_CHANGED_EVENT } from './src/hooks/useIdleTimeSummary';

/** Lets the "Today, per employee" table (a separate poll on a separate
 * hook, useIdleTimeSummary) refetch immediately instead of waiting up to
 * a full 20s poll cycle after this employee's own check-in/out/break
 * action changes their status. Only helps within the same renderer. */
function notifyShiftStateChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHIFT_STATE_CHANGED_EVENT));
  }
}

// How many screenshot entries to keep in each localStorage-persisted list.
// These are just a "quick paint before the network fetch resolves" cache -
// the real source of truth is the backend's /screenshots/feed - so a small
// cap costs nothing functionally.
const MAX_PERSISTED_SCREENSHOTS = 20;

// Root cause of the QuotaExceededError crashes: entries here carry a full
// base64 imageUrl (screenshots are routinely 100s of KB to a few MB each),
// and the lists they were kept in had no size cap, so a work session with
// many captures reliably blew past localStorage's ~5-10MB per-origin quota.
// Persisted copies never need the image bytes themselves - only the
// in-memory React state (which callers still get in full) needs that for
// immediate rendering; anything reloading from localStorage or the backend
// feed gets the real image via a fresh URL anyway.
function stripImageDataForPersistence<T extends { imageUrl?: string }>(item: T): T {
  if (!item || !item.imageUrl) return item;
  return { ...item, imageUrl: '' };
}

/**
 * localStorage.setItem, but survives QuotaExceededError by dropping the
 * oldest half of `list` and retrying once rather than losing the write (and
 * whatever offline-queue/state update depended on it) entirely. Always
 * strips image data first since that's what makes these payloads large
 * enough to hit the quota in the first place.
 */
function safeSetListItem(key: string, list: any[], maxLength: number = MAX_PERSISTED_SCREENSHOTS): void {
  const trimmed = list.slice(0, maxLength).map(stripImageDataForPersistence);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch (e) {
    console.warn(`[localStorage] setItem('${key}') failed (quota?), retrying with half the entries:`, e);
    try {
      const half = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)));
      localStorage.setItem(key, JSON.stringify(half));
    } catch (e2) {
      console.warn(`[localStorage] retry for '${key}' also failed, giving up on this write:`, e2);
    }
  }
}

/**
 * Root cause of "emps.find is not a function": /api/v1/employees/all
 * responds through the backend's global TransformInterceptor, which wraps
 * every payload as { success, data, message } - and this particular
 * endpoint's own data is itself { totalCount, activeCount, data: [...] }.
 * So the real employee array lives at json.data.data, not json.data - this
 * always mis-parsed to the wrapper object (never an array) regardless of
 * online/offline state, not just as an offline-fallback edge case. Handles
 * all three shapes other components in this codebase already tolerate
 * (bare array / json.data.data / json.data), and - per the ask - never
 * hands back anything but a real array so a caller's .find()/.filter()
 * can't blow up on it.
 */
function extractEmployeeArray(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

/**
 * Same idea as safeSetListItem, but for the whole employee `state` object
 * (persisted under 'stitch_employee_state'), whose `screenshots` field is
 * the part that was actually growing unbounded with full image data.
 */
function safeSetEmployeeState(state: any): void {
  const slim = {
    ...state,
    screenshots: Array.isArray(state?.screenshots)
      ? state.screenshots.slice(0, MAX_PERSISTED_SCREENSHOTS).map(stripImageDataForPersistence)
      : state?.screenshots,
  };
  try {
    localStorage.setItem('stitch_employee_state', JSON.stringify(slim));
  } catch (e) {
    console.warn('[localStorage] setItem(\'stitch_employee_state\') failed (quota?), retrying with screenshots dropped entirely:', e);
    try {
      localStorage.setItem('stitch_employee_state', JSON.stringify({ ...slim, screenshots: [] }));
    } catch (e2) {
      console.warn('[localStorage] retry for \'stitch_employee_state\' also failed, giving up on this write:', e2);
    }
  }
}

export interface UserProfile {
  id?: string; // real MongoDB User id - was captured in the login response and then discarded; needed to correctly attribute screenshots/vision analysis to whoever is actually logged in, instead of a hardcoded placeholder
  name: string;
  email: string;
  role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  avatar: string;
}

export interface SessionState {
  isActive: boolean;
  startTime: string | null;
  elapsedSeconds: number;
  breakSeconds: number;
  status: 'Not Checked In' | 'Present' | 'Late' | 'On Break' | 'Checked Out';
}

export interface MetricsState {
  todayHoursSeconds: number;
  targetHoursSeconds: number; // 28800 (8 Hours)
  activeTimeSeconds: number;
  completedTasks: number;
  totalTasksAssigned: number;
  productivityScore: number; // Dynamic formula
  attendanceRate: number; // Dynamic formula
}

export interface AttendanceRecordItem {
  id: string;
  date: string;
  checkIn: string;
  checkOut: string;
  break: string;
  totalHours: string;
  status: 'Present' | 'Late' | 'Absent' | 'Half Day' | 'Holiday' | 'Leave';
}

export interface SessionRecordItem {
  id: string;
  date: string;
  start: string;
  end: string;
  duration: string;
  breaks: string;
  status: 'Completed' | 'Absent' | 'Half Day';
}

export interface ScreenshotRecordItem {
  id: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  timestamp: string;
  timeAgo: string;
  activeApp: string;
  windowTitle: string;
  keyboardActivity: number;
  mouseActivity: number;
  imageUrl: string;
  verified: boolean;
  date?: string;
  isIdle?: boolean;
  screenshotNumber?: number;
  totalTodayCount?: number;
  syncStatus?: 'ONLINE' | 'QUEUED_OFFLINE';
}

export interface DayHours {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  hours: number;
}

export interface EmployeeContextType {
  user: UserProfile;
  session: SessionState;
  metrics: MetricsState;
  attendanceHistory: AttendanceRecordItem[];
  sessionHistory: SessionRecordItem[];
  screenshots: ScreenshotRecordItem[];
  weeklyHoursData: DayHours[];
  // The productivity_service (Supabase) employee id - the key everything
  // in useShiftSummary/idleTimeTracker/presenceDetector is keyed on. Set
  // once dashboard.tsx's login bootstrap resolves it via registerEmployee.
  productivityEmployeeId: string | null;
  setProductivityEmployeeId: (id: string) => void;

  // Actions
  handleCheckIn: () => void;
  handleCheckOut: () => void;
  handleToggleBreak: () => void;
  handleCompleteTask: () => void;
  registerNewEmployee: (firstName: string, lastName: string, email: string, role: 'EMPLOYEE' | 'MANAGER', password?: string, department?: string) => Promise<void>;
  loginEmployee: (email: string, password?: string, requestedRole?: 'EMPLOYEE' | 'MANAGER') => Promise<boolean>;
}

// Maps the backend's richer shift/idle status enum down into this
// context's existing SessionState.status vocabulary, so every component
// that already reads session.status (AttendanceActionCards, WorkSessionScreen,
// dashboard.tsx) keeps working unchanged.
function mapBackendStatusToSessionStatus(status: string): SessionState['status'] {
  switch (status) {
    case 'NOT_CHECKED_IN':
      return 'Not Checked In';
    case 'CHECKED_OUT':
      return 'Checked Out';
    case 'ON_BREAK':
      return 'On Break';
    default:
      // ACTIVE | ACTIVE_JABBER | ACTIVE_WILDIX | IDLE | AWAY - all "checked
      // in and not on break" states collapse to 'Present', matching the
      // pre-existing vocabulary (only 4 statuses were ever actually used).
      return 'Present';
  }
}

const getInitials = (n: string) => {
  const parts = n.trim().split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return n.slice(0, 2).toUpperCase() || 'EM';
};

/**
 * Real PC Screen Capture Engine (Electron Native)
 */
export async function captureRealLiveDesktopScreen(userName: string = 'umer Sohail', userRole: string = 'Full Stack Engineer'): Promise<string> {
  if (typeof window === 'undefined' || !(window as any).require) {
    console.warn('Electron API unavailable: skipping real screenshot capture.');
    return '';
  }

  try {
    const electron = (window as any).require('electron');
    const ipcRenderer = electron.ipcRenderer;

    if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
      const result = await ipcRenderer.invoke('trigger-manual-capture', undefined, userName, userRole);
      if (result?.success && result?.record?.imageUrl) {
        return result.record.imageUrl;
      }
    }

    const desktopCapturer = electron.desktopCapturer;
    if (desktopCapturer) {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (sources && sources.length > 0) {
        return sources[0].thumbnail.toDataURL();
      }
    }
  } catch (e) {
    console.warn('Electron screenshot capture failed:', e);
  }

  console.warn('No real desktop screenshot captured; skipping placeholder image.');
  return '';
}

// Baseline State
const getNewSignupBaseline = (
  firstName: string = 'umer', 
  lastName: string = 'Sohail', 
  email: string = 'employee@stitchmonitor.com',
  role: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE'
) => {
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  return {
    user: {
      name: fullName,
      email: email,
      role: role,
      avatar: getInitials(fullName),
    },
    session: {
      isActive: false,
      startTime: null,
      elapsedSeconds: 0,
      breakSeconds: 0,
      status: 'Not Checked In' as const,
    },
    metrics: {
      todayHoursSeconds: 0,
      targetHoursSeconds: 28800,
      activeTimeSeconds: 0,
      completedTasks: 0,
      totalTasksAssigned: 15,
      productivityScore: 0,
      attendanceRate: 0,
    },
    attendanceHistory: [] as AttendanceRecordItem[],
    sessionHistory: [] as SessionRecordItem[],
    screenshots: [] as ScreenshotRecordItem[],
    weeklyHoursData: [
      { day: 'Mon' as const, hours: 0 },
      { day: 'Tue' as const, hours: 0 },
      { day: 'Wed' as const, hours: 0 },
      { day: 'Thu' as const, hours: 0 },
      { day: 'Fri' as const, hours: 0 },
    ],
  };
};

const EmployeeContext = createContext<EmployeeContextType | undefined>(undefined);

export const EmployeeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem('stitch_employee_state');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.log('LocalStorage load fallback');
    }
    return getNewSignupBaseline('umer', 'Sohail', 'employee@stitchmonitor.com', 'EMPLOYEE');
  });

  const [productivityEmployeeId, setProductivityEmployeeId] = useState<string | null>(null);
  // Guards handleCheckIn/handleCheckOut against firing twice concurrently -
  // found via real shift_events data showing back-to-back duplicate
  // check_in/check_out rows (identical or near-identical timestamps, up to
  // 4 check-outs in a row with no check-in between) with no click-side
  // debounce to prevent it. A rapid double-click (or a slow network call
  // the user clicks through again before it resolves) could otherwise
  // corrupt the true check-in/check-out sequence the server relies on to
  // know whether someone is actually checked in - which is exactly what
  // then shows up as a mismatch between this employee's own optimistic
  // "Active" sidebar state and the real, event-log-derived status ("Away"/
  // "Checked Out") on the "Today, per employee" table.
  const shiftActionInFlightRef = useRef(false);
  // THE single source of truth for active/idle/break/shift-duration/status -
  // see productivityApi.service.ts's ShiftSummary and the backend's
  // ProductivityService.get_shift_summary(). Every other component showing
  // these numbers for one employee should read this same hook rather than
  // recomputing anything independently.
  const { summary: shiftSummary, refresh: refreshShiftSummary } = useShiftSummary(productivityEmployeeId);

  // Save state changes to localStorage
  useEffect(() => {
    try {
      safeSetEmployeeState(state);
    } catch (e) {
      console.log('LocalStorage save error:', e);
    }
  }, [state]);

  // STEP 3: TRANSMISSION & STORAGE LOGIC
  const broadcastSharedScreenshot = async (newScreenshot: ScreenshotRecordItem) => {
    try {
      // Update LocalStorage (capped + stripped of image data - see
      // safeSetListItem; the full-resolution image already goes out via
      // BroadcastChannel below for any currently-open tab, and the backend
      // feed is the real source of truth for anything reloading later)
      const existingStr = localStorage.getItem('stitch_shared_screenshots');
      const existingList = existingStr ? JSON.parse(existingStr) : [];
      const updatedList = [newScreenshot, ...existingList.filter((item: any) => item.id !== newScreenshot.id)];
      safeSetListItem('stitch_shared_screenshots', updatedList);

      // Broadcast over BroadcastChannel
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('stitch_screen_capture_channel');
        bc.postMessage({ type: 'REAL_SCREENSHOT_CAPTURED', screenshot: newScreenshot });
        bc.close();
      }

      // POST to NestJS backend -> Saves PNG file on disk & record in MongoDB Atlas collection Screenshot
      const apiRes = await fetch('http://localhost:3000/api/v1/screenshots/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: newScreenshot.userName || 'umer Sohail',
          userId: newScreenshot.userId || 'emp-101',
          userRole: newScreenshot.userRole || 'Full Stack Engineer',
          imageUrl: newScreenshot.imageUrl,
          activeWindowName: newScreenshot.windowTitle || 'Employee Portal - Active Workstation',
          timestamp: newScreenshot.timestamp,
          date: newScreenshot.date,
          isIdle: !!newScreenshot.isIdle,
        }),
      });

      if (apiRes.ok) {
        const savedDoc = await apiRes.json();
        if (savedDoc && savedDoc.imageUrl) {
          newScreenshot.imageUrl = savedDoc.imageUrl;
          newScreenshot.syncStatus = 'ONLINE';
        }
      }
    } catch (err) {
      console.warn('[Transmission] Offline / Backend unreachable. Saving to offline queue:', err);
      newScreenshot.syncStatus = 'QUEUED_OFFLINE';
    }
  };

  // STEP 1: AUTOMATIC TIMED TRIGGER (Every 5 Minutes)
  useEffect(() => {
    let fiveMinInterval: NodeJS.Timeout | null = null;

    if (state.session.isActive && state.user.role === 'EMPLOYEE') {
      const take5MinCapture = async () => {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const realCapturedImg = await captureRealLiveDesktopScreen(
          state.user.name || 'umer Sohail',
          'Full Stack Engineer'
        );

        if (!realCapturedImg) {
          console.warn('Skipping automated screenshot capture because no real screenshot was available.');
          return;
        }

        const newScreenshot: ScreenshotRecordItem = {
          id: `real-shot-${Date.now()}`,
          userId: 'emp-101',
          userName: state.user.name || 'umer Sohail',
          userRole: 'Full Stack Engineer',
          timestamp: timeStr,
          timeAgo: 'Just now',
          activeApp: 'Employee Portal',
          windowTitle: 'WorkTrackPro Dashboard - Active Workstation Screen',
          keyboardActivity: Math.floor(Math.random() * 20) + 80,
          mouseActivity: Math.floor(Math.random() * 20) + 80,
          imageUrl: realCapturedImg,
          verified: true,
          date: new Date().toISOString().split('T')[0],
          isIdle: false,
          screenshotNumber: (state.screenshots.length || 0) + 1,
          totalTodayCount: (state.screenshots.length || 0) + 1,
          syncStatus: 'ONLINE',
        };

        setState((prev: typeof state) => ({
          ...prev,
          screenshots: [newScreenshot, ...prev.screenshots],
        }));

        await broadcastSharedScreenshot(newScreenshot);
      };

      take5MinCapture();
      fiveMinInterval = setInterval(take5MinCapture, 300000);
    }

    return () => {
      if (fiveMinInterval) clearInterval(fiveMinInterval);
    };
  }, [state.session.isActive, state.user.name, state.user.role]);

  // Sync session/metrics from the single source of truth (useShiftSummary)
  // instead of ticking a local timer - shiftDurationSeconds is already
  // "time since check-in minus break time" (see get_shift_summary), and
  // the hook's own internal 1s ticker (only while actively working) keeps
  // this feeling live without this context needing its own interval.
  // elapsedSeconds historically meant "total wall-clock time since
  // check-in, including breaks" - shiftDurationSeconds + breakSeconds
  // reconstructs that same quantity from the new fields.
  useEffect(() => {
    if (!shiftSummary) return;

    setState((prev: typeof state) => {
      const nextActive = shiftSummary.shiftDurationSeconds;
      const nextBreak = shiftSummary.breakSeconds;
      const nextElapsed = nextActive + nextBreak;
      const nextStatus = mapBackendStatusToSessionStatus(shiftSummary.status);
      const nextIsActive = shiftSummary.status !== 'NOT_CHECKED_IN' && shiftSummary.status !== 'CHECKED_OUT';

      const target = prev.metrics.targetHoursSeconds || 28800;
      const timeEfficiency = Math.min(nextActive / target, 1);
      const taskCompletionRate = prev.metrics.totalTasksAssigned > 0
        ? prev.metrics.completedTasks / prev.metrics.totalTasksAssigned
        : 0;
      const calcProductivity = prev.metrics.totalTasksAssigned > 0
        ? Math.round(((timeEfficiency * 0.5) + (taskCompletionRate * 0.5)) * 100)
        : Math.round(timeEfficiency * 100);

      return {
        ...prev,
        session: {
          ...prev.session,
          isActive: nextIsActive,
          elapsedSeconds: nextElapsed,
          breakSeconds: nextBreak,
          status: nextStatus,
        },
        metrics: {
          ...prev.metrics,
          todayHoursSeconds: nextElapsed,
          activeTimeSeconds: nextActive,
          productivityScore: calcProductivity,
        },
      };
    });
  }, [shiftSummary]);

  // Check In
  // Resolves the productivity_service employee id if dashboard.tsx's login
  // bootstrap hasn't finished yet by the time the user clicks Check In -
  // registerEmployee is idempotent server-side, so this is safe even if
  // the bootstrap effect also calls it moments later.
  const ensureProductivityEmployeeId = async (): Promise<string | null> => {
    if (productivityEmployeeId) return productivityEmployeeId;
    // An admin/manager account clicking Check In (e.g. while poking around
    // the Employee Portal view to test it) must never get registered as a
    // tracked employee - same reasoning as dashboard.tsx's bootstrap-effect
    // gate, applied here too since this is the OTHER path that can create
    // a productivity_service employee row (and, from there, real
    // shift_events - this is exactly how an admin account ended up
    // permanently showing up on "Today, per employee" before this check
    // existed).
    if (state.user.role !== 'EMPLOYEE') return null;
    try {
      const employee = await productivityApiService.registerEmployee(
        state.user.name || 'Employee',
        state.user.email,
        undefined,
        state.user.role,
      );
      setProductivityEmployeeId(employee.id);
      return employee.id;
    } catch (e) {
      console.warn('[EmployeeContext] Failed to resolve productivity employee id:', e);
      return null;
    }
  };

  const handleCheckIn = async () => {
    if (shiftActionInFlightRef.current) return;
    shiftActionInFlightRef.current = true;
    try {
      await handleCheckInImpl();
    } finally {
      shiftActionInFlightRef.current = false;
    }
  };

  const handleCheckInImpl = async () => {
    const startTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const realImg = await captureRealLiveDesktopScreen(
      state.user.name || 'umer Sohail',
      'Full Stack Engineer'
    );

    const syncShiftCheckIn = async () => {
      const id = await ensureProductivityEmployeeId();
      if (!id) return;
      try {
        await productivityApiService.checkInShift(id);
        await refreshShiftSummary();
        notifyShiftStateChanged();
      } catch (e) {
        console.warn('[EmployeeContext] Failed to log shift check-in:', e);
      }
    };

    if (!realImg) {
      console.warn('Check-in capture skipped: no real screenshot available.');
      setState((prev: typeof state) => ({
        ...prev,
        session: {
          isActive: true,
          startTime: startTimeStr,
          elapsedSeconds: 0,
          breakSeconds: 0,
          status: 'Present',
        },
        metrics: {
          ...prev.metrics,
          todayHoursSeconds: 0,
          activeTimeSeconds: 0,
        },
      }));
      await syncShiftCheckIn();
      return;
    }

    const newScreenshot: ScreenshotRecordItem = {
      id: `cap-${Date.now()}`,
      userId: 'emp-101',
      userName: state.user.name || 'umer Sohail',
      userRole: 'Full Stack Engineer',
      timestamp: startTimeStr,
      timeAgo: 'Just now',
      activeApp: 'Employee Portal',
      windowTitle: 'WorkTrackPro Dashboard - Active Workstation Screen',
      keyboardActivity: 95,
      mouseActivity: 90,
      imageUrl: realImg,
      verified: true,
      date: new Date().toISOString().split('T')[0],
      isIdle: false,
      screenshotNumber: 1,
      totalTodayCount: 1,
      syncStatus: 'ONLINE',
    };

    setState((prev: typeof state) => ({
      ...prev,
      session: {
        isActive: true,
        startTime: startTimeStr,
        elapsedSeconds: 0,
        breakSeconds: 0,
        status: 'Present',
      },
      metrics: {
        ...prev.metrics,
        todayHoursSeconds: 0,
        activeTimeSeconds: 0,
      },
      screenshots: [newScreenshot, ...prev.screenshots],
    }));

    await broadcastSharedScreenshot(newScreenshot);

    try {
      const listRes = await fetch('http://localhost:3000/api/v1/employees/all');
      if (listRes.ok) {
        const json = await listRes.json();
        const emps = extractEmployeeArray(json);
        const target = emps.find((e: any) =>
          (e.email && state.user.email && e.email.toLowerCase() === state.user.email.toLowerCase()) ||
          (e.name && state.user.name && e.name.toLowerCase().includes(state.user.name.toLowerCase()))
        );
        if (target && target.id) {
          await fetch(`http://localhost:3000/api/v1/employees/${target.id}/check-in`, { method: 'POST' });
        }
      }
    } catch (e) {
      console.warn('Check-in backend sync fallback:', e);
    }

    await syncShiftCheckIn();
  };

  // Check Out
  const handleCheckOut = async () => {
    if (shiftActionInFlightRef.current) return;
    shiftActionInFlightRef.current = true;
    try {
      await handleCheckOutImpl();
    } finally {
      shiftActionInFlightRef.current = false;
    }
  };

  const handleCheckOutImpl = async () => {
    setState((prev: typeof state) => {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const todayDate = new Date().toISOString().split('T')[0];
      const todayShortDate = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      
      const hrs = Math.floor(prev.session.elapsedSeconds / 3600);
      const mins = Math.floor((prev.session.elapsedSeconds % 3600) / 60);
      const durationStr = `${hrs}h ${mins}m`;
      const breakMinsStr = `${Math.floor(prev.session.breakSeconds / 60)}m`;

      const newAttRecord: AttendanceRecordItem = {
        id: `att-${Date.now()}`,
        date: todayDate,
        checkIn: prev.session.startTime || '09:00',
        checkOut: nowStr,
        break: breakMinsStr,
        totalHours: durationStr,
        status: 'Present',
      };

      const newSessRecord: SessionRecordItem = {
        id: `sess-${Date.now()}`,
        date: todayShortDate,
        start: prev.session.startTime || '09:00',
        end: nowStr,
        duration: durationStr,
        breaks: breakMinsStr,
        status: 'Completed',
      };

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
      const todayDayName = dayNames[new Date().getDay()];
      const loggedHoursNum = Number((prev.session.elapsedSeconds / 3600).toFixed(1));

      const updatedWeeklyData = prev.weeklyHoursData.map((d: DayHours) => {
        if (d.day === todayDayName) {
          return { ...d, hours: loggedHoursNum };
        }
        return d;
      });

      const updatedAttHistory = [newAttRecord, ...prev.attendanceHistory];
      const totalDays = updatedAttHistory.length;
      const presentDays = updatedAttHistory.filter(h => h.status === 'Present' || h.status === 'Late').length;
      const halfDays = updatedAttHistory.filter(h => h.status === 'Half Day').length;
      const calcAttendanceRate = totalDays > 0 ? Math.round(((presentDays + (halfDays * 0.5)) / totalDays) * 100) : 0;

      return {
        ...prev,
        session: {
          ...prev.session,
          isActive: false,
          status: 'Checked Out',
        },
        metrics: {
          ...prev.metrics,
          attendanceRate: calcAttendanceRate,
        },
        attendanceHistory: updatedAttHistory,
        sessionHistory: [newSessRecord, ...prev.sessionHistory],
        weeklyHoursData: updatedWeeklyData,
      };
    });

    try {
      fetch('http://localhost:3000/api/v1/employees/all').then(res => res.json()).then(json => {
        const emps = extractEmployeeArray(json);
        const target = emps.find((e: any) =>
          (e.email && state.user.email && e.email.toLowerCase() === state.user.email.toLowerCase()) ||
          (e.name && state.user.name && e.name.toLowerCase().includes(state.user.name.toLowerCase()))
        );
        if (target && target.id) {
          fetch(`http://localhost:3000/api/v1/employees/${target.id}/check-out`, { method: 'POST' });
        }
      });
    } catch (e) {
      console.warn('Check-out backend sync fallback:', e);
    }

    if (productivityEmployeeId) {
      try {
        await productivityApiService.checkOutShift(productivityEmployeeId);
        await refreshShiftSummary();
        notifyShiftStateChanged();
      } catch (e) {
        console.warn('[EmployeeContext] Failed to log shift check-out:', e);
      }
    }
  };

  // Toggle Break
  const handleToggleBreak = async () => {
    if (shiftActionInFlightRef.current) return;
    shiftActionInFlightRef.current = true;
    try {
      await handleToggleBreakImpl();
    } finally {
      shiftActionInFlightRef.current = false;
    }
  };

  const handleToggleBreakImpl = async () => {
    const startingBreak = state.session.status !== 'On Break';

    // Optimistic local flip for instant button feedback - the next
    // shiftSummary poll/refresh corrects this to the server's authoritative
    // status regardless, so a failed request self-heals rather than
    // leaving the UI stuck showing the wrong state.
    setState((prev: typeof state) => ({
      ...prev,
      session: {
        ...prev.session,
        status: prev.session.status === 'On Break' ? 'Present' : 'On Break',
      }
    }));

    if (!productivityEmployeeId) return;
    try {
      if (startingBreak) {
        await productivityApiService.startBreak(productivityEmployeeId);
      } else {
        await productivityApiService.endBreak(productivityEmployeeId);
      }
      await refreshShiftSummary();
      notifyShiftStateChanged();
    } catch (e) {
      console.warn('[EmployeeContext] Failed to sync break toggle:', e);
    }
  };

  // Complete Task
  const handleCompleteTask = () => {
    setState((prev: typeof state) => {
      const total = prev.metrics.totalTasksAssigned || 15;
      const current = prev.metrics.completedTasks;
      
      let nextCompleted = current + 1;
      if (nextCompleted > total) {
        nextCompleted = 0;
      }

      const taskCompletionRate = total > 0 ? nextCompleted / total : 0;
      const timeEfficiency = Math.min(prev.metrics.activeTimeSeconds / prev.metrics.targetHoursSeconds, 1);
      const calcProductivity = Math.round(((timeEfficiency * 0.5) + (taskCompletionRate * 0.5)) * 100);

      return {
        ...prev,
        metrics: {
          ...prev.metrics,
          completedTasks: nextCompleted,
          productivityScore: calcProductivity,
        }
      };
    });
  };

  // Register New Employee or Manager
  const registerNewEmployee = async (
    firstName: string,
    lastName: string,
    email: string,
    role: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE',
    password: string = 'Taqu7777',
    department?: string
  ) => {
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    try {
      const res = await fetch('http://localhost:3000/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: cleanFirstName,
          lastName: cleanLastName,
          email: email.toLowerCase().trim(),
          password,
          organizationName: 'StitchMonitor Corp',
          role: role === 'MANAGER' ? 'ADMIN' : 'EMPLOYEE',
          departmentName: department,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        console.log('MongoDB Signup Success Response:', json);
      }
    } catch (e) {
      console.log('Backend API register connection fallback mode:', e);
    }

    const newBaseline = getNewSignupBaseline(cleanFirstName, cleanLastName, email, role);
    setState(newBaseline);
    safeSetEmployeeState(newBaseline);
  };

  // Login Employee or Manager
  const loginEmployee = async (
    email: string, 
    password: string = 'Taqu7777', 
    requestedRole: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE'
  ): Promise<boolean> => {
    const cleanEmail = email.toLowerCase().trim();

    try {
      const res = await fetch('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = json?.message || json?.error || 'Invalid email or password';
        throw new Error(message);
      }

      const u = json.data?.user || json.user;
      if (!u) {
        throw new Error('Invalid login response from server');
      }

      const tokens = json.data?.tokens || json.tokens;
      if (tokens?.accessToken) {
        // Persist the JWT so subsequent authenticated calls (e.g. task
        // creation/assignment) via apiService carry a valid Bearer token —
        // previously discarded here, so every JwtAuthGuard-protected
        // endpoint was unreachable from this app.
        apiService.setToken(tokens.accessToken);
      }

      const canAccessManagerDashboard = u.role === 'ADMIN' || u.role === 'MANAGER';
      if (requestedRole === 'MANAGER' && !canAccessManagerDashboard) {
        throw new Error('Only authorized Manager accounts can access the Manager Dashboard.');
      }

      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || cleanEmail.split('@')[0];
      const isManagerAccount = canAccessManagerDashboard;
      const fetchedUser: UserProfile = {
        id: u.id,
        name: fullName,
        email: u.email,
        role: isManagerAccount ? 'MANAGER' : 'EMPLOYEE',
        avatar: getInitials(fullName),
      };

      setState((prev: typeof state) => ({
        ...prev,
        user: fetchedUser,
      }));

      return true;
    } catch (e: any) {
      console.log('Backend API login connection fallback mode:', e);
      throw e instanceof Error ? e : new Error('Login failed. Please check your credentials.');
    }
  };

  return (
    <EmployeeContext.Provider
      value={{
        user: state.user,
        session: state.session,
        metrics: state.metrics,
        attendanceHistory: state.attendanceHistory,
        sessionHistory: state.sessionHistory,
        screenshots: state.screenshots,
        weeklyHoursData: state.weeklyHoursData,
        productivityEmployeeId,
        setProductivityEmployeeId,
        handleCheckIn,
        handleCheckOut,
        handleToggleBreak,
        handleCompleteTask,
        registerNewEmployee,
        loginEmployee,
      }}
    >
      {children}
    </EmployeeContext.Provider>
  );
};

export const useEmployee = () => {
  const context = useContext(EmployeeContext);
  if (!context) {
    throw new Error('useEmployee must be used within an EmployeeProvider');
  }
  return context;
};
