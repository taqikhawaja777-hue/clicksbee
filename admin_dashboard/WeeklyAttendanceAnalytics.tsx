import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';

export interface AttendanceAnalyticsData {
  day: string;
  Present: number;
  Absent: number;
}

// "Late" was dropped from this chart - the backend doesn't track a shift
// start time to compare against, so there's no real signal behind it (the
// mock data's Late numbers were invented). Present/Absent both come from
// shift_events-derived attendanceStatus, which is real.
export const WeeklyAttendanceAnalytics: React.FC<{ data?: AttendanceAnalyticsData[] }> = ({ data }) => {
  if (!data) {
    return (
      <div className="bg-[#0b1329] border border-slate-800/80 rounded-3xl p-6 shadow-2xl text-white font-sans">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white">Weekly Attendance Analytics</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Overall weekly team attendance distribution across days</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 text-center py-16">Loading attendance data…</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0b1329] border border-slate-800/80 rounded-3xl p-6 shadow-2xl text-white font-sans">
      
      {/* Chart Title */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-white">Weekly Attendance Analytics</h3>
          <p className="text-xs text-slate-400 font-medium mt-0.5">Overall weekly team attendance distribution across days</p>
        </div>

        <div className="flex items-center space-x-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span className="font-semibold">Live Mongo Stats</span>
        </div>
      </div>

      {/* Chart Container */}
      <div className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 0, bottom: 10 }}
            barSize={36}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              vertical={true} 
              horizontal={true}
              stroke="#1e293b" 
            />
            <XAxis 
              dataKey="day" 
              stroke="#64748b"
              fontSize={13}
              tickLine={false}
              axisLine={false}
              dy={10}
            />
            <YAxis
              stroke="#64748b"
              fontSize={13}
              // Auto-scaled (was a fixed 0-60 domain sized for the old
              // mock data's ~46-person team) - allowInt keeps ticks on
              // whole numbers, appropriate for a real, much smaller
              // headcount rather than always rendering flat bars.
              allowDecimals={false}
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
              cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
            />
            <Legend 
              verticalAlign="bottom" 
              align="center"
              iconType="square"
              wrapperStyle={{ paddingTop: '20px' }}
              formatter={(value: string | number) => <span className="text-xs font-semibold text-slate-300 ml-1 mr-4">{value}</span>}
            />
            <Bar dataKey="Present" fill="#10b981" radius={[6, 6, 0, 0]} name="Present" />
            <Bar dataKey="Absent" fill="#ef4444" radius={[6, 6, 0, 0]} name="Absent" />
          </BarChart>
        </ResponsiveContainer>
      </div>

    </div>
  );
};

export default WeeklyAttendanceAnalytics;
