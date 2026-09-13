import React from 'react';
import { useEmployee } from './EmployeeContext';

export interface SummaryItem {
  label: string;
  value: string | number;
  colorClass: string;
}

export const MonthlySummaryWidget: React.FC = () => {
  const { monthlyAttendanceSummary } = useEmployee();
  const { presentDays, lateDays, absentDays, leaveDays, totalDaysElapsed } = monthlyAttendanceSummary;

  // Real calendar days in the current month, so "Working Days" reads as
  // "how far into the month we are" (e.g. "11 / 30") instead of the old
  // fixed "14 / 21" that never changed regardless of the actual date.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // Data configuration for monthly summary rows - sourced from the same
  // real /api/reports/attendance rows as the Dashboard's "This Month"
  // card. Late/Half Day/Leaves stay honestly 0 (no backend concept of
  // lateness or half-days exists yet) rather than the previous hardcoded
  // non-zero values.
  const summaryData: SummaryItem[] = [
    { label: 'Working Days', value: `${totalDaysElapsed} / ${daysInMonth}`, colorClass: 'text-slate-900 dark:text-white font-bold' },
    { label: 'Present', value: presentDays, colorClass: 'text-emerald-500 font-bold' },
    { label: 'Absent', value: absentDays, colorClass: 'text-rose-500 font-bold' },
    { label: 'Late', value: lateDays, colorClass: 'text-amber-500 font-bold' },
    { label: 'Half Day', value: 0, colorClass: 'text-cyan-500 font-bold' },
    { label: 'Leaves', value: leaveDays, colorClass: 'text-indigo-500 font-bold' },
  ];

  return (
    <div className="w-full bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans transition-colors">
      
      {/* Card Header */}
      <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-6">
        Monthly Summary
      </h3>

      {/* Rows Container */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {summaryData.map((item, index) => (
          <div
            key={item.label}
            className={`flex items-center justify-between py-3.5 ${
              index === 0 ? 'pb-3.5 pt-0' : ''
            }`}
          >
            {/* Label */}
            <span className="text-sm font-medium text-slate-400 dark:text-slate-400">
              {item.label}
            </span>

            {/* Value Badge */}
            <span className={`text-base tracking-tight ${item.colorClass}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
};

export default MonthlySummaryWidget;
