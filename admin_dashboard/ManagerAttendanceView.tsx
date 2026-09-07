import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import {
  Download,
  ChevronDown,
  Check
} from 'lucide-react';
import { productivityApiService } from './src/services/productivityApi.service';

export interface MonthlyAttendancePoint {
  month: string;
  rate: number;
}

export interface AttendanceRecordRow {
  id: string;
  employee: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  hours: string;
  status: 'Present' | 'On Break' | 'Absent';
  approved: boolean;
}

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const REFRESH_INTERVAL_MS = 30000;

export const ManagerAttendanceView: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecordRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [presentCount, setPresentCount] = useState<number>(0);
  const [absentCount, setAbsentCount] = useState<number>(0);
  const [onBreakCount, setOnBreakCount] = useState<number>(0);
  const [attendanceRate, setAttendanceRate] = useState<number>(0);
  const [monthlyData, setMonthlyData] = useState<MonthlyAttendancePoint[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const empRes = await fetch('http://localhost:3000/api/v1/employees/all');
        const empJson = await empRes.json();
        const employeesList: any[] = empJson?.data?.data || [];
        const departmentByName = new Map(employeesList.map((e) => [e.name, e.department] as const));

        const today = todayDateKey();
        const [todayReport, idleSummary] = await Promise.all([
          productivityApiService.getAttendanceReport(today, today),
          productivityApiService.getIdleTimeSummary(),
        ]);
        const liveByName = new Map(idleSummary.employees.map((e) => [e.employeeName, e] as const));

        const mapped: AttendanceRecordRow[] = todayReport.rows.map((row) => {
          const live = liveByName.get(row.employeeName);
          const onBreak = live?.status === 'ON_BREAK';
          const status: AttendanceRecordRow['status'] =
            row.attendanceStatus === 'ABSENT' ? 'Absent' : onBreak ? 'On Break' : 'Present';
          return {
            id: row.employeeId,
            employee: row.employeeName,
            department: departmentByName.get(row.employeeName) || 'Engineering',
            date: today,
            checkIn: row.checkInAt
              ? new Date(row.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '--',
            checkOut: row.stillCheckedIn
              ? 'Shift Active'
              : row.checkOutAt
                ? new Date(row.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '--',
            hours: row.shiftDurationSeconds > 0 ? formatDuration(row.shiftDurationSeconds) : '--',
            status,
            approved: row.attendanceStatus === 'PRESENT',
          };
        });

        setRecords(mapped);
        const pres = mapped.filter((r) => r.status === 'Present').length;
        const abs = mapped.filter((r) => r.status === 'Absent').length;
        const brk = mapped.filter((r) => r.status === 'On Break').length;
        setPresentCount(pres);
        setAbsentCount(abs);
        setOnBreakCount(brk);
        setAttendanceRate(mapped.length > 0 ? Math.round(((pres + brk) / mapped.length) * 100) : 0);

        // Monthly Attendance Rate - last 6 calendar months of real
        // attendance_status data. Fast enough for this range now that
        // get_report_rows() fetches once per employee for the whole
        // window instead of once per employee per day (was ~14s for an
        // 8-day range, is ~2-3s for 6 months after that fix).
        const now = new Date();
        const rangeStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const rangeStartKey = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, '0')}-01`;
        const monthlyReport = await productivityApiService.getAttendanceReport(rangeStartKey, today);
        const byMonth = new Map<string, { present: number; total: number }>();
        for (const row of monthlyReport.rows) {
          const monthKey = row.date.slice(0, 7); // YYYY-MM
          const bucket = byMonth.get(monthKey) || { present: 0, total: 0 };
          bucket.total += 1;
          if (row.attendanceStatus === 'PRESENT') bucket.present += 1;
          byMonth.set(monthKey, bucket);
        }
        const points: MonthlyAttendancePoint[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const bucket = byMonth.get(key);
          points.push({
            month: d.toLocaleDateString('en-US', { month: 'short' }),
            rate: bucket && bucket.total > 0 ? Math.round((bucket.present / bucket.total) * 100) : 0,
          });
        }
        setMonthlyData(points);
      } catch (e) {
        console.warn('ManagerAttendanceView fetch error:', e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const filteredRecords = records.filter(r => {
    if (statusFilter === 'All') return true;
    return r.status === statusFilter;
  });

  const handleApproveRow = (id: string) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, approved: true } : r));
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      
      {/* 1. Attendance Management Top Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Attendance Management
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* 2. 4 Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Present Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[130px]">
          <p className="text-xs font-semibold text-slate-400">
            Present
          </p>
          <h2 className="text-4xl font-extrabold text-[#10b981] tracking-tight mt-2">
            {presentCount}
          </h2>
        </div>

        {/* Absent Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[130px]">
          <p className="text-xs font-semibold text-slate-400">
            Absent
          </p>
          <h2 className="text-4xl font-extrabold text-[#ef4444] tracking-tight mt-2">
            {absentCount}
          </h2>
        </div>

        {/* On Break Card - replaces the old "Late" card, which had no real
            signal behind it (no shift-start-time is tracked to compare
            against) and was permanently stuck at 0. On Break is real,
            live data from the same source as everywhere else in the app. */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[130px]">
          <p className="text-xs font-semibold text-slate-400">
            On Break
          </p>
          <h2 className="text-4xl font-extrabold text-[#f59e0b] tracking-tight mt-2">
            {onBreakCount}
          </h2>
        </div>

        {/* Attendance Rate Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[130px]">
          <p className="text-xs font-semibold text-slate-400">
            Attendance Rate
          </p>
          <h2 className="text-4xl font-extrabold text-[#6366f1] tracking-tight mt-2">
            {attendanceRate}%
          </h2>
        </div>

      </div>

      {/* 3. Monthly Attendance Rate Line Chart */}
      <div className="bg-white dark:bg-slate-900 p-7 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6">
          Monthly Attendance Rate
        </h3>

        <div className="w-full h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData} margin={{ top: 10, right: 30, left: -10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#f1f5f9" />
              <XAxis 
                dataKey="month" 
                stroke="#94a3b8" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false}
                dy={10}
              />
              <YAxis
                // 0-100 (was a fixed 80-100 domain) - real months with no
                // employees yet, or nobody checked in, legitimately show
                // 0%, which the old range would have clipped off-chart.
                domain={[0, 100]}
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                dx={-10}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#0f172a', 
                  borderColor: '#334155', 
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '12px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
                }}
                formatter={(val: number) => [`${val}%`, 'Attendance Rate']}
              />
              <Line 
                type="monotone" 
                dataKey="rate" 
                stroke="#10b981" 
                strokeWidth={3} 
                dot={{ r: 6, fill: '#10b981', strokeWidth: 2, stroke: '#ffffff' }}
                activeDot={{ r: 8, fill: '#059669', strokeWidth: 3, stroke: '#ffffff' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* 4. ATTENDANCE RECORDS TABLE (MATCHING USER SCREENSHOT) */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        
        {/* Table Header Controls */}
        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Attendance Records — {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </h2>

          <div className="flex items-center space-x-3">
            {/* Filter Dropdown */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none px-4 py-2 pr-8 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="All">All</option>
                <option value="Present">Present</option>
                <option value="On Break">On Break</option>
                <option value="Absent">Absent</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Export Button */}
            <button className="px-4 py-2 bg-[#534bf3] hover:bg-[#4338ca] text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-indigo-500/20 transition-all active:scale-98 cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/70 dark:bg-slate-800/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-y border-slate-100 dark:border-slate-800">
                <th className="py-4 px-6">EMPLOYEE</th>
                <th className="py-4 px-6">DEPARTMENT</th>
                <th className="py-4 px-6">DATE</th>
                <th className="py-4 px-6">CHECK IN</th>
                <th className="py-4 px-6">CHECK OUT</th>
                <th className="py-4 px-6">HOURS</th>
                <th className="py-4 px-6">STATUS</th>
                <th className="py-4 px-6 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {filteredRecords.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                  
                  {/* Employee Name */}
                  <td className="py-4 px-6 font-bold text-slate-900 dark:text-white text-xs">
                    {row.employee}
                  </td>

                  {/* Department */}
                  <td className="py-4 px-6 text-xs text-slate-600 dark:text-slate-300 font-medium">
                    {row.department}
                  </td>

                  {/* Date */}
                  <td className="py-4 px-6 text-xs text-slate-500 dark:text-slate-400">
                    {row.date}
                  </td>

                  {/* Check In */}
                  <td className="py-4 px-6 text-xs font-bold text-slate-700 dark:text-slate-300">
                    {row.checkIn}
                  </td>

                  {/* Check Out */}
                  <td className="py-4 px-6 text-xs font-bold text-slate-700 dark:text-slate-300">
                    {row.checkOut}
                  </td>

                  {/* Hours */}
                  <td className="py-4 px-6 text-xs font-black text-slate-900 dark:text-white">
                    {row.hours}
                  </td>

                  {/* Status Pill Badge */}
                  <td className="py-4 px-6">
                    {row.status === 'Present' && (
                      <span className="inline-block bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        Present
                      </span>
                    )}
                    {row.status === 'On Break' && (
                      <span className="inline-block bg-amber-100/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        On Break
                      </span>
                    )}
                    {row.status === 'Absent' && (
                      <span className="inline-block bg-rose-100/80 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        Absent
                      </span>
                    )}
                  </td>

                  {/* Action Button */}
                  <td className="py-4 px-6 text-right">
                    {row.approved ? (
                      <span className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        <Check className="w-3.5 h-3.5 mr-0.5" /> Approved
                      </span>
                    ) : (
                      <button
                        onClick={() => handleApproveRow(row.id)}
                        className="px-4 py-1.5 bg-[#534bf3] hover:bg-[#4338ca] text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-500/20 transition-all active:scale-98 cursor-pointer"
                      >
                        Approve
                      </button>
                    )}
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};

export default ManagerAttendanceView;
