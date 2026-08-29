import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

// Icon components placeholder (replace with your actual icon library)
type IconProps = { size?: number; className?: string } & React.HTMLAttributes<HTMLSpanElement>;
const makeIcon = (symbol: string) => ({ size, className, ...props }: IconProps) => (
  <span className={className} style={size ? { fontSize: size } : undefined} {...props}>{symbol}</span>
);

const Users = makeIcon('👥');
const UserCheck = makeIcon('✓');
const Wifi = makeIcon('📡');
const TrendingUp = makeIcon('📈');
const UserX = makeIcon('❌');
const Clock = makeIcon('🕐');
const Camera = makeIcon('📷');
const Video = makeIcon('🎥');
const LayoutDashboard = makeIcon('📊');
const Monitor = makeIcon('🖥️');
const Calendar = makeIcon('📅');
const BarChart2 = makeIcon('📊');
const ImageIcon = makeIcon('🖼️');
const Film = makeIcon('🎬');
const FileText = makeIcon('📄');
const Bell = makeIcon('🔔');
const Settings = makeIcon('⚙️');
const LogOut = makeIcon('🚪');
const Search = makeIcon('🔍');
const Sun = makeIcon('☀️');
const HelpCircle = makeIcon('❓');
const ChevronDown = makeIcon('▼');

// Mock Data for Charts
const weeklyData = [
  { name: 'Mon', Present: 45, Absent: 5, Late: 5 },
  { name: 'Tue', Present: 48, Absent: 4, Late: 3 },
  { name: 'Wed', Present: 44, Absent: 6, Late: 5 },
  { name: 'Thu', Present: 46, Absent: 4, Late: 5 },
  { name: 'Fri', Present: 41, Absent: 9, Late: 5 },
];

const pieData = [
  { name: 'Present', value: 46, color: '#6366f1' },
  { name: 'Absent', value: 4, color: '#ef4444' },
  { name: 'Late', value: 3, color: '#10b981' },
  { name: 'Leave', value: 2, color: '#f59e0b' },
];

export default function ManagerDashboard() {
  return (
    <div className="flex h-screen bg-[#0a0d1d] text-slate-200 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 bg-[#0d1025] border-r border-slate-800/60 flex flex-col justify-between p-4 flex-shrink-0">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 px-2 py-3 mb-4">
            <div className="bg-indigo-600 rounded-lg p-2 text-white">
              <LayoutDashboard size={20} />
            </div>
            <div>
              <h1 className="font-bold text-white leading-none">WorkTrackPro</h1>
              <span className="text-[10px] tracking-wider text-indigo-400 font-medium">MANAGER PORTAL</span>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="bg-[#151934] p-3 rounded-xl flex items-center gap-3 mb-6 border border-slate-800/80">
            <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-400 font-semibold flex items-center justify-center text-sm border border-indigo-500/30">
              AM
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-white truncate">Alex Morgan</p>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="text-xs text-slate-400">Online</span>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active />
            <NavItem icon={<Users size={18} />} label="Employees" />
            <NavItem icon={<Monitor size={18} />} label="Live Monitor" badge="LIVE" badgeColor="bg-red-500/20 text-red-400 border-red-500/30" />
            <NavItem icon={<Calendar size={18} />} label="Attendance" />
            <NavItem icon={<TrendingUp size={18} />} label="Productivity" />
            <NavItem icon={<ImageIcon size={18} />} label="Screenshots" />
            <NavItem icon={<Film size={18} />} label="Recordings" />
            <NavItem icon={<FileText size={18} />} label="Reports" />
            <NavItem icon={<Bell size={18} />} label="Notifications" badge="5" badgeColor="bg-indigo-600 text-white" />
            <NavItem icon={<Settings size={18} />} label="Settings" />
          </nav>
        </div>

        {/* Logout */}
        <button className="flex items-center gap-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-2.5 rounded-lg transition text-sm font-medium">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800/60 bg-[#0d1025]/50 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Dashboard</h2>
            <p className="text-xs text-slate-400">Tuesday, August 11, 2026</p>
          </div>

          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative w-64">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Search size={16} />
              </div>
              <input 
                type="text" 
                placeholder="Search..." 
                className="w-full bg-[#151934] text-sm text-slate-200 placeholder-slate-500 pl-9 pr-4 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Header Actions */}
            <button className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/50">
              <Sun size={18} />
            </button>
            <div className="relative">
              <button className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/50">
                <Bell size={18} />
              </button>
              <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">3</span>
            </div>

            {/* Profile Dropdown */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                AM
              </div>
              <div className="text-left hidden md:block">
                <p className="text-xs font-semibold text-white leading-none">Alex Morgan</p>
                <p className="text-[10px] text-slate-400">Manager</p>
              </div>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
          </div>
        </header>

        {/* Dashboard Body */}
        <main className="p-6 space-y-6">
          
          {/* Top Metric Cards Grid (4 columns x 2 rows) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard 
              icon={<Users size={18} className="text-indigo-400" />}
              iconBg="bg-indigo-500/10"
              value="55"
              label="Total Employees"
              subtext="3 new this month"
              subtextColor="text-indigo-400"
              badge="↑ 5%"
              badgeColor="text-emerald-400"
            />
            <StatCard 
              icon={<UserCheck size={18} className="text-emerald-400" />}
              iconBg="bg-emerald-500/10"
              value="46"
              label="Present Today"
              subtext="83.6% attendance"
              subtextColor="text-emerald-400"
              badge="↑ 2%"
              badgeColor="text-emerald-400"
            />
            <StatCard 
              icon={<Wifi size={18} className="text-cyan-400" />}
              iconBg="bg-cyan-500/10"
              value="38"
              label="Online Now"
              subtext="Live sessions"
              subtextColor="text-cyan-400"
              badge="↓ 1%"
              badgeColor="text-rose-400"
            />
            <StatCard 
              icon={<TrendingUp size={18} className="text-amber-400" />}
              iconBg="bg-amber-500/10"
              value="91%"
              label="Avg Productivity"
              subtext="Team average"
              subtextColor="text-amber-400"
              badge="↑ 8%"
              badgeColor="text-emerald-400"
            />
            <StatCard 
              icon={<UserX size={18} className="text-rose-400" />}
              iconBg="bg-rose-500/10"
              value="4"
              label="Absent Today"
              subtext="Down from 6 yesterday"
              subtextColor="text-rose-400"
              badge="↓ 33%"
              badgeColor="text-rose-400"
            />
            <StatCard 
              icon={<Clock size={18} className="text-purple-400" />}
              iconBg="bg-purple-500/10"
              value="7.2h"
              label="Avg Hours Today"
              subtext="Target: 8h"
              subtextColor="text-purple-400"
            />
            <StatCard 
              icon={<span className="text-blue-400"><Camera size={18} /></span>}
              iconBg="bg-blue-500/10"
              value="1,240"
              label="Screenshots Today"
              subtext="Across 46 employees"
              subtextColor="text-cyan-400"
            />
            <StatCard 
              icon={<Video size={18} />}
              iconBg="bg-rose-500/10"
              value="12"
              label="Active Recordings"
              subtext="Currently recording"
              subtextColor="text-rose-400"
              badge="↑ 0%"
              badgeColor="text-emerald-400"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Bar Chart Section */}
            <div className="lg:col-span-2 bg-[#10142d] p-5 rounded-2xl border border-slate-800/80">
              <h3 className="text-base font-semibold text-white mb-6">Weekly Attendance Analytics</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} domain={[0, 60]} ticks={[0, 15, 30, 45, 60]} />
                    <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} contentStyle={{ backgroundColor: '#1e2342', borderColor: '#334155', color: '#fff' }} />
                    <Bar dataKey="Present" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center items-center gap-6 mt-4 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-500 rounded-sm"></span> Present</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-rose-500 rounded-sm"></span> Absent</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-amber-500 rounded-sm"></span> Late</span>
              </div>
            </div>

            {/* Donut Chart Section */}
            <div className="bg-[#10142d] p-5 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
              <h3 className="text-base font-semibold text-white mb-2">Today's Attendance</h3>
              <div className="h-52 w-full relative flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend List */}
              <div className="space-y-2 mt-2">
                {pieData.map((item) => (
                  <div key={item.name} className="flex justify-between items-center text-xs">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }}></span>
                      <span className="text-slate-300">{item.name}</span>
                    </span>
                    <span className="font-bold text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </main>
      </div>

      {/* Fixed Floating Help Button */}
      <button className="fixed bottom-4 right-4 bg-white text-slate-900 p-2.5 rounded-full shadow-lg hover:bg-slate-200 transition">
        <HelpCircle size={20} />
      </button>
    </div>
  );
}

// Reusable Navigation Link
function NavItem({ icon, label, active = false, badge, badgeColor }: any) {
  return (
    <a href="#" className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition font-medium ${
      active 
        ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
    }`}>
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge && (
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${badgeColor}`}>
          {badge}
        </span>
      )}
    </a>
  );
}

// Reusable Stat Card Component
function StatCard({ icon, iconBg, value, label, subtext, subtextColor, badge, badgeColor }: any) {
  return (
    <div className="bg-[#10142d] p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between h-36">
      <div className="flex justify-between items-start">
        <div className={`p-2.5 rounded-xl ${iconBg}`}>
          {icon}
        </div>
        {badge && (
          <span className={`text-xs font-semibold ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <h4 className="text-2xl font-bold text-white tracking-tight">{value}</h4>
        <p className="text-xs text-slate-400 mt-0.5">{label}</p>
        <p className={`text-[11px] mt-1 font-medium ${subtextColor}`}>{subtext}</p>
      </div>
    </div>
  );
}