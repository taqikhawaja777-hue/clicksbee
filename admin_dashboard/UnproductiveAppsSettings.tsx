import React, { useEffect, useState } from 'react';
import { Ban, RotateCcw, Save } from 'lucide-react';
import { apiService, apiErrorMessage } from './src/services/api.service';

const toText = (keywords: string[]) => keywords.join('\n');
const fromText = (text: string) =>
  text
    .split(/[\n,]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

/**
 * Manager Settings card: the words that mark a window as unproductive
 * (matched against the window title / app name, e.g. "youtube"). Time with
 * real input in such a window counts as Unproductive - not active - in the
 * Idle Time page and reports. Employee apps load the list at login.
 */
export const UnproductiveAppsSettings: React.FC = () => {
  const [text, setText] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiService
      .getActivityConfig()
      .then((res: any) => {
        const cfg = res?.data ?? res;
        setText(toText(cfg?.unproductiveKeywords || []));
        setIsDefault(!!cfg?.isDefault);
      })
      .catch((err) => setMessage({ ok: false, text: apiErrorMessage(err, 'Could not load the list.') }))
      .finally(() => setLoading(false));
  }, []);

  const save = async (keywords: string[] | null) => {
    setSaving(true);
    setMessage(null);
    try {
      const res: any = await apiService.setActivityConfig(keywords);
      const cfg = res?.data ?? res;
      setText(toText(cfg?.unproductiveKeywords || []));
      setIsDefault(!!cfg?.isDefault);
      setMessage({ ok: true, text: 'Saved. Employees get the new list the next time they log in.' });
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not save the list.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-8 space-y-5 shadow-sm">
      <div className="flex items-center space-x-3 pb-5 border-b border-slate-100 dark:border-slate-800">
        <div className="p-2.5 bg-orange-50 dark:bg-orange-950/50 rounded-2xl text-orange-600">
          <Ban className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-white">Unproductive Apps & Websites</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            One word per line, matched against the window title or app name (e.g. "youtube" matches any YouTube tab). Time
            spent in these counts as Unproductive, not active. Everything else counts as work.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 resize-y"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => save(fromText(text))}
              disabled={saving}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving…' : 'Save list'}</span>
            </button>
            <button
              onClick={() => save(null)}
              disabled={saving || isDefault}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 font-bold text-xs rounded-xl cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to default list</span>
            </button>
            {isDefault && <span className="text-[11px] text-slate-400">Using the default list</span>}
            {message && (
              <span className={`text-xs font-semibold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default UnproductiveAppsSettings;
