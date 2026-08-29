import React from 'react';
import { useEmployee } from './EmployeeContext';

interface AttendanceCategory {
  label: string;
  days: number;
  percentage: number;
  color: string;
}

export const ThisMonthWidget: React.FC = () => {
  const { attendanceHistory } = useEmployee();

  const totalLogs = attendanceHistory.length;
  const presentCount = attendanceHistory.filter(a => a.status === 'Present').length;
  const lateCount = attendanceHistory.filter(a => a.status === 'Late').length;
  const absentCount = attendanceHistory.filter(a => a.status === 'Absent').length;
  const leaveCount = attendanceHistory.filter(a => a.status === 'Leave' || a.status === 'Holiday').length;

  const stats: AttendanceCategory[] = [
    { 
      label: 'Present', 
      days: presentCount, 
      percentage: totalLogs > 0 ? Math.round((presentCount / totalLogs) * 100) : 0, 
      color: 'bg-emerald-500' 
    },
    { 
      label: 'Late', 
      days: lateCount, 
      percentage: totalLogs > 0 ? Math.round((lateCount / totalLogs) * 100) : 0, 
      color: 'bg-amber-500' 
    },
    { 
      label: 'Absent', 
      days: absentCount, 
      percentage: totalLogs > 0 ? Math.round((absentCount / totalLogs) * 100) : 0, 
      color: 'bg-rose-500' 
    },
    { 
      label: 'Leaves', 
      days: leaveCount, 
      percentage: totalLogs > 0 ? Math.round((leaveCount / totalLogs) * 100) : 0, 
      color: 'bg-indigo-500' 
    },
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
