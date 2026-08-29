import React from 'react';
import { Bell, ShieldAlert, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export const ManagerNotificationsView: React.FC = () => {
  const notifications = [
    { title: 'Idle Timeout Limit Exceeded', desc: 'User Michael Brown exceeded 20m idle timeout.', time: '10 mins ago', type: 'warning' },
    { title: 'New Employee Registration', desc: 'Aamir Sohail signed up as Full Stack Engineer.', time: '1 hour ago', type: 'info' },
    { title: 'Daily Database Backup Complete', desc: 'MongoDB Atlas cloud database synchronized.', time: '3 hours ago', type: 'success' },
    { title: 'Late Check-in Alert', desc: 'Emma Wilson checked in at 09:32 AM (Late).', time: '5 hours ago', type: 'warning' },
    { title: 'Screen Capture Encrypted', desc: 'AES-256 screenshot security scan completed.', time: 'Yesterday', type: 'info' },
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">
            <Bell className="w-3.5 h-3.5" />
            <span>Alert & Security Center</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Manager Notifications</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">Real-time alerts for shift attendance, idle timeouts, and policy events.</p>
        </div>

        <span className="px-3.5 py-1.5 bg-indigo-600 text-white font-extrabold text-xs rounded-full shadow-sm">
          5 New Notifications
        </span>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {notifications.map((item, idx) => (
          <div key={idx} className="p-5 flex items-start space-x-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
            <div className={`p-3 rounded-2xl ${
              item.type === 'warning' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950' :
              item.type === 'success' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950' :
              'bg-indigo-50 text-indigo-600 dark:bg-indigo-950'
            }`}>
              {item.type === 'warning' ? <AlertTriangle className="w-5 h-5" /> :
               item.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> :
               <ShieldAlert className="w-5 h-5" />}
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-800 dark:text-white">{item.title}</h3>
                <span className="text-xs text-slate-400 font-medium">{item.time}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ManagerNotificationsView;
