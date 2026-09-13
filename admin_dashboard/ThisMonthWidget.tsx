import React from 'react';
import { useEmployee } from './EmployeeContext';

interface AttendanceCategory {
  label: string;
  days: number;
  percentage: number;
  color: string;
}

export const ThisMonthWidget: React.FC = () => {
  const { monthlyAttendanceSummary } = useEmployee();
  const { presentDays, lateDays, absentDays, leaveDays, totalDaysElapsed } = monthlyAttendanceSummary;

  const pct = (n: number) => (totalDaysElapsed > 0 ? Math.round((n / totalDaysElapsed) * 100) : 0);

  const stats: AttendanceCategory[] = [
    { label: 'Present', days: presentDays, percentage: pct(presentDays), color: 'bg-emerald-500' },
    { label: 'Late', days: lateDays, percentage: pct(lateDays), color: 'bg-amber-500' },
    { label: 'Absent', days: absentDays, percentage: pct(absentDays), color: 'bg-rose-500' },
    { label: 'Leaves', days: leaveDays, percentage: pct(leaveDays), color: 'bg-indigo-500' },
  ];

  return (
    <div className="w-full bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans transition-colors">
      
      {/* Title */}
      <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-6">
        This Month
      </h3>

      {/* Progress Bars Section */}
      <div className="space-y-6">
        {stats.map((item) => (
          <div key={item.label} className="space-y-2">
            
            {/* Label and Day Count Header */}
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-slate-600 dark:text-slate-300 font-semibold">{item.label}</span>
              <span className="text-slate-900 dark:text-white font-bold">{item.days} days</span>
            </div>

            {/* Custom Styled Progress Track */}
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${item.color}`}
                style={{ width: `${item.percentage}%` }}
              />
            </div>

          </div>
        ))}
      </div>

    </div>
  );
};

export default ThisMonthWidget;
