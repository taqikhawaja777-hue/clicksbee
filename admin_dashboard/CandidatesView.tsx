import React, { useEffect, useRef, useState } from 'react';
import { UserPlus, Trash2, Upload, Download, Loader2, AlertCircle, Briefcase } from 'lucide-react';
import { apiService, apiErrorMessage, Candidate } from './src/services/api.service';

const STATUSES: Candidate['status'][] = ['NEW', 'INTERVIEW', 'HIRED', 'REJECTED'];
const STATUS_STYLE: Record<Candidate['status'], string> = {
  NEW: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  INTERVIEW: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  HIRED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  REJECTED: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};

const field =
  'w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500';

/** Recruitment - visible to HR and Admin/Boss only (the server enforces it too). */
export const CandidatesView: React.FC = () => {
  const [list, setList] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', position: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const load = async () => {
    try {
      const res: any = await apiService.getCandidates();
      setList(res?.data ?? res ?? []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load candidates.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    setSaving(true);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())) as any;
      await apiService.createCandidate(body);
      setForm({ fullName: '', phone: '', email: '', position: '', notes: '' });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not add the candidate.'));
    } finally {
      setSaving(false);
    }
  };

  const update = async (c: Candidate, changes: Partial<Candidate>) => {
    setBusyId(c.id);
    try {
      const res: any = await apiService.updateCandidate(c.id, changes);
      const updated = res?.data ?? res;
      setList((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: Candidate) => {
    if (!window.confirm(`Delete ${c.fullName}?`)) return;
    setBusyId(c.id);
    try {
      await apiService.deleteCandidate(c.id);
      setList((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete.'));
    } finally {
      setBusyId(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = uploadFor;
    e.target.value = '';
    if (!file || !id) return;
    setBusyId(id);
    try {
      const updated: any = await apiService.uploadCandidateCv(id, file);
      setList((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not upload the CV.'));
    } finally {
      setBusyId(null);
      setUploadFor(null);
    }
  };

  const download = async (c: Candidate) => {
    setBusyId(c.id);
    try {
      const { blob, fileName } = await apiService.downloadCandidateCv(c.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not download the CV.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="w-full max-w-6xl space-y-6 font-sans">
      <div>
        <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
          <Briefcase className="w-3.5 h-3.5" />
          <span>Recruitment</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Candidates</h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">Visible to HR and Admin/Boss only.</p>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={add}
        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6 grid grid-cols-1 md:grid-cols-5 gap-3"
      >
        <input className={field} placeholder="Full name *" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <input className={field} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className={field} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className={field} placeholder="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl cursor-pointer"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          <span>Add</span>
        </button>
        <textarea
          className={`${field} md:col-span-5`}
          rows={2}
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </form>

      <input ref={fileInput} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={onFile} />

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No candidates yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                  <th className="py-3 px-5">Candidate</th>
                  <th className="py-3 px-5">Position</th>
                  <th className="py-3 px-5">Status</th>
                  <th className="py-3 px-5">Notes</th>
                  <th className="py-3 px-5">CV</th>
                  <th className="py-3 px-5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((c) => (
                  <tr key={c.id} className={busyId === c.id ? 'opacity-60' : ''}>
                    <td className="py-3 px-5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{c.fullName}</div>
                      <div className="text-[11px] text-slate-400">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="py-3 px-5 text-slate-600 dark:text-slate-300">{c.position || '—'}</td>
                    <td className="py-3 px-5">
                      <select
                        value={c.status}
                        onChange={(e) => update(c, { status: e.target.value as Candidate['status'] })}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border-0 cursor-pointer ${STATUS_STYLE[c.status]}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.charAt(0) + s.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-5 text-xs text-slate-500 max-w-[260px]">
                      <input
                        defaultValue={c.notes || ''}
                        onBlur={(e) => e.target.value !== (c.notes || '') && update(c, { notes: e.target.value })}
                        placeholder="Add a note…"
                        className="w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-500 focus:outline-none py-1"
                      />
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-2">
                        {c.cvFileName && (
                          <button onClick={() => download(c)} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer" title={c.cvFileName}>
                            <Download className="w-3.5 h-3.5" /> CV
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setUploadFor(c.id);
                            fileInput.current?.click();
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" /> {c.cvFileName ? 'Replace' : 'Upload'}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-5 text-right">
                      <button onClick={() => remove(c)} className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CandidatesView;
