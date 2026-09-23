import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { apiService, API_ORIGIN } from './src/services/api.service';
import { socketService } from './src/services/socket.service';
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
  // Job title pick-list: 'SM' | 'CSR' | 'Team Lead' | 'HR' | undefined.
  // Drives the "management tier" (SM/HR, alongside role MANAGER/ADMIN) vs
  // "floor tier" (CSR/Team Lead/unset) split for messaging permissions and
  // the SM/HR-only Idle Time nav item - see dashboard.tsx.
  designation?: string;
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
  // Widened from a weekday-literal union to a plain string so the same
  // shape can carry "Wk 1".."Wk 5" labels for the This Month timeframe,
  // not just Mon-Fri - every consumer (ThisWeeksHoursWidget,
  // WeeklySessionStatisticsWidget, dashboard.tsx's bar chart) only ever
  // reads `day` as a recharts/display label, never branches on its value.
  day: string;
  hours: number;
}

export interface MonthlyAttendanceSummary {
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  // Real calendar days from the 1st of this month through today - the
  // percentage denominator. Not attendanceHistory.length, which only ever
  // grows from this browser's own local checkouts and never reflects the
  // employee's real backend attendance record.
  totalDaysElapsed: number;
}

export interface EmployeeContextType {
  user: UserProfile;
  session: SessionState;
  metrics: MetricsState;
  attendanceHistory: AttendanceRecordItem[];
  sessionHistory: SessionRecordItem[];
  screenshots: ScreenshotRecordItem[];
  weeklyHoursData: DayHours[];
  monthlyAttendanceSummary: MonthlyAttendanceSummary;
  // Refetches weeklyHoursData from real attendance report rows for the
  // given timeframe. Exposed so dashboard.tsx's This Week/Last Week/This
  // Month buttons can drive real data instead of only changing which
  // button looks selected.
  fetchWeeklyHoursData: (timeframe?: 'This Week' | 'Last Week' | 'This Month') => Promise<void>;
  // The productivity_service (Supabase) employee id - the key everything
  // in useShiftSummary/idleTimeTracker/presenceDetector is keyed on. Set
  // once dashboard.tsx's login bootstrap resolves it via registerEmployee.
  productivityEmployeeId: string | null;
  setProductivityEmployeeId: (id: string) => void;

  // Actions
  handleCheckIn: () => void;
  handleCheckOut: () => void;
  registerNewEmployee: (firstName: string, lastName: string, email: string, role: 'EMPLOYEE' | 'MANAGER', password?: string, department?: string, designation?: string) => Promise<void>;
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

// toISOString() converts to UTC first, which silently rolls a local
// midnight back to the previous calendar day in any UTC+ timezone (e.g.
// Asia/Karachi, UTC+5). Build the "YYYY-MM-DD" string from local date
// parts instead, matching the Karachi-local calendar day the backend
// report rows are already keyed by.
const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
      totalTasksAssigned: 0,
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
    monthlyAttendanceSummary: {
      presentDays: 0,
      lateDays: 0,
      absentDays: 0,
      leaveDays: 0,
      totalDaysElapsed: 0,
    } as MonthlyAttendanceSummary,
  };
};

const EmployeeContext = createContext<EmployeeContextType | undefined>(undefined);

export const EmployeeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState(() => {
    const baseline = getNewSignupBaseline('umer', 'Sohail', 'employee@stitchmonitor.com', 'EMPLOYEE');
    try {
      const saved = localStorage.getItem('stitch_employee_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Shallow-merge onto the current baseline rather than returning the
        // parsed blob as-is - a state shape saved by an older build (e.g.
        // before monthlyAttendanceSummary existed) is missing whatever
        // fields were added since, and every consumer that destructures
        // those fields directly (no `?.`) crashes the whole render tree on
        // mount. Merging keeps old real data (attendanceHistory,
        // sessionHistory, etc.) while guaranteeing newer fields are never
        // undefined.
        return {
          ...baseline,
          ...parsed,
          session: { ...baseline.session, ...parsed.session },
          metrics: { ...baseline.metrics, ...parsed.metrics },
          monthlyAttendanceSummary: { ...baseline.monthlyAttendanceSummary, ...parsed.monthlyAttendanceSummary },
        };
      }
    } catch (e) {
      console.log('LocalStorage load fallback');
    }
    return baseline;
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

  // STEP 1 & 3: AUTOMATIC 5-MINUTE CAPTURE + TRANSMISSION now live entirely
  // in captureService.ts (the Electron main process), which POSTs straight
  // to the admin PC's local screenshot server over the LAN instead of
  // MongoDB. This effect used to independently capture its own screenshot
  // AND upload it here too - since captureRealLiveDesktopScreen() itself
  // triggers a capture+upload in captureService.ts via IPC, that meant a
  // single 5-minute tick fired 2 separate uploads for the same moment.
  // Now there is exactly one capture and one upload per interval (owned by
  // captureService.ts's own timer), and this context just listens for the
  // 'screenshot-captured-event' broadcast it already emits, to keep this
  // employee's own screenshot history in sync.
  useEffect(() => {
    if (state.user.role !== 'EMPLOYEE') return;
    if (typeof window === 'undefined' || !(window as any).require) return;
    const electron = (window as any).require('electron');
    const ipcRenderer = electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const handleScreenshotCaptured = (_event: any, record: any) => {
      const newScreenshot: ScreenshotRecordItem = {
        id: record.id,
        userId: record.userId,
        userName: record.userName,
        userRole: record.userRole,
        timestamp: record.timestamp,
        timeAgo: 'Just now',
        activeApp: record.activeWindowName || 'Active Desktop Application',
        windowTitle: record.activeWindowName || 'Active Desktop Application',
        keyboardActivity: 0,
        mouseActivity: 0,
        imageUrl: record.imageUrl,
        verified: true,
        date: record.date,
        isIdle: record.isIdle,
        screenshotNumber: record.screenshotNumber,
        totalTodayCount: record.totalTodayCount,
        syncStatus: record.syncStatus,
      };
      setState((prev: typeof state) => ({
        ...prev,
        screenshots: [newScreenshot, ...prev.screenshots],
      }));
    };

    ipcRenderer.on('screenshot-captured-event', handleScreenshotCaptured);
    return () => {
      ipcRenderer.removeListener('screenshot-captured-event', handleScreenshotCaptured);
    };
  }, [state.user.role]);

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
          // Unified Overall Productivity score from the backend (Attendance
          // Ratio + App Focus Score + Compliance Score, weighted) - was
          // previously a local 50/50 time-vs-task-completion blend computed
          // here, unrelated to the formula every other card/report uses.
          // See ProductivityService._compute_overall_productivity().
          productivityScore: Math.round(shiftSummary.productivityPercentage),
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
    // Triggers a real capture+upload in captureService.ts (main process)
    // via IPC, using the actual logged-in employee's id/name - it already
    // broadcasts 'screenshot-captured-event', which the listener above
    // picks up to update state.screenshots. This used to ALSO build its
    // own duplicate record here (with a hardcoded fake 'emp-101' id) and
    // upload it a second time via broadcastSharedScreenshot() - removed,
    // since captureService.ts's own upload is the real, correctly-
    // attributed one.
    void captureRealLiveDesktopScreen(state.user.name || 'umer Sohail', 'Full Stack Engineer');

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

    try {
      const listRes = await fetch(`${API_ORIGIN}/api/v1/employees/all`);
      if (listRes.ok) {
        const json = await listRes.json();
        const emps = extractEmployeeArray(json);
        const target = emps.find((e: any) =>
          (e.email && state.user.email && e.email.toLowerCase() === state.user.email.toLowerCase()) ||
          (e.name && state.user.name && e.name.toLowerCase().includes(state.user.name.toLowerCase()))
        );
        if (target && target.id) {
          await fetch(`${API_ORIGIN}/api/v1/employees/${target.id}/check-in`, { method: 'POST' });
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
      const todayShortDate = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' });

      const hrs = Math.floor(prev.session.elapsedSeconds / 3600);
      const mins = Math.floor((prev.session.elapsedSeconds % 3600) / 60);
      const durationStr = `${hrs}h ${mins}m`;
      const breakMinsStr = `${Math.floor(prev.session.breakSeconds / 60)}m`;

      const newSessRecord: SessionRecordItem = {
        id: `sess-${Date.now()}`,
        date: todayShortDate,
        start: prev.session.startTime || '09:00',
        end: nowStr,
        duration: durationStr,
        breaks: breakMinsStr,
        status: 'Completed',
      };

      return {
        ...prev,
        session: {
          ...prev.session,
          isActive: false,
          status: 'Checked Out',
        },
        sessionHistory: [newSessRecord, ...prev.sessionHistory],
      };
    });

    try {
      // Was an un-awaited .then() chain with the actual check-out POST
      // fired from inside it - the surrounding try/catch caught nothing
      // (nothing throws synchronously here), so any failure anywhere in
      // this chain - network error, no matching employee, non-2xx
      // response - silently vanished as an unhandled rejection. That left
      // Attendance.clockOut permanently null for real check-outs (visible
      // once something actually read it - TimelineService's "Clocked Out"
      // entry, and the Logs page's Checked Out rows, both silently missing
      // it) even though the user genuinely checked out. Mirrors
      // handleCheckInImpl's already-correct awaited pattern above.
      const listRes = await fetch(`${API_ORIGIN}/api/v1/employees/all`);
      if (listRes.ok) {
        const json = await listRes.json();
        const emps = extractEmployeeArray(json);
        const target = emps.find((e: any) =>
          (e.email && state.user.email && e.email.toLowerCase() === state.user.email.toLowerCase()) ||
          (e.name && state.user.name && e.name.toLowerCase().includes(state.user.name.toLowerCase()))
        );
        if (target && target.id) {
          await fetch(`${API_ORIGIN}/api/v1/employees/${target.id}/check-out`, { method: 'POST' });
        }
      }
    } catch (e) {
      console.warn('Check-out backend sync fallback:', e);
    }

    if (productivityEmployeeId) {
      try {
        await productivityApiService.checkOutShift(productivityEmployeeId);
        await refreshShiftSummary();
        notifyShiftStateChanged();
        // Refresh the Weekly Productivity Breakdown chart, This Month
        // card, and Attendance History table from the real report row
        // this checkout just created, instead of the old
        // locally-guessed/local-only updates.
        fetchWeeklyHoursData('This Week');
        fetchMonthlyAttendanceSummary();
        fetchAttendanceHistory();
      } catch (e) {
        console.warn('[EmployeeContext] Failed to log shift check-out:', e);
      }
    }
  };

  // Real assigned/completed task counts (was previously a fake local
  // counter starting from a hardcoded "15 total tasks" baseline for every
  // employee, with a "+ Done" button that just incremented it and wrapped
  // back to 0 - never touched the real Task backend at all). GET /tasks is
  // already scoped to "my tasks" for an employee by the JWT, same real
  // source MyTasksView.tsx uses, so this can never drift from what the
  // employee actually sees there. Task Productivity intentionally stays a
  // separate, independently displayed metric from productivityScore above
  // (the unified Overall Productivity formula) - this effect only feeds
  // the Tasks Completed card, not the productivity percentage.
  useEffect(() => {
    // No separate "isAuthenticated" flag exists in this context (that
    // lives in dashboard.tsx) - gating on role alone is enough here,
    // since an unauthenticated apiService.getTasks() call just fails
    // gracefully below (caught, no state corruption) and the 30s retry
    // picks up real data as soon as a real login sets a real token.
    if (state.user.role !== 'EMPLOYEE') return;

    const fetchTaskCounts = async () => {
      try {
        const result: any = await apiService.getTasks();
        const list: any[] = Array.isArray(result) ? result : result?.data || [];
        const completed = list.filter((t) => t.status === 'COMPLETED').length;
        setState((prev: typeof state) => ({
          ...prev,
          metrics: {
            ...prev.metrics,
            completedTasks: completed,
            totalTasksAssigned: list.length,
          },
        }));
      } catch (e) {
        console.warn('[EmployeeContext] Failed to fetch task counts:', e);
      }
    };

    fetchTaskCounts();
    const interval = setInterval(fetchTaskCounts, 30000);
    return () => clearInterval(interval);
  }, [state.user.role]);

  // Weekly Productivity Breakdown chart data - was previously only ever
  // updated locally (one weekday cell set to the current session's
  // elapsedSeconds on checkout), so it never reflected real historical
  // hours and the This Week/Last Week/This Month buttons above it did
  // nothing at all. Now sourced from the same real
  // /api/reports/attendance rows ReportsView.tsx's PDF export uses,
  // filtered to this employee and bucketed per the selected timeframe.
  const fetchWeeklyHoursData = async (
    timeframe: 'This Week' | 'Last Week' | 'This Month' = 'This Week'
  ) => {
    if (!productivityEmployeeId) return;

    try {
      let buckets: { label: string; start: Date; end: Date }[];

      if (timeframe === 'This Month') {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        buckets = [];
        let bucketStart = new Date(monthStart);
        let weekNum = 1;
        while (bucketStart <= monthEnd) {
          const bucketEnd = new Date(bucketStart);
          bucketEnd.setDate(bucketEnd.getDate() + 6);
          const clampedEnd = bucketEnd > monthEnd ? monthEnd : bucketEnd;
          buckets.push({ label: `Wk ${weekNum}`, start: new Date(bucketStart), end: new Date(clampedEnd) });
          bucketStart = new Date(clampedEnd);
          bucketStart.setDate(bucketStart.getDate() + 1);
          weekNum++;
        }
      } else {
        const now = new Date();
        const dow = now.getDay(); // 0=Sun..6=Sat
        const diffToMonday = dow === 0 ? -6 : 1 - dow;
        const monday = new Date(now);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(now.getDate() + diffToMonday + (timeframe === 'Last Week' ? -7 : 0));

        const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        buckets = weekdayLabels.map((label, i) => {
          const d = new Date(monday);
          d.setDate(d.getDate() + i);
          return { label, start: d, end: d };
        });
      }

      const rangeStart = toDateStr(buckets[0].start);
      const rangeEnd = toDateStr(buckets[buckets.length - 1].end);
      const report = await productivityApiService.getAttendanceReport(rangeStart, rangeEnd);
      const rows = (report?.rows || []).filter((r) => r.employeeId === productivityEmployeeId);

      const newData: DayHours[] = buckets.map((b) => {
        const startStr = toDateStr(b.start);
        const endStr = toDateStr(b.end);
        const totalSeconds = rows
          .filter((r) => r.date >= startStr && r.date <= endStr)
          .reduce((sum, r) => sum + (r.shiftDurationSeconds || 0), 0);
        return { day: b.label, hours: Number((totalSeconds / 3600).toFixed(1)) };
      });

      setState((prev: typeof state) => ({ ...prev, weeklyHoursData: newData }));
    } catch (e) {
      console.warn('[EmployeeContext] Failed to fetch weekly hours data:', e);
    }
  };

  useEffect(() => {
    if (!productivityEmployeeId) return;
    fetchWeeklyHoursData('This Week');
  }, [productivityEmployeeId]);

  // "This Month" card (ThisMonthWidget) - was previously computed from
  // attendanceHistory, a browser-local list that only ever grew when THIS
  // session ran a checkout, never reflecting the employee's real backend
  // attendance record (and mislabeled "This Month" while actually covering
  // all-time local history). Sourced from the same real
  // /api/reports/attendance rows as the weekly chart above, scoped to the
  // 1st of the current month through today.
  //
  // DailyReportRow only distinguishes PRESENT/ABSENT (no backend concept
  // of "Late" or "Leave" exists yet - no shift-start-time config to judge
  // lateness against), so those two stay honestly 0 rather than invented.
  const fetchMonthlyAttendanceSummary = async () => {
    if (!productivityEmployeeId) return;

    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const report = await productivityApiService.getAttendanceReport(toDateStr(monthStart), toDateStr(now));
      const rows = (report?.rows || []).filter((r) => r.employeeId === productivityEmployeeId);

      const presentDays = rows.filter((r) => r.attendanceStatus === 'PRESENT').length;
      const absentDays = rows.filter((r) => r.attendanceStatus === 'ABSENT').length;

      setState((prev: typeof state) => ({
        ...prev,
        monthlyAttendanceSummary: {
          presentDays,
          lateDays: 0,
          absentDays,
          leaveDays: 0,
          totalDaysElapsed: rows.length,
        },
      }));
    } catch (e) {
      console.warn('[EmployeeContext] Failed to fetch monthly attendance summary:', e);
    }
  };

  useEffect(() => {
    if (!productivityEmployeeId) return;
    fetchMonthlyAttendanceSummary();
  }, [productivityEmployeeId]);

  // Attendance History table (AttendanceHistoryTable) - was previously
  // only ever appended to locally on checkout in THIS browser session, so
  // it never showed real check-in/out times recorded by the backend, lost
  // everything on a cleared/different device, and never grew on its own
  // as new days passed without a manual checkout. Sourced from the same
  // real /api/reports/attendance rows as the other cards above, over a
  // rolling 30-day window, refreshed on load, after every checkout, and
  // on a 1-minute interval so a new day's row (even an ABSENT one) shows
  // up without requiring a checkout to trigger it.
  const fetchAttendanceHistory = async () => {
    if (!productivityEmployeeId) return;

    try {
      const now = new Date();
      const rangeStart = new Date(now);
      rangeStart.setDate(rangeStart.getDate() - 29);
      const report = await productivityApiService.getAttendanceReport(toDateStr(rangeStart), toDateStr(now));
      const rows = (report?.rows || [])
        .filter((r) => r.employeeId === productivityEmployeeId)
        .sort((a, b) => (a.date < b.date ? 1 : -1));

      const formatTime = (iso: string | null) =>
        iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

      const history: AttendanceRecordItem[] = rows.map((r) => {
        const hrs = Math.floor(r.shiftDurationSeconds / 3600);
        const mins = Math.floor((r.shiftDurationSeconds % 3600) / 60);
        return {
          id: `att-${r.date}`,
          date: r.date,
          checkIn: formatTime(r.checkInAt),
          checkOut: r.stillCheckedIn ? 'Still Checked In' : formatTime(r.checkOutAt),
          break: `${Math.floor(r.breakSeconds / 60)}m`,
          totalHours: `${hrs}h ${mins}m`,
          status: r.attendanceStatus === 'PRESENT' ? 'Present' : 'Absent',
        };
      });

      const totalDays = rows.length;
      const presentDays = rows.filter((r) => r.attendanceStatus === 'PRESENT').length;
      const calcAttendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

      setState((prev: typeof state) => ({
        ...prev,
        attendanceHistory: history,
        metrics: { ...prev.metrics, attendanceRate: calcAttendanceRate },
      }));
    } catch (e) {
      console.warn('[EmployeeContext] Failed to fetch attendance history:', e);
    }
  };

  useEffect(() => {
    if (!productivityEmployeeId) return;
    fetchAttendanceHistory();
    const interval = setInterval(fetchAttendanceHistory, 60000);
    return () => clearInterval(interval);
  }, [productivityEmployeeId]);

  // Register New Employee or Manager
  const registerNewEmployee = async (
    firstName: string,
    lastName: string,
    email: string,
    role: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE',
    password: string = 'Taqu7777',
    department?: string,
    designation?: string
  ) => {
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    try {
      const res = await fetch(`${API_ORIGIN}/api/v1/auth/register`, {
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
          designation: designation || undefined,
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
      const res = await fetch(`${API_ORIGIN}/api/v1/auth/login`, {
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
        // endpoint was unreachable from this app. refreshToken/expiresIn
        // were previously discarded too, which meant the access token
        // (15min lifetime) had no way to renew itself - every session
        // silently broke ~15min in. Passing them lets apiService schedule
        // a proactive refresh and self-heal on a 401 instead.
        apiService.setToken(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);
        // The socket may already be connected (unauthenticated, or with a
        // stale token) from before this login finished - reconnect now so
        // the server can join this session to the right notification
        // room (admin-shared vs this-user-only) using the fresh token,
        // rather than waiting for a later reconnect/app-restart.
        socketService.reauthenticate();
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
        designation: u.designation || undefined,
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
        fetchWeeklyHoursData,
        monthlyAttendanceSummary: state.monthlyAttendanceSummary,
        productivityEmployeeId,
        setProductivityEmployeeId,
        handleCheckIn,
        handleCheckOut,
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
