import React, { useState } from 'react';
import { 
  Search, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  XCircle, 
  Clock, 
  Calendar,
  Inbox
} from 'lucide-react';
import { useEmployee, AttendanceRecordItem } from './EmployeeContext';

export const AttendanceHistoryTable: React.FC = () => {
  const { attendanceHistory } = useEmployee();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');

  // Status Badge Component Generator
  const renderStatusBadge = (status: AttendanceRecordItem['status']) => {
    switch (status) {
      case 'Present':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#e8f8f2] dark:bg-emerald-950/50 text-[#10b981] dark:text-emerald-400 border border-[#d2f3e6] dark:border-emerald-900/50">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 stroke-[2.5]" />
            Present
          </span>
        );
      case 'Late':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#fef3c7] dark:bg-amber-950/50 text-[#d97706] dark:text-amber-400 border border-[#fde68a] dark:border-amber-900/50">
            <AlertCircle className="w-3.5 h-3.5 mr-1 stroke-[2.5]" />
            Late
          </span>
        );
      case 'Absent':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#fce8ec] dark:bg-rose-950/50 text-[#ef4444] dark:text-rose-400 border border-[#f8d7da] dark:border-rose-900/50">
            <XCircle className="w-3.5 h-3.5 mr-1 stroke-[2.5]" />
            Absent
          </span>
        );
      case 'Half Day':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#e0f2fe] dark:bg-sky-950/50 text-[#0284c7] dark:text-sky-400 border border-[#bae6fd] dark:border-sky-900/50">
            <Clock className="w-3.5 h-3.5 mr-1 stroke-[2.5]" />
            Half Day
          </span>
        );
      case 'Holiday':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#f3e8ff] dark:bg-purple-950/50 text-[#9333ea] dark:text-purple-400 border border-[#e9d5ff] dark:border-purple-900/50">
            <Calendar className="w-3.5 h-3.5 mr-1 stroke-[2.5]" />
            Holiday
          </span>
        );
      case 'Leave':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#e0e7ff] dark:bg-indigo-950/50 text-[#4f46e5] dark:text-indigo-400 border border-[#c7d2fe] dark:border-indigo-900/50">
            <Calendar className="w-3.5 h-3.5 mr-1 stroke-[2.5]" />
            Leave
          </span>
        );
      default:
        return null;
    }
  };

  // Filter Data Logic
  const filteredData = attendanceHistory.filter((row) => {
    const matchesSearch = row.date.includes(searchTerm) || row.totalHours.includes(searchTerm);
    const matchesStatus = statusFilter === 'All Status' || row.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans overflow-hidden transition-colors">
      
      {/* ================= TABLE TOOLBAR HEADER ================= */}
      <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="text-xl font-bold text-slate-800 dark:text-white">
          Attendance History
        </h3>

        {/* Controls: Search, Dropdown & Export Button */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-full text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-300 transition-all w-48"
            />
          </div>

          {/* Status Select Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-full text-sm text-slate-700 dark:text-slate-200 font-medium focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-300 transition-all cursor-pointer"
          >
            <option>All Status</option>
            <option>Present</option>
            <option>Late</option>
            <option>Absent</option>
            <option>Half Day</option>
            <option>Holiday</option>
            <option>Leave</option>
          </select>

          {/* Export Button */}
          <button className="px-5 py-2 bg-[#534bf3] hover:bg-indigo-700 text-white font-semibold text-sm rounded-full flex items-center space-x-2 shadow-sm transition-all active:scale-95">
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* ================= DATA TABLE OR EMPTY STATE ================= */}
      {filteredData.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center">
          <Inbox className="w-10 h-10 mb-2 opacity-40 text-slate-400" />
          <p className="font-semibold text-slate-700 dark:text-slate-300">No attendance records found for this period</p>
          <p className="text-xs mt-1 text-slate-400">Click "Check In" to start your first shift and record attendance.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="py-3.5 px-6">DATE</th>
                <th className="py-3.5 px-6">CHECK IN</th>
                <th className="py-3.5 px-6">CHECK OUT</th>
                <th className="py-3.5 px-6">BREAK</th>
                <th className="py-3.5 px-6">TOTAL HOURS</th>
                <th className="py-3.5 px-6 text-right sm:text-left">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
              {filteredData.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-6 text-slate-800 dark:text-slate-200 font-semibold">{row.date}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{row.checkIn}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{row.checkOut}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{row.break}</td>
                  <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">{row.totalHours}</td>
                  <td className="py-4 px-6 text-right sm:text-left">
                    {renderStatusBadge(row.status)}
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

export default AttendanceHistoryTable;
