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
  status: 'Present' | 'Late' | 'Absent' | 'Half Day' | 'Holiday';
  approved: boolean;
}

const monthlyData: MonthlyAttendancePoint[] = [
  { month: 'Jan', rate: 94 },
  { month: 'Feb', rate: 91 },
  { month: 'Mar', rate: 96 },
  { month: 'Apr', rate: 92 },
  { month: 'May', rate: 95 },
  { month: 'Jun', rate: 89 },
];

const initialRecords: AttendanceRecordRow[] = [];

export const ManagerAttendanceView: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecordRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [presentCount, setPresentCount] = useState<number>(0);
  const [absentCount, setAbsentCount] = useState<number>(0);
  const [lateCount, setLateCount] = useState<number>(0);
  const [attendanceRate, setAttendanceRate] = useState<number>(100);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/employees')
      .then(res => res.json())
      .then(json => {
        let list: any[] = [];
        if (Array.isArray(json)) list = json;
        else if (json?.data?.data && Array.isArray(json.data.data)) list = json.data.data;
        else if (json?.data && Array.isArray(json.data)) list = json.data;

        if (list.length > 0) {
          const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const mapped: AttendanceRecordRow[] = list.map((emp: any, idx: number) => {
            const isPresent = emp.status === 'ACTIVE' || emp.checkIn !== '--';
            return {
              id: emp.id || `rec-${idx}`,
              employee: emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Registered User',
              department: typeof emp.department === 'string' ? emp.department : (emp.department?.name || 'Engineering'),
              date: todayStr,
              checkIn: emp.checkIn || '--',
              checkOut: isPresent ? 'Shift Active' : '--',
              hours: isPresent ? '00:34:15 (Live)' : '--',
              status: isPresent ? 'Present' : 'Absent',
              approved: isPresent,
            };
          });

          setRecords(mapped);
          const pres = mapped.filter(r => r.status === 'Present').length;
          const abs = mapped.filter(r => r.status === 'Absent').length;
          const lt = mapped.filter(r => r.status === 'Late').length;

          setPresentCount(pres);
          setAbsentCount(abs);
          setLateCount(lt);
          setAttendanceRate(mapped.length > 0 ? Math.round((pres / mapped.length) * 100) : 100);
        } else {
          setRecords([]);
        }
      })
      .catch(e => console.warn('ManagerAttendanceView fetch error:', e));
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

        {/* Late Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[130px]">
          <p className="text-xs font-semibold text-slate-400">
            Late
          </p>
          <h2 className="text-4xl font-extrabold text-[#f59e0b] tracking-tight mt-2">
            {lateCount}
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
                domain={[80, 100]} 
                ticks={[80, 85, 90, 95, 100]} 
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
            Attendance Records — Jun 13, 2026
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
                <option value="Late">Late</option>
                <option value="Absent">Absent</option>
                <option value="Half Day">Half Day</option>
                <option value="Holiday">Holiday</option>
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
                    {row.status === 'Late' && (
                      <span className="inline-block bg-amber-100/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        Late
                      </span>
                    )}
                    {row.status === 'Absent' && (
                      <span className="inline-block bg-rose-100/80 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        Absent
                      </span>
                    )}
                    {row.status === 'Half Day' && (
                      <span className="inline-block bg-cyan-100/80 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        Half Day
                      </span>
                    )}
                    {row.status === 'Holiday' && (
                      <span className="inline-block bg-purple-100/80 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full text-[11px] font-bold">
                        Holiday
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
