import React from 'react';
import { Inbox } from 'lucide-react';
import { useEmployee, SessionRecordItem } from './EmployeeContext';

export const SessionHistoryTable: React.FC = () => {
  const { sessionHistory } = useEmployee();

  // Status Pill Renderer
  const renderStatusPill = (status: SessionRecordItem['status']) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-[#e8f8f2] dark:bg-emerald-950/50 text-[#10b981] dark:text-emerald-400 border border-[#d2f3e6] dark:border-emerald-900/50">
            Completed
          </span>
        );
      case 'Absent':
        return (
          <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-[#fce8ec] dark:bg-rose-950/50 text-[#ef4444] dark:text-rose-400 border border-[#f8d7da] dark:border-rose-900/50">
            Absent
          </span>
        );
      case 'Half Day':
        return (
          <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-[#e0f2fe] dark:bg-sky-950/50 text-[#0284c7] dark:text-sky-400 border border-[#bae6fd] dark:border-sky-900/50">
            Half Day
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans overflow-hidden transition-colors">
      
      {/* Table Title Header */}
      <div className="p-6">
        <h3 className="text-xl font-bold text-slate-800 dark:text-white">
          Session History
        </h3>
      </div>

      {/* Table Content or Empty State */}
      {sessionHistory.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center">
          <Inbox className="w-10 h-10 mb-2 opacity-40 text-slate-400" />
          <p className="font-semibold text-slate-700 dark:text-slate-300">No session history found for this period</p>
          <p className="text-xs mt-1 text-slate-400">Complete your first shift to log work session history.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            
            {/* Light Header Strip */}
            <thead>
              <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="py-4 px-6">DATE</th>
                <th className="py-4 px-6">START</th>
                <th className="py-4 px-6">END</th>
                <th className="py-4 px-6">DURATION</th>
                <th className="py-4 px-6">BREAKS</th>
                <th className="py-4 px-6 text-right sm:text-left">STATUS</th>
              </tr>
            </thead>

            {/* Table Body Rows */}
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
              {sessionHistory.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-6 text-slate-800 dark:text-slate-200 font-semibold">{row.date}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{row.start}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{row.end}</td>
                  <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">{row.duration}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{row.breaks}</td>
                  <td className="py-4 px-6 text-right sm:text-left">
                    {renderStatusPill(row.status)}
                  </td>
                </tr>
              ))}
            </tbody>

          </table>
        </div>
      )}

    </div>
  );
};

export default SessionHistoryTable;
