import React, { useState, useEffect } from 'react';

interface MetricCardProps {
  label: string;
  value: number | string;
  valueColorClass: string;
}

export const EmployeeStatusOverviewCards: React.FC = () => {
  const [total, setTotal] = useState<number>(0);
  const [active, setActive] = useState<number>(0);
  const [onBreak, setOnBreak] = useState<number>(0);
  const [inactive, setInactive] = useState<number>(0);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/employees')
      .then((res) => res.json())
      .then((json) => {
        let list: any[] = [];
        if (Array.isArray(json)) list = json;
        else if (json?.data?.data && Array.isArray(json.data.data)) list = json.data.data;
        else if (json?.data && Array.isArray(json.data)) list = json.data;

        const tot = typeof json?.totalCount === 'number' ? json.totalCount : (typeof json?.data?.totalCount === 'number' ? json.data.totalCount : list.length);
        const act = list.filter((e: any) => e.status === 'ACTIVE' || e.status === 'Online').length;
        const brk = list.filter((e: any) => e.status === 'On Break' || e.status === 'Break').length;
        const inact = Math.max(0, tot - act - brk);

        setTotal(tot);
        setActive(act);
        setOnBreak(brk);
        setInactive(inact);
      })
      .catch((err) => console.warn('EmployeeStatusOverviewCards fetch error:', err));
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
