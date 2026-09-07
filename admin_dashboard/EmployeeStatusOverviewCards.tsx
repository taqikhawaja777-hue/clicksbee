import React, { useState, useEffect } from 'react';
import { productivityApiService } from './src/services/productivityApi.service';

interface MetricCardProps {
  label: string;
  value: number | string;
  valueColorClass: string;
}

const POLL_INTERVAL_MS = 30000;

export const EmployeeStatusOverviewCards: React.FC = () => {
  const [total, setTotal] = useState<number>(0);
  const [active, setActive] = useState<number>(0);
  const [onBreak, setOnBreak] = useState<number>(0);
  const [inactive, setInactive] = useState<number>(0);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/v1/employees/all');
        const json = await res.json();
        let list: any[] = [];
        if (Array.isArray(json)) list = json;
        else if (json?.data?.data && Array.isArray(json.data.data)) list = json.data.data;
        else if (json?.data && Array.isArray(json.data)) list = json.data;

        const tot = list.length;

        // MongoDB's own `status` field only ever comes back as 'ACTIVE' or
        // 'INACTIVE' in practice - the previous version's break-detection
        // checked for 'On Break'/'Break', which never matches the real
        // 'BREAK' value, so On Break was permanently stuck at 0 regardless
        // of anyone's actual state. Cross-referencing productivity_service
        // (the same live, real-time source already used by the Employee
        // Directory table and Dashboard) fixes that and keeps this card
        // consistent with the rest of the app rather than introducing yet
        // another separate status definition.
        let onBreakCount = 0;
        let activeCount = 0;
        try {
          const [employeesList, idleSummary] = await Promise.all([
            productivityApiService.listEmployees(),
            productivityApiService.getIdleTimeSummary(),
          ]);
          const idToEmail = new Map(employeesList.map((e) => [e.id, e.email.toLowerCase()] as const));
          const liveByEmail = new Map(
            idleSummary.employees
              .map((e) => [idToEmail.get(e.employeeId), e] as const)
              .filter((pair): pair is [string, (typeof idleSummary.employees)[number]] => !!pair[0]),
          );

          for (const emp of list) {
            const live = liveByEmail.get((emp.email || '').toLowerCase());
            if (live?.status === 'ON_BREAK') onBreakCount += 1;
            else if (live && live.status !== 'NOT_CHECKED_IN' && live.status !== 'CHECKED_OUT') activeCount += 1;
          }
        } catch (e) {
          console.warn('EmployeeStatusOverviewCards productivity_service fetch error:', e);
        }

        setTotal(tot);
        setActive(activeCount);
        setOnBreak(onBreakCount);
        setInactive(Math.max(0, tot - activeCount - onBreakCount));
      } catch (err) {
        console.warn('EmployeeStatusOverviewCards fetch error:', err);
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const metrics: MetricCardProps[] = [
    {
      label: 'Total Employees',
      value: total,
      valueColorClass: 'text-[#534bf3]', // Vibrant Indigo
    },
    {
      label: 'Active Today',
      value: active,
      valueColorClass: 'text-[#10b981]', // Emerald Green
    },
    {
      label: 'On Break',
      value: onBreak,
      valueColorClass: 'text-[#f59e0b]', // Warm Amber/Yellow
    },
    {
      label: 'Inactive',
      value: inactive,
      valueColorClass: 'text-[#ef4444]', // Rose Red
    },
  ];

  return (
    <div className="w-full max-w-7xl font-sans">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-slate-900 p-7 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between min-h-[140px] transition-all hover:shadow-md"
          >
            {/* Metric Label */}
            <p className="text-sm font-medium text-slate-400">
              {card.label}
            </p>

            {/* Metric Value Number */}
            <h2 className={`text-4xl font-extrabold tracking-tight mt-3 ${card.valueColorClass}`}>
              {card.value}
            </h2>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EmployeeStatusOverviewCards;
