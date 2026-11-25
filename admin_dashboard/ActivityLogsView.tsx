import React, { useEffect, useMemo, useState } from 'react';
import { History, Loader2, AlertCircle, AppWindow, Moon, Activity } from 'lucide-react';
import { apiService, apiErrorMessage, ActivityLogDay } from './src/services/api.service';

const todayKarachi = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

const fmtDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${Math.round(seconds)}s`;
};
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

const PAGE = 200;

/**
 * Full-day app/window log of one person (names and times only). Who can be
 * picked is decided by the server: Admin - everyone; SM - Team Leads and
 * Closers; Team Lead - their own agents.
 */
export const ActivityLogsView: React.FC = () => {
  const [people, setPeople] = useState<{ id: string; name: string; categoryLabel: string }[]>([]);
  const [personId, setPersonId] = useState('');
  const [date, setDate] = useState(todayKarachi());
  const [day, setDay] = useState<ActivityLogDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    apiService
      .getActivityLogPeople()
      .then((res: any) => {
        const list = res?.data ?? res ?? [];
        setPeople(list);
        if (list.length && !personId) setPersonId(list[0].id);
      })
      .catch((err) => setError(apiErrorMessage(err, 'Could not load people.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    setShown(PAGE);
    apiService
      .getActivityLog(personId, date)
      .then((res: any) => setDay(res?.data ?? res))
      .catch((err) => {
        setDay(null);
        setError(apiErrorMessage(err, 'Could not load the activity log.'));
      })
      .finally(() => setLoading(false));
  }, [personId, date]);

  const maxApp = useMemo(() => Math.max(1, ...(day?.summary.apps || []).map((a) => a.activeSeconds)), [day]);

  return (
    <div className="w-full max-w-6xl space-y-6 font-sans">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
            <History className="w-3.5 h-3.5" />
            <span>Full-day activity</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Activity Logs</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Which apps and windows were used, when and for how long. App and window names only - no keystrokes or message content.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
          >
            {people.length === 0 && <option value="">No one to show</option>}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.categoryLabel}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            max={todayKarachi()}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : day ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Active', value: fmtDuration(day.summary.activeSeconds), icon: Activity, color: 'text-emerald-600' },
              { label: 'Idle / locked', value: fmtDuration(day.summary.idleSeconds), icon: Moon, color: 'text-amber-600' },
              { label: 'First activity', value: fmtTime(day.summary.firstActivityAt), icon: History, color: 'text-indigo-600' },
              { label: 'Last activity', value: fmtTime(day.summary.lastActivityAt), icon: History, color: 'text-indigo-600' },
            ].map((c) => (
              <div key={c.label} className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                  <span>{c.label}</span>
                  <c.icon className={`w-4 h-4 ${c.color}`} />
                </div>
                <div className="text-2xl font-black text-slate-800 dark:text-white mt-2">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6">
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-white mb-4">Time per application</h3>
            {day.summary.apps.length === 0 ? (
              <p className="text-xs text-slate-400">No activity recorded for this day.</p>
            ) : (
              <div className="space-y-3">
                {day.summary.apps.map((a) => (
                  <div key={a.app}>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      <span className="flex items-center gap-1.5">
                        <AppWindow className="w-3.5 h-3.5 text-slate-400" /> {a.app}
                      </span>
                      <span>
                        {fmtDuration(a.activeSeconds)}
                        {a.idleSeconds > 0 && <span className="text-amber-600"> · idle {fmtDuration(a.idleSeconds)}</span>}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(a.activeSeconds / maxApp) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">Timeline</h3>
              <span className="text-xs text-slate-400">{day.entries.length} entries</span>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#eeeff5] dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">
                  <tr>
                    <th className="py-2.5 px-4">Time</th>
                    <th className="py-2.5 px-4">Application</th>
                    <th className="py-2.5 px-4">Window / file</th>
                    <th className="py-2.5 px-4 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {day.entries.slice(0, shown).map((e, i) => (
                    <tr key={i} className={e.category === 'Idle' ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                      <td className="py-2 px-4 whitespace-nowrap text-slate-500">
                        {fmtTime(e.startedAt)} – {fmtTime(e.endedAt)}
                      </td>
                      <td className={`py-2 px-4 font-semibold ${e.category === 'Idle' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>
                        {e.applicationName}
                      </td>
                      <td className="py-2 px-4 text-slate-500 max-w-[420px] truncate" title={e.windowTitle || ''}>
                        {e.windowTitle || '—'}
                      </td>
                      <td className="py-2 px-4 text-right whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDuration(e.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {day.entries.length > shown && (
              <button
                onClick={() => setShown((n) => n + PAGE)}
                className="w-full py-3 text-xs font-bold text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Show more
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default ActivityLogsView;
