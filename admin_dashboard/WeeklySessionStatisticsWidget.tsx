import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useEmployee } from './EmployeeContext';

export const WeeklySessionStatisticsWidget: React.FC = () => {
  const { weeklyHoursData } = useEmployee();

  return (
    <div className="w-full bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans transition-colors">
      
      {/* Title */}
      <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-6">
        Weekly Session Statistics
      </h3>

      {/* Chart Container */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={weeklyHoursData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            {/* Dashed Grid Lines */}
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={true}
              horizontal={true}
              stroke="#e2e8f0"
            />

            {/* X-Axis Days */}
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }}
              dy={10}
            />

            {/* Y-Axis Hours (0, 3, 6, 9, 12) */}
            <YAxis
              domain={[0, 12]}
              ticks={[0, 3, 6, 9, 12]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }}
              dx={-5}
            />

            {/* Tooltip on Hover */}
            <Tooltip
              cursor={{ fill: 'transparent' }}
              formatter={(value: number) => [`${value} hrs`, 'Session Duration']}
              contentStyle={{
                backgroundColor: '#1e293b',
                borderRadius: '12px',
                color: '#fff',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
              itemStyle={{ color: '#f59e0b', fontWeight: 600 }}
            />

            {/* Solid Rounded Orange Bars */}
            <Bar
              dataKey="hours"
              fill="#f59e0b"
              radius={[8, 8, 0, 0]}
              barSize={60}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

    </div>
  );
};

export default WeeklySessionStatisticsWidget;
