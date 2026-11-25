import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, Save } from 'lucide-react';
import { apiService, apiErrorMessage } from './src/services/api.service';

/**
 * Manager Settings card: how long an employee may use Excel / Google Sheets
 * per shift. The time is part of active time (never added on top); Admin is
 * notified once per shift when someone passes the limit.
 */
export const SpreadsheetLimitSettings: React.FC = () => {
  const [minutes, setMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiService
      .getActivityConfig()
      .then((res: any) => {
        const cfg = res?.data ?? res;
        if (cfg?.spreadsheetLimitMinutes) setMinutes(cfg.spreadsheetLimitMinutes);
      })
      .catch((err) => setMessage({ ok: false, text: apiErrorMessage(err, 'Could not load the limit.') }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res: any = await apiService.setSpreadsheetLimitMinutes(minutes);
      const cfg = res?.data ?? res;
      if (cfg?.spreadsheetLimitMinutes) setMinutes(cfg.spreadsheetLimitMinutes);
      setMessage({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not save the limit.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-8 space-y-5 shadow-sm">
      <div className="flex items-center space-x-3 pb-5 border-b border-slate-100 dark:border-slate-800">
        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-white">Spreadsheet Time Limit</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Time with Excel / Google Sheets in front and the mouse or keyboard in use. It counts as active time; Admin is
            notified once per shift when an employee goes over this limit.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Limit per shift (minutes)</label>
          <input
            type="number"
            min={10}
            max={540}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="w-24 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={save}
            disabled={saving || !(minutes >= 10 && minutes <= 540)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving…' : 'Save limit'}</span>
          </button>
          {message && (
            <span className={`text-xs font-semibold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetLimitSettings;
