import React, { useEffect, useMemo, useState } from 'react';
import { UserCog, Search, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiService, apiErrorMessage, Category, CATEGORY_LABELS, UserAccessRow } from './src/services/api.service';
import { useEmployee } from './EmployeeContext';

const CATEGORY_ORDER: Category[] = ['ADMIN', 'HR', 'SM', 'TEAM_LEAD', 'CLOSER', 'BACK_OFFICE', 'VALIDATOR', 'EMPLOYEE'];

/**
 * Admin/Boss only: everyone's access category (what they can see), each
 * agent's Team Lead, and granting Admin/Boss - the only way to get full
 * access (signup can never create it).
 */
export const UsersAdminView: React.FC = () => {
  const { user } = useEmployee();
  const [rows, setRows] = useState<UserAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setError(null);
    try {
      const res: any = await apiService.getUsersAccess();
      setRows(res?.data ?? res ?? []);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load users.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const teamLeads = useMemo(() => rows.filter((r) => r.category === 'TEAM_LEAD'), [rows]);
  const visible = rows.filter((r) => `${r.name} ${r.email} ${r.categoryLabel}`.toLowerCase().includes(search.trim().toLowerCase()));

  const save = async (row: UserAccessRow, changes: { category?: Category; teamLeadId?: string | null }) => {
    if (changes.category === 'ADMIN' && !window.confirm(`Give ${row.name} full Admin / Boss access (incl. screenshots)?`)) return;
    setSavingId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res: any = await apiService.updateUserAccess(row.id, changes);
      const updated: UserAccessRow = res?.data ?? res;
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      setNotice(`${row.name} updated - applies the next time they open a page.`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save.'));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="w-full max-w-6xl space-y-6 font-sans">
      <div>
        <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
          <UserCog className="w-3.5 h-3.5" />
          <span>Roles & Access</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Users</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">
          Each person's category decides what they can see. Closers need a Team Lead to appear on that Team Lead's team.
        </p>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or category…"
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <span className="text-xs text-slate-400">{rows.length} users</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Loading users…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                  <th className="py-3 px-5">Person</th>
                  <th className="py-3 px-5">Category</th>
                  <th className="py-3 px-5">Team Lead</th>
                  <th className="py-3 px-5">Last login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((row) => {
                  const isSelf = row.id === user.id;
                  const busy = savingId === row.id;
                  return (
                    <tr key={row.id} className={row.isActive ? '' : 'opacity-50'}>
                      <td className="py-3 px-5">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{row.name}</div>
                        <div className="text-[11px] text-slate-400">{row.email}</div>
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2">
                          <select
                            value={row.category}
                            disabled={busy || isSelf}
                            onChange={(e) => save(row, { category: e.target.value as Category })}
                            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                          >
                            {CATEGORY_ORDER.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_LABELS[c]}
                              </option>
                            ))}
                          </select>
                          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
                          {row.categoryIsDerived && (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400"
                              title="Worked out from this older account's role/designation - choose the category to confirm it"
                            >
                              please confirm
                            </span>
                          )}
                          {isSelf && <span className="text-[10px] text-slate-400">you</span>}
                        </div>
                      </td>
                      <td className="py-3 px-5">
                        {row.category === 'ADMIN' || row.category === 'HR' || row.category === 'TEAM_LEAD' ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <select
                            value={row.teamLeadId || ''}
                            disabled={busy}
                            onChange={(e) => save(row, { teamLeadId: e.target.value || null })}
                            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                          >
                            <option value="">No Team Lead</option>
                            {teamLeads.map((tl) => (
                              <option key={tl.id} value={tl.id}>
                                {tl.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-3 px-5 text-xs text-slate-400">
                        {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default UsersAdminView;
