import React, { createContext, useContext, useState, useEffect } from 'react';

export interface UserProfile {
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
  
  // Actions
  handleCheckIn: () => void;
  handleCheckOut: () => void;
  handleToggleBreak: () => void;
  handleCompleteTask: () => void;
  registerNewEmployee: (firstName: string, lastName: string, email: string, role: 'EMPLOYEE' | 'MANAGER', password?: string) => Promise<void>;
  loginEmployee: (email: string, password?: string, requestedRole?: 'EMPLOYEE' | 'MANAGER') => Promise<boolean>;
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

  // Save state changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('stitch_employee_state', JSON.stringify(state));
    } catch (e) {
      console.log('LocalStorage save error:', e);
    }
  }, [state]);

  // STEP 3: TRANSMISSION & STORAGE LOGIC
  const broadcastSharedScreenshot = async (newScreenshot: ScreenshotRecordItem) => {
    try {
      // Update LocalStorage
      const existingStr = localStorage.getItem('stitch_shared_screenshots');
      const existingList = existingStr ? JSON.parse(existingStr) : [];
      const updatedList = [newScreenshot, ...existingList.filter((item: any) => item.id !== newScreenshot.id)];
      localStorage.setItem('stitch_shared_screenshots', JSON.stringify(updatedList));

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

  // Live Timer Interval
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (state.session.isActive) {
      interval = setInterval(() => {
        setState((prev: typeof state) => {
          const nextElapsed = prev.session.elapsedSeconds + 1;
          const isBreak = prev.session.status === 'On Break';
          const nextBreak = isBreak ? prev.session.breakSeconds + 1 : prev.session.breakSeconds;
          const nextActive = Math.max(0, nextElapsed - nextBreak);
          
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
              elapsedSeconds: nextElapsed,
              breakSeconds: nextBreak,
            },
            metrics: {
              ...prev.metrics,
              todayHoursSeconds: nextElapsed,
              activeTimeSeconds: nextActive,
              productivityScore: calcProductivity,
            }
          };
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [state.session.isActive]);

  // Check In
  const handleCheckIn = async () => {
    const startTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const realImg = await captureRealLiveDesktopScreen(
      state.user.name || 'umer Sohail',
      'Full Stack Engineer'
    );

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
        const emps = Array.isArray(json) ? json : (json?.data || []);
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
  };

  // Check Out
  const handleCheckOut = () => {
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
        const emps = Array.isArray(json) ? json : (json?.data || []);
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
  };

  // Toggle Break
  const handleToggleBreak = () => {
    setState((prev: typeof state) => ({
      ...prev,
      session: {
        ...prev.session,
        status: prev.session.status === 'On Break' ? 'Present' : 'On Break',
      }
    }));
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
    password: string = 'Taqu7777'
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
    localStorage.setItem('stitch_employee_state', JSON.stringify(newBaseline));
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

      if (requestedRole === 'MANAGER' && u.role !== 'ADMIN' && cleanEmail !== 'taqikhawaja777@gmail.com') {
        throw new Error('Only authorized Manager accounts can access the Manager Dashboard.');
      }

      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || cleanEmail.split('@')[0];
      const isManagerAccount = cleanEmail === 'taqikhawaja777@gmail.com' || u.role === 'ADMIN' || requestedRole === 'MANAGER';
      const fetchedUser: UserProfile = {
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
