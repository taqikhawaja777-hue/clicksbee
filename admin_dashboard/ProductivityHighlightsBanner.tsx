import React from 'react';
import { Award, CheckCircle2, Target, Clock } from 'lucide-react';
import { useEmployee } from './EmployeeContext';

export const ProductivityHighlightsBanner: React.FC = () => {
  const { metrics, session } = useEmployee();

  const avgHours = (metrics.todayHoursSeconds / 3600).toFixed(1);

  const highlightMetrics = [
    {
      id: 'productivity',
      icon: Award,
      value: `${metrics.productivityScore}%`,
      label: 'Productivity Score',
    },
    {
      id: 'attendance',
      icon: CheckCircle2,
      value: `${metrics.attendanceRate}%`,
      label: 'Attendance Rate',
    },
    {
      id: 'tasks',
      icon: Target,
      value: `${metrics.completedTasks}/${metrics.totalTasksAssigned || 15}`,
      label: 'Tasks Completed',
    },
    {
      id: 'hours',
      icon: Clock,
      value: `${avgHours}h`,
      label: 'Today Hours Logged',
    },
  ];

  return (
    <div className="relative w-full bg-gradient-to-r from-[#5a52f2] to-[#6860f6] rounded-3xl p-8 text-white font-sans overflow-hidden shadow-lg shadow-indigo-200/40">
      
      {/* Decorative Semi-Transparent Background Circles */}
      <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-white/10 pointer-events-none" />
      <div className="absolute -right-8 -bottom-16 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />

      {/* 4 Metric Grid Row */}
      <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-6 items-center">
        {highlightMetrics.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex flex-col items-center justify-center text-center space-y-1.5"
            >
              {/* Icon */}
              <Icon className="w-6 h-6 text-white/90 stroke-[2]" />

              {/* Metric Value */}
              <h2 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
                {item.value}
              </h2>

              {/* Metric Label */}
              <p className="text-xs font-medium text-indigo-100/80 tracking-wide">
                {item.label}
              </p>
            </div>
          );
        })}
      </div>

    </div>
  );
};

export default ProductivityHighlightsBanner;
