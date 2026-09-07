import React, { useState } from 'react';
import { Search, Plus, Edit2, Trash2, MoreVertical, ChevronDown } from 'lucide-react';
import { productivityApiService, EmployeeIdleStatus, DailyReportRow } from './src/services/productivityApi.service';

const DIRECTORY_POLL_INTERVAL_MS = 30000;

function mapIdleStatusToDirectoryStatus(status: EmployeeIdleStatus['status']): 'Online' | 'Break' | 'Offline' {
  if (status === 'ON_BREAK') return 'Break';
  if (status === 'NOT_CHECKED_IN' || status === 'CHECKED_OUT') return 'Offline';
  return 'Online'; // ACTIVE / ACTIVE_JABBER / ACTIVE_WILDIX / IDLE / AWAY - still on shift.
}

function todayDateKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DEPARTMENT_OPTIONS = ['Engineering', 'Design', 'Marketing', 'Sales', 'HR'];

export interface EmployeeDirectoryItem {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  checkIn: string;
  status: 'Online' | 'Break' | 'Offline';
  productivity: number;
  avatar: string;
  isActive: boolean;
}

const initialEmployees: EmployeeDirectoryItem[] = [];

export const EmployeeDirectoryTable: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeDirectoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('All Departments');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  const fetchEmployeesFromApi = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/v1/employees');
      if (res.ok) {
        const json = await res.json();
        let list: any[] = [];
        if (Array.isArray(json)) list = json;
        else if (json?.data?.data && Array.isArray(json.data.data)) list = json.data.data;
        else if (json?.data && Array.isArray(json.data)) list = json.data;

        if (list.length > 0) {
          // Cross-reference the productivity_service's real, today-scoped
          // per-employee data, joined through employeeId -> email (its own
          // API responses only carry employeeName, and this MongoDB list
          // already has two different real people both named "usman
          // khawaja" - matching by name alone would silently merge their
          // data). The NestJS side always returned a hardcoded
          // `productivity: 95` for every employee regardless of actual
          // activity, which is why every row in this table showed the
          // identical 95% - and its own `status`/`checkIn` fields are a
          // separate, not-necessarily-current concept from here on, so
          // once a productivity_service record exists for someone, it's
          // used as the ONLY source of Status/Check-In/Productivity for
          // that row rather than blending two different definitions.
          // Falls back to Offline/--/0% (not other fake numbers) for
          // anyone who hasn't opened the desktop app today at all.
          const today = todayDateKey();
          let liveByEmail = new Map<string, EmployeeIdleStatus>();
          let attendanceByEmail = new Map<string, DailyReportRow>();
          try {
            const [employeesList, idleSummary, attendance] = await Promise.all([
              productivityApiService.listEmployees(),
              productivityApiService.getIdleTimeSummary(),
              productivityApiService.getAttendanceReport(today, today),
            ]);
            const idToEmail = new Map(employeesList.map((e) => [e.id, e.email.toLowerCase()] as const));
            liveByEmail = new Map(
              idleSummary.employees
                .map((e) => [idToEmail.get(e.employeeId), e] as const)
                .filter((pair): pair is [string, EmployeeIdleStatus] => !!pair[0]),
            );
            attendanceByEmail = new Map(
              attendance.rows
                .map((r) => [idToEmail.get(r.employeeId), r] as const)
                .filter((pair): pair is [string, DailyReportRow] => !!pair[0]),
            );
          } catch (e) {
            console.warn('EmployeeDirectoryTable productivity_service fetch error:', e);
          }

          const mapped: EmployeeDirectoryItem[] = list.map((emp: any, idx: number) => {
            const email = (emp.email || 'user@company.corp').toLowerCase();
            const live = liveByEmail.get(email);
            const attendanceRow = attendanceByEmail.get(email);
            return {
              id: emp.id || `emp-${idx}`,
              name: emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Registered User',
              email: emp.email || 'user@company.corp',
              department: typeof emp.department === 'string' ? emp.department : (emp.department?.name || 'Engineering'),
              role: emp.role || 'Full Stack Engineer',
              checkIn: attendanceRow?.checkInAt
                ? new Date(attendanceRow.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '--',
              status: live ? mapIdleStatusToDirectoryStatus(live.status) : 'Offline',
              productivity: live ? Math.round(live.productivityPercentage) : 0,
              avatar: emp.avatar || (emp.name ? emp.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'RU'),
              isActive: emp.isActive !== false,
            };
          });
          setEmployees(mapped);
          return;
        }
      }
      setEmployees([]);
    } catch (e) {
      console.warn('EmployeeDirectoryTable fetch error:', e);
      setEmployees([]);
    }
  };

  React.useEffect(() => {
    fetchEmployeesFromApi();
    const interval = setInterval(fetchEmployeesFromApi, DIRECTORY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // New Employee Form State
  const [newEmployeeName, setNewEmployeeName] = useState<string>('');
  const [newEmployeeEmail, setNewEmployeeEmail] = useState<string>('');
  const [newEmployeeDept, setNewEmployeeDept] = useState<string>('Engineering');
  const [newEmployeeRole, setNewEmployeeRole] = useState<string>('Software Engineer');

  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept =
      selectedDept === 'All Departments' || emp.department === selectedDept;
    return matchesSearch && matchesDept;
  });

  const handleAddEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployeeName.trim()) return;

    const parts = newEmployeeName.trim().split(' ');
    const avatar = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : newEmployeeName.slice(0, 2).toUpperCase();

    const newEmp: EmployeeDirectoryItem = {
      id: `emp-${Date.now()}`,
      name: newEmployeeName.trim(),
      email: newEmployeeEmail.trim() || `${newEmployeeName.toLowerCase().replace(/\s+/g, '')}@company.com`,
      department: newEmployeeDept,
      role: newEmployeeRole,
      checkIn: '09:00',
      status: 'Online',
      productivity: 95,
      avatar,
      isActive: true,
    };

    setEmployees([newEmp, ...employees]);
    setShowAddModal(false);
    setNewEmployeeName('');
    setNewEmployeeEmail('');
  };

  const handleDeleteEmployee = (id: string) => {
    setEmployees(employees.filter(emp => emp.id !== id));
  };

  // Edit Employee (Department + Resignation) - the only two fields this
  // modal exposes, matching exactly what was asked for. Calls the real
  // PATCH /employees/:id endpoint (already supported department/isActive
  // updates server-side; only the department-by-name resolution needed
  // adding) rather than only updating local state like Add/Delete still do.
  const [editingEmployee, setEditingEmployee] = useState<EmployeeDirectoryItem | null>(null);
  const [editDept, setEditDept] = useState<string>(DEPARTMENT_OPTIONS[0]);
  const [editIsActive, setEditIsActive] = useState<boolean>(true);
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  const openEditModal = (emp: EmployeeDirectoryItem) => {
    setEditingEmployee(emp);
    setEditDept(DEPARTMENT_OPTIONS.includes(emp.department) ? emp.department : DEPARTMENT_OPTIONS[0]);
    setEditIsActive(emp.isActive);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`http://localhost:3000/api/v1/employees/${editingEmployee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentName: editDept, isActive: editIsActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingEmployee(null);
      await fetchEmployeesFromApi();
    } catch (err) {
      console.warn('EmployeeDirectoryTable update error:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden font-sans select-none">
      
      {/* Table Header Controls */}
      <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Employee Directory
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-56 pl-9 pr-4 py-2.5 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-2xl text-xs text-slate-700 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-300 transition-all"
            />
          </div>

          {/* Department Filter Dropdown */}
          <div className="relative">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="appearance-none px-4 py-2.5 pr-8 bg-slate-100/80 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-2xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="All Departments">All Departments</option>
              <option value="Engineering">Engineering</option>
              <option value="Design">Design</option>
              <option value="Marketing">Marketing</option>
              <option value="Sales">Sales</option>
              <option value="HR">HR</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Add Employee Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-[#534bf3] hover:bg-[#4338ca] text-white font-bold text-xs rounded-2xl flex items-center space-x-1.5 shadow-md shadow-indigo-500/20 transition-all active:scale-98 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Directory Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100/70 dark:bg-slate-800/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-y border-slate-100 dark:border-slate-800">
              <th className="py-4 px-6">EMPLOYEE</th>
              <th className="py-4 px-6">DEPARTMENT</th>
              <th className="py-4 px-6">ROLE</th>
              <th className="py-4 px-6">CHECK-IN</th>
              <th className="py-4 px-6">STATUS</th>
              <th className="py-4 px-6">PRODUCTIVITY</th>
              <th className="py-4 px-6 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {filteredEmployees.map((emp) => (
              <tr key={emp.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                
                {/* Employee Name & Avatar */}
                <td className="py-4 px-6">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-10 h-10 rounded-full bg-[#7c73f6] text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                      {emp.avatar}
                    </div>
                    <div>
                      <p className="font-extrabold text-slate-800 dark:text-white text-xs">{emp.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{emp.email}</p>
                    </div>
                  </div>
                </td>

                {/* Department */}
                <td className="py-4 px-6 text-xs text-slate-700 dark:text-slate-300 font-medium">
                  {emp.department}
                </td>

                {/* Role */}
                <td className="py-4 px-6 text-xs text-slate-400 font-medium">
                  {emp.role}
                </td>

                {/* Check In */}
                <td className="py-4 px-6 text-xs font-bold text-slate-700 dark:text-slate-300">
                  {emp.checkIn}
                </td>

                {/* Status Pill Badge - resignation is a separate axis from
                    moment-to-moment activity, so it takes over this badge
                    entirely rather than being just another color of
                    Online/Break/Offline. */}
                <td className="py-4 px-6">
                  {!emp.isActive ? (
                    <span className="inline-flex items-center space-x-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 px-3 py-1 rounded-full text-[11px] font-bold text-rose-600 dark:text-rose-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      <span>Resigned</span>
                    </span>
                  ) : (
                    <>
                      {emp.status === 'Online' && (
                        <span className="inline-flex items-center space-x-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 px-3 py-1 rounded-full text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Online</span>
                        </span>
                      )}
                      {emp.status === 'Break' && (
                        <span className="inline-flex items-center space-x-1.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 px-3 py-1 rounded-full text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span>Break</span>
                        </span>
                      )}
                      {emp.status === 'Offline' && (
                        <span className="inline-flex items-center space-x-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1 rounded-full text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          <span>Offline</span>
                        </span>
                      )}
                    </>
                  )}
                </td>

                {/* Productivity Bar & % */}
                <td className="py-4 px-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-28 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          emp.productivity >= 90 ? 'bg-emerald-500' : emp.productivity >= 75 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${emp.productivity}%` }}
                      />
                    </div>
                    <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                      {emp.productivity}%
                    </span>
                  </div>
                </td>

                {/* Actions (Pencil, Trash, More) */}
                <td className="py-4 px-6 text-right">
                  <div className="flex items-center justify-end space-x-1.5">
                    <button
                      onClick={() => openEditModal(emp)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-indigo-500 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => handleDeleteEmployee(emp.id)}
                      className="p-2 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-full text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Add New Employee</h3>
            
            <form onSubmit={handleAddEmployeeSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newEmployeeName}
                  onChange={(e) => setNewEmployeeName(e.target.value)}
                  placeholder="e.g. Sarah Johnson"
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newEmployeeEmail}
                  onChange={(e) => setNewEmployeeEmail(e.target.value)}
                  placeholder="sarah@company.com"
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Department</label>
                  <select
                    value={newEmployeeDept}
                    onChange={(e) => setNewEmployeeDept(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none"
                  >
                    <option value="Engineering">Engineering</option>
                    <option value="Design">Design</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Sales">Sales</option>
                    <option value="HR">HR</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Role Title</label>
                  <input
                    type="text"
                    required
                    value={newEmployeeRole}
                    onChange={(e) => setNewEmployeeRole(e.target.value)}
                    placeholder="Senior Dev"
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#534bf3] text-white font-bold text-xs rounded-xl shadow-md"
                >
                  Save Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal - Department + Resignation, the two fields
          this action actually exposes. Saves via the real PATCH endpoint,
          unlike Add/Delete above which still only touch local state. */}
      {editingEmployee && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Edit {editingEmployee.name}</h3>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Department</label>
                <select
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none"
                >
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Employment Status</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setEditIsActive(true)}
                    className={`py-2 rounded-lg transition-all ${editIsActive ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditIsActive(false)}
                    className={`py-2 rounded-lg transition-all ${!editIsActive ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500'}`}
                  >
                    Resigned
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 bg-[#534bf3] text-white font-bold text-xs rounded-xl shadow-md disabled:opacity-50"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default EmployeeDirectoryTable;
