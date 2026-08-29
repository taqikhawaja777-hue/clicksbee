import React from 'react';
import { 
  Users, 
  TrendingUp, 
  Clock, 
  ShieldCheck, 
  ArrowUpRight,
  Download,
  Layers,
  UserCheck
} from 'lucide-react';
import { useEmployee } from './EmployeeContext';
import { WeeklyAttendanceAnalytics } from './WeeklyAttendanceAnalytics';
import { EmployeeStatusOverviewCards } from './EmployeeStatusOverviewCards';
import { EmployeeDirectoryTable } from './EmployeeDirectoryTable';

interface ManagerDashboardProps {
  activeNav?: string;
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ activeNav = 'Dashboard' }) => {
  const { user } = useEmployee();
  const [totalCount, setTotalCount] = React.useState<number>(1);
  const [activeCount, setActiveCount] = React.useState<number>(1);

  React.useEffect(() => {
    fetch('http://localhost:3000/api/v1/employees')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.totalCount === 'number') {
          setTotalCount(data.totalCount);
          setActiveCount(data.activeCount || 0);
        } else if (Array.isArray(data)) {
          setTotalCount(data.length);
          setActiveCount(data.filter((e: any) => e.status === 'ACTIVE' || e.status === 'Online').length);
        }
      })
      .catch(e => console.warn('ManagerDashboard employees fetch error:', e));
  }, []);

  // Render Employee View when activeNav === 'Employee'
  if (activeNav === 'Employee') {
    return (
      <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
        
        {/* Header Banner */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
              <Users className="w-3.5 h-3.5" />
              <span>Team Directory</span>
            </div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Managed Employees</h1>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Real-time status monitoring, activity records, and productivity benchmarks.</p>
          </div>

          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
              {totalCount} Total Employees
            </span>
          </div>
        </div>

        {/* 1. EMPLOYEE STATUS OVERVIEW CARDS */}
        <EmployeeStatusOverviewCards />

        {/* 2. NEW EMPLOYEE DIRECTORY TABLE (MATCHING SCREENSHOT) */}
        <EmployeeDirectoryTable />

      </div>
    );
  }

  // Render Main Manager Dashboard View (when activeNav === 'Dashboard')
  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      
      {/* 1. Manager Welcome Banner */}
      <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 rounded-3xl p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center space-x-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold text-indigo-100 mb-3 border border-white/20">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>Manager Supervisor Portal</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              Welcome Back, {user.name || 'Taqi Khawaja'}
            </h1>
            <p className="text-indigo-100 text-sm mt-1 max-w-xl">
              Real-time workforce monitoring, active employee tracking, and team productivity analytics for {user.email}.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button className="px-5 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-2xl text-xs font-bold text-white transition-all flex items-center space-x-2">
              <Download className="w-4 h-4" />
              <span>Export Team Audit</span>
            </button>
            <button className="px-5 py-2.5 bg-white text-indigo-700 hover:bg-indigo-50 rounded-2xl text-xs font-extrabold transition-all shadow-lg flex items-center space-x-2">
              <Layers className="w-4 h-4" />
              <span>Manage Projects</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. 4 Summary Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* Total Managed Employees */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total Managed Team</span>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-slate-900 dark:text-white">{totalCount}</h3>
            <p className="text-xs text-emerald-600 font-semibold mt-1 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> 100% Onboarding complete
            </p>
          </div>
        </div>

        {/* Active Online Right Now */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Active Employees Now</span>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-emerald-600">{activeCount}</h3>
            <p className="text-xs text-slate-500 font-medium mt-1">
              {Math.max(0, totalCount - activeCount)} Offline / Idle
            </p>
          </div>
        </div>

        {/* Average Team Productivity */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Avg Team Productivity</span>
            <div className="p-2.5 bg-purple-50 dark:bg-purple-950/50 rounded-2xl text-purple-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-purple-600">93%</h3>
            <p className="text-xs text-emerald-600 font-semibold mt-1">+5.2% vs last week</p>
          </div>
        </div>

        {/* Total Hours Logged Today */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total Logged Today</span>
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/50 rounded-2xl text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-3xl font-black text-slate-900 dark:text-white">368h 40m</h3>
            <p className="text-xs text-slate-500 font-medium mt-1">Across 46 active sessions</p>
          </div>
        </div>

      </div>

      {/* 3. WEEKLY ATTENDANCE ANALYTICS CHART */}
      <WeeklyAttendanceAnalytics />

      {/* 4. NEW EMPLOYEE DIRECTORY TABLE (IN THE END) */}
      <EmployeeDirectoryTable />

    </div>
  );
};

export default ManagerDashboard;
