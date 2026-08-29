import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Users,
  Radio,
  Clock, 
  Monitor, 
  TrendingUp, 
  Camera, 
  Video, 
  FileText,
  LogOut, 
  Search, 
  Moon, 
  Sun,
  Bell, 
  Settings,
  ChevronDown, 
  ChevronLeft,
  ChevronRight,
  Activity,
  Target,
  HelpCircle,
  ShieldAlert,
  CheckCircle2,
  Filter,
  Play,
  Pause,
  CheckSquare
} from 'lucide-react';
import { ThisMonthWidget } from './ThisMonthWidget';
import { AttendanceActionCards } from './AttendanceActionCards';
import { ThisWeeksHoursWidget } from './ThisWeeksHoursWidget';
import { MonthlySummaryWidget } from './MonthlySummaryWidget';
import { AttendanceHistoryTable } from './AttendanceHistoryTable';
import { WorkSessionScreen } from './WorkSessionScreen';
import { ProductivityHighlightsBanner } from './ProductivityHighlightsBanner';
import { ScreenshotsView } from './ScreenshotsView';
import { RecordingsView } from './RecordingsView';
import { AuthScreen } from './AuthScreen';
import { ManagerDashboard } from './ManagerDashboard';
import { ManagerAttendanceView } from './ManagerAttendanceView';
import { LiveMonitorView } from './LiveMonitorView';
import { ReportsView } from './ReportsView';
import { ManagerNotificationsView } from './ManagerNotificationsView';
import { ManagerSettingsView } from './ManagerSettingsView';
import { ConsentModal } from './ConsentModal';
import { MonitoringBanner } from './MonitoringBanner';
import { useEmployee } from './EmployeeContext';

interface ActivityItem {
  id: string;
  user: string;
  action: string;
  time: string;
  category: 'productive' | 'unproductive' | 'neutral';
  app: string;
}

export const AdminDashboard: React.FC = () => {
  const { 
    user, 
    session, 
    metrics, 
    weeklyHoursData,
    handleCheckIn, 
    handleCheckOut, 
    handleCompleteTask
  } = useEmployee();

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return localStorage.getItem('stitch_is_authenticated') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [hasConsented, setHasConsented] = useState<boolean>(() => {
    try {
      return localStorage.getItem('stitch_consent_accepted_1.0.0') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [pausedSeconds, setPausedSeconds] = useState<number>(0);
  const [activeNav, setActiveNav] = useState<string>('Dashboard');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<'This Week' | 'Last Week' | 'This Month'>('This Week');

  if (!isAuthenticated) {
    return (
      <AuthScreen 
        onLoginSuccess={() => {
          localStorage.setItem('stitch_is_authenticated', 'true');
          setIsAuthenticated(true);
        }} 
      />
    );
  }

  // Section 2.1: Non-dismissable consent modal on launch for Employee role
  if (!hasConsented && user.role === 'EMPLOYEE') {
    return <ConsentModal policyVersion="1.0.0" onConsentAccepted={() => setHasConsented(true)} />;
  }

  const formatDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hrs}h ${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const formatShortDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  const navItems = user.role === 'MANAGER'
    ? [
        { name: 'Dashboard', icon: LayoutDashboard },
        { name: 'Employees', icon: Users },
        { name: 'Live Monitor', icon: Radio, badge: 'LIVE', badgeColor: 'bg-rose-500 text-white' },
        { name: 'Attendance', icon: Clock },
        { name: 'Productivity', icon: TrendingUp },
        { name: 'Screenshots', icon: Camera },
        { name: 'Recordings', icon: Video },
        { name: 'Reports', icon: FileText },
        { name: 'Notifications', icon: Bell, badge: '5', badgeColor: 'bg-indigo-600 text-white' },
        { name: 'Settings', icon: Settings },
      ]
    : [
        { name: 'Dashboard', icon: LayoutDashboard },
        { name: 'Attendance', icon: Clock },
        { name: 'Work Session', icon: Monitor },
        { name: 'Productivity', icon: TrendingUp },
        { name: 'Screenshots', icon: Camera },
        { name: 'Recordings', icon: Video },
      ];

  const recentActivities: ActivityItem[] = [
    { id: '1', user: user.name || 'John Doe', action: 'Active editing in Figma', time: '2 mins ago', category: 'productive', app: 'Figma' },
    { id: '2', user: 'Sarah Smith', action: 'Code review PR #142', time: '12 mins ago', category: 'productive', app: 'VS Code' },
    { id: '3', user: 'Michael Brown', action: 'Visited YouTube.com', time: '25 mins ago', category: 'unproductive', app: 'Chrome' },
    { id: '4', user: 'Emily Davis', action: 'Zoom Team Standup', time: '40 mins ago', category: 'neutral', app: 'Zoom' },
    { id: '5', user: 'Alex Wilson', action: 'Pushed commit to backend repository', time: '1 hour ago', category: 'productive', app: 'Git' }
  ];

  const filteredActivities = recentActivities.filter(item => 
    item.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.app.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`flex h-screen w-screen font-sans overflow-hidden select-none transition-colors duration-200 ${
      isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-[#f4f5fa] text-slate-700'
    }`}>
      
      {/* ================= SIDEBAR ================= */}
      <aside className={`transition-all duration-300 flex flex-col justify-between relative z-30 ${
        isDarkMode ? 'bg-slate-900 border-slate-800/80 shadow-2xl' : 'bg-white border-slate-200/90 shadow-xl'
      } border-r-2 ${isSidebarCollapsed ? 'w-20' : 'w-64'} h-screen`}>
        
        {/* Collapse Toggle Button (Positioned cleanly on separation line) */}
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3.5 top-7 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full p-1.5 shadow-xl ring-4 ring-white dark:ring-slate-900 transition-all active:scale-95 z-50 flex items-center justify-center cursor-pointer"
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* Logo Section */}
          <div className="p-5 flex items-center space-x-3 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 shrink-0">
              <Monitor className="w-6 h-6" />
            </div>
            {!isSidebarCollapsed && (
              <div>
                <h1 className={`font-bold text-lg leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>WorkTrackPro</h1>
                <p className="text-[10px] font-bold text-indigo-500 tracking-wider">
                  {user.role === 'MANAGER' ? 'MANAGER PORTAL' : 'EMPLOYEE PORTAL'}
                </p>
              </div>
            )}
          </div>

          {/* User Profile Card with Registered Employee Name */}
          <div className={`mx-3 mb-4 p-3 rounded-xl flex items-center space-x-3 border transition-colors shrink-0 ${
            isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-indigo-50/60 border-indigo-100/50'
          }`}>
            <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm shrink-0 shadow-md">
              {user.avatar || 'AS'}
            </div>
            {!isSidebarCollapsed && (
              <div className="overflow-hidden">
                <p className={`font-semibold text-sm truncate ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{user.name}</p>
                <div className="flex items-center space-x-1.5">
                  <span className={`w-2 h-2 rounded-full ${session.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                  <span className="text-xs text-slate-500 font-medium">{session.isActive ? (session.status === 'On Break' ? 'On Break' : 'Active') : 'Not Checked In'}</span>
                </div>
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold mt-0.5">
                  Logged Today: {formatShortDuration(metrics.todayHoursSeconds)}
                </p>
              </div>
            )}
          </div>

          {/* Scrollable Navigation Links (Slide Panel with right padding) */}
          <div className="flex-1 overflow-y-auto pl-3 pr-2 py-1 space-y-1 custom-scrollbar">
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => setActiveNav(item.name)}
                    title={isSidebarCollapsed ? item.name : undefined}
                    className={`w-full flex items-center justify-between ${isSidebarCollapsed ? 'justify-center px-0' : 'px-4'} py-3 rounded-xl font-medium text-sm transition-all duration-150 ${
                      isActive
                        ? isDarkMode 
                          ? 'bg-indigo-600/20 text-indigo-400 border-r-4 border-indigo-500' 
                          : 'bg-indigo-50 text-indigo-600 shadow-sm border-r-4 border-indigo-600'
                        : isDarkMode
                          ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Icon className={`w-5 h-5 ${isActive ? (isDarkMode ? 'text-indigo-400' : 'text-indigo-600') : 'text-slate-400'}`} />
                      {!isSidebarCollapsed && <span>{item.name}</span>}
                    </div>
                    {!isSidebarCollapsed && item.badge && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shadow-xs ${item.badgeColor}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

        </div>

        {/* Clean Sidebar Footer & Sign Out */}
        <div className={`p-3 border-t shrink-0 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
          <button 
            onClick={() => {
              localStorage.removeItem('stitch_is_authenticated');
              setIsAuthenticated(false);
            }}
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'space-x-3 px-4'} py-3 text-rose-500 hover:bg-rose-500/10 rounded-xl font-medium text-sm transition-colors cursor-pointer`}
          >
            <LogOut className="w-5 h-5" />
            {!isSidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* ================= MAIN CONTENT AREA ================= */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        
        {/* Top Navbar Header */}
        <header className={`h-20 px-8 flex items-center justify-between border-b sticky top-0 z-20 backdrop-blur-md transition-colors ${
          isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200/80'
        }`}>
          <div>
            <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
              {user.role === 'MANAGER' ? 'Manager Supervisor Portal' : activeNav}
            </h2>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Monday, August 10, 2026</p>
          </div>

          <div className="flex items-center space-x-4">
            {/* Search Bar */}
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search user, action, app..."
                className={`w-full pl-10 pr-4 py-2 rounded-full text-sm placeholder-slate-400 focus:outline-none transition-all ${
                  isDarkMode 
                    ? 'bg-slate-800/80 text-slate-200 focus:bg-slate-800 border border-slate-700 focus:border-indigo-500' 
                    : 'bg-slate-100/70 text-slate-700 focus:bg-white border border-transparent focus:border-indigo-300'
                }`}
              />
            </div>

            {/* Dark/Light Mode Switcher */}
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              title="Toggle Theme"
              className={`p-2.5 rounded-full transition-colors ${
                isDarkMode ? 'bg-slate-800 text-amber-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-2.5 rounded-full relative transition-colors ${
                  isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-0 right-0 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900">
                  3
                </span>
              </button>

              {/* Notifications Dropdown Tray */}
              {showNotifications && (
                <div className={`absolute right-0 mt-3 w-80 rounded-2xl shadow-2xl border p-4 z-50 transition-all ${
                  isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                }`}>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/50 dark:border-slate-800">
                    <h3 className="font-bold text-sm">Notifications</h3>
                    <span className="text-xs text-indigo-500 font-semibold cursor-pointer">Mark all as read</span>
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="flex items-start space-x-3 p-2 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30">
                      <ShieldAlert className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold">Idle limit exceeded</p>
                        <p className="text-[11px] text-slate-400">User Michael Brown reached 20m idle time.</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 p-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold">Daily Backup Completed</p>
                        <p className="text-[11px] text-slate-400">System database backed up successfully.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Profile Dropdown Badge Header */}
            <div 
              onClick={() => setIsAuthenticated(false)}
              title="Click to Switch User / Sign Out"
              className={`flex items-center space-x-3 p-1.5 pr-3 rounded-full cursor-pointer transition-colors ${
                isDarkMode ? 'bg-slate-800/80 hover:bg-slate-800' : 'bg-slate-100/80 hover:bg-slate-200/80'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                {user.avatar || 'AS'}
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <p className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{user.name}</p>
                <p className="text-[10px] text-slate-400">
                  {session.isActive ? `Active · ${formatShortDuration(metrics.todayHoursSeconds)}` : 'Not Checked In'}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </div>
          </div>
        </header>

        {/* Dashboard Main Content Body */}
        <div className="p-8 space-y-6 max-w-7xl">

          {/* Section 2.2 & 2.3: Monitoring Active / Paused Banner for Employees */}
          {user.role === 'EMPLOYEE' && (
            <MonitoringBanner 
              isMonitoringActive={session.isActive}
              isPaused={isPaused}
              pausedSeconds={pausedSeconds}
              onPauseMonitoring={() => setIsPaused(true)}
              onResumeMonitoring={() => {
                setIsPaused(false);
                setPausedSeconds(0);
              }}
            />
          )}

          {/* ================= CONDITIONAL TAB RENDERING ================= */}

          {user.role === 'MANAGER' && (activeNav === 'Dashboard' || activeNav === 'Employee' || activeNav === 'Employees') ? (
            <ManagerDashboard activeNav={activeNav === 'Employees' ? 'Employee' : activeNav} />
          ) : user.role === 'MANAGER' && activeNav === 'Live Monitor' ? (
            <LiveMonitorView />
          ) : user.role === 'MANAGER' && activeNav === 'Attendance' ? (
            <ManagerAttendanceView />
          ) : user.role === 'MANAGER' && activeNav === 'Reports' ? (
            <ReportsView />
          ) : user.role === 'MANAGER' && activeNav === 'Notifications' ? (
            <ManagerNotificationsView />
          ) : user.role === 'MANAGER' && activeNav === 'Settings' ? (
            <ManagerSettingsView />
          ) : activeNav === 'Attendance' ? (
            <div className="space-y-6">
              <AttendanceActionCards />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2">
                  <ThisWeeksHoursWidget />
                </div>
                <div className="lg:col-span-1">
                  <MonthlySummaryWidget />
                </div>
              </div>
              <AttendanceHistoryTable />
            </div>
          ) : activeNav === 'Work Session' ? (
            <WorkSessionScreen />
          ) : activeNav === 'Productivity' ? (
            <div className="space-y-6">
              {/* Productivity Top Highlights Banner */}
              <ProductivityHighlightsBanner />

              {/* 3 Metric Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`p-6 rounded-3xl border shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'}`}>
                  <p className="text-xs font-medium text-slate-400">Productive App Time</p>
                  <h4 className="text-3xl font-extrabold text-emerald-500 mt-2">{formatShortDuration(metrics.activeTimeSeconds)}</h4>
                  <p className="text-xs text-emerald-600 font-semibold mt-1">↑ Calculated from active time</p>
                </div>

                <div className={`p-6 rounded-3xl border shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'}`}>
                  <p className="text-xs font-medium text-slate-400">Unproductive / Break Time</p>
                  <h4 className="text-3xl font-extrabold text-rose-500 mt-2">{Math.floor(session.breakSeconds / 60)}m</h4>
                  <p className="text-xs text-emerald-600 font-semibold mt-1">↓ Tracked break duration</p>
                </div>

                <div className={`p-6 rounded-3xl border shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'}`}>
                  <p className="text-xs font-medium text-slate-400">Overall Benchmark Score</p>
                  <h4 className="text-3xl font-extrabold text-indigo-500 mt-2">{metrics.productivityScore}%</h4>
                  <p className="text-xs text-indigo-500 font-semibold mt-1">Dynamic formula calculation</p>
                </div>
              </div>

              {/* Application Usage Breakdown Card */}
              <div className={`p-8 rounded-3xl border shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'}`}>
                <h3 className="text-xl font-bold mb-1 text-slate-800 dark:text-white">Application & Category Breakdown</h3>
                <p className="text-xs text-slate-400 mb-6">Detailed tracking of time spent per application</p>
                
                <div className="space-y-5">
                  {[
                    { name: 'Figma (Design & Prototype)', time: '3h 15m', pct: 52, type: 'productive' },
                    { name: 'VS Code (Development)', time: '2h 27m', pct: 39, type: 'productive' },
                    { name: 'Chrome (Research & Docs)', time: '45m', pct: 12, type: 'neutral' },
                    { name: 'Zoom (Team Sync)', time: '30m', pct: 8, type: 'productive' },
                    { name: 'YouTube (Social/Entertainment)', time: '14m', pct: 3, type: 'unproductive' },
                  ].map((app) => (
                    <div key={app.name} className="space-y-2">
                      <div className="flex justify-between items-center text-sm font-medium">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{app.name}</span>
                        <div className="flex items-center space-x-3">
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                            app.type === 'productive'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : app.type === 'unproductive'
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                          }`}>
                            {app.type}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-white">{app.time}</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            app.type === 'productive' ? 'bg-emerald-500' : app.type === 'unproductive' ? 'bg-rose-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${app.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeNav === 'Screenshots' ? (
            <ScreenshotsView />
          ) : activeNav === 'Recordings' ? (
            <RecordingsView />
          ) : (
            /* DEFAULT DASHBOARD VIEW */
            <>
              {/* Active Session Bar */}
              <div className={`border rounded-2xl p-4 px-6 flex flex-col sm:flex-row items-center justify-between shadow-sm gap-4 transition-colors ${
                isDarkMode ? 'bg-indigo-950/30 border-indigo-900/50' : 'bg-indigo-50/70 border-indigo-100'
              }`}>
                <div className="flex items-center space-x-3">
                  <span className="relative flex h-3 w-3">
                    {session.isActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${session.isActive ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                  </span>
                  <p className={`font-semibold text-base ${isDarkMode ? 'text-indigo-200' : 'text-indigo-950'}`}>
                    {session.isActive ? (session.status === 'On Break' ? 'On Break' : 'Active Work Session') : 'Session Paused / Not Checked In'} 
                    <span className="text-[#64748b] font-normal text-sm ml-2">
                      · Total Logged Today: {formatDuration(metrics.todayHoursSeconds)}
                    </span>
                  </p>
                </div>
                <button 
                  onClick={() => {
                    if (session.isActive) {
                      handleCheckOut();
                    } else {
                      handleCheckIn();
                    }
                  }}
                  className={`px-5 py-2.5 text-white font-medium text-sm rounded-xl shadow-md transition-all flex items-center space-x-2 ${
                    session.isActive 
                      ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' 
                      : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  }`}
                >
                  {session.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span>{session.isActive ? 'Check Out / Pause' : 'Check In / Start'}</span>
                </button>
              </div>

              {/* 4 Metric Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                {/* Card 1: Tracked Hours */}
                <div className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all hover:shadow-md ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                      <Clock className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center space-x-0.5">
                      <span>↑ 5%</span>
                    </span>
                  </div>
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-400">Total Hours Today</p>
                    <h3 className={`text-2xl font-bold mt-0.5 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{formatShortDuration(metrics.todayHoursSeconds)}</h3>
                    <p className="text-xs text-slate-400 mt-1">Target: 8h 0m</p>
                  </div>
                </div>

                {/* Card 2: Productivity Score */}
                <div className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all hover:shadow-md ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <TrendingUp className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center space-x-0.5">
                      <span>↑ 8%</span>
                    </span>
                  </div>
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-400">Productivity Score</p>
                    <h3 className={`text-2xl font-bold mt-0.5 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{metrics.productivityScore}%</h3>
                    <p className="text-xs text-emerald-500 mt-1">Calculated formula score</p>
                  </div>
                </div>

                {/* Card 3: Active Time */}
                <div className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all hover:shadow-md ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500">
                      <Activity className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold text-rose-500 bg-rose-500/10 px-2 py-1 rounded-full flex items-center space-x-0.5">
                      <span>↓ 2%</span>
                    </span>
                  </div>
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-400">Active Keyboard/Mouse Time</p>
                    <h3 className={`text-2xl font-bold mt-0.5 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{formatShortDuration(metrics.activeTimeSeconds)}</h3>
                    <p className="text-xs text-slate-400 mt-1">Shift efficiency</p>
                  </div>
                </div>

                {/* Card 4: Tasks Completed */}
                <div className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all hover:shadow-md ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                      <Target className="w-6 h-6" />
                    </div>
                    <button
                      onClick={handleCompleteTask}
                      title="Click to complete a task and trigger live productivity recalculation"
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-full flex items-center space-x-1 transition-all active:scale-95 cursor-pointer"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>+ Done</span>
                    </button>
                  </div>
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-400">Tasks Completed</p>
                    <h3 className={`text-2xl font-bold mt-0.5 ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                      {metrics.completedTasks} / {metrics.totalTasksAssigned || 15}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {metrics.totalTasksAssigned > 0 ? Math.round((metrics.completedTasks / metrics.totalTasksAssigned) * 100) : 0}% completion rate
                    </p>
                  </div>
                </div>

              </div>

              {/* Weekly Productivity Bar Chart (Full Width) */}
              <div className={`p-6 rounded-2xl border shadow-sm flex flex-col justify-between ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'
              }`}>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h4 className={`font-bold text-lg ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Weekly Productivity Breakdown</h4>
                    <p className="text-xs text-slate-400">Tracked vs Productive Hours per day</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {(['This Week', 'Last Week', 'This Month'] as const).map((tf) => (
                      <button 
                        key={tf}
                        onClick={() => setSelectedTimeframe(tf)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                          selectedTimeframe === tf
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : isDarkMode
                              ? 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Reactive SVG Bar Chart */}
                <div className="h-64 w-full flex items-end justify-between gap-4 pt-6 px-4 pb-2 border-b border-slate-100 dark:border-slate-800">
                  {weeklyHoursData.map((item) => {
                    const heightPct = Math.min(100, (item.hours / 10) * 100);
                    return (
                      <div key={item.day} className="flex-1 flex flex-col items-center h-full justify-end group">
                        <div className="w-full max-w-[56px] bg-slate-100 dark:bg-slate-800 rounded-t-xl overflow-hidden relative transition-all duration-300 group-hover:scale-105" style={{ height: `${heightPct}%` }}>
                          <div 
                            className="w-full bg-gradient-to-t from-indigo-600 to-indigo-500 rounded-t-xl transition-all h-full" 
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-400 mt-3">{item.day}</span>
                        <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-6 bg-slate-800 text-white px-2 py-0.5 rounded shadow">
                          {item.hours}h
                        </span>
                      </div>
                    );
                  })}
                </div>
                
                <div className="flex items-center justify-center space-x-6 mt-4 text-xs font-medium">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-indigo-600"></span>
                    <span className="text-slate-400">Productive Hours</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-slate-300 dark:bg-slate-700"></span>
                    <span className="text-slate-400">Idle / Break</span>
                  </div>
                </div>
              </div>

              {/* Attendance Breakdown Box */}
              <div className="w-full">
                <ThisMonthWidget />
              </div>

              {/* Activity Feed Table Section */}
              <div className={`p-6 rounded-2xl border shadow-sm ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80'
              }`}>
                <div className="flex items-center justify-between mb-4">
                  <h4 className={`font-bold text-lg ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Real-Time Activity Audit Log</h4>
                  <button className="flex items-center space-x-1.5 text-xs text-indigo-500 font-semibold hover:underline">
                    <Filter className="w-3.5 h-3.5" />
                    <span>Filter Logs</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${
                        isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
                      }`}>
                        <th className="pb-3 px-2">Employee</th>
                        <th className="pb-3 px-2">Application / Action</th>
                        <th className="pb-3 px-2">Category</th>
                        <th className="pb-3 px-2 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredActivities.map((act) => (
                        <tr key={act.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-2 font-semibold text-slate-800 dark:text-slate-200">{act.user}</td>
                          <td className="py-3 px-2 text-slate-600 dark:text-slate-400">{act.action}</td>
                          <td className="py-3 px-2">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                              act.category === 'productive' 
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                                : act.category === 'unproductive'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                  : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                            }`}>
                              {act.category}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right text-xs text-slate-400">{act.time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </div>

        {/* Floating Help Button */}
        <button 
          title="Support & Assistance"
          className={`fixed bottom-6 right-6 p-3 shadow-xl rounded-full border transition-all hover:scale-105 ${
            isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <HelpCircle className="w-5 h-5" />
        </button>

      </main>
    </div>
  );
};

export const EmployeeDashboard = AdminDashboard;
export default AdminDashboard;