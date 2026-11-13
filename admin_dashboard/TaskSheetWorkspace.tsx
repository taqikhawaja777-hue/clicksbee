import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Lock,
  Copy,
  Save,
  Send,
  Download,
  Undo2,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  apiService,
  apiErrorMessage,
  TaskSheetChanges,
  TaskSheetData,
  TaskSheetSummary,
} from './src/services/api.service';

const PAGE_SIZE = 100;
const AUTOSAVE_MS = 60_000;

/** Numbers (phone, account, amount) may be copied; anything containing letters - names, addresses - may not. */
export const isCopyableValue = (value: string): boolean => /\d/.test(value) && !/\p{L}/u.test(value);

const rowKey = (sheetIndex: number, rowIndex: number) => `${sheetIndex}:${rowIndex}`;

const formatTime = (iso?: string | null): string => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

function writeClipboard(text: string): Promise<void> {
  const electronClipboard = (window as any).require?.('electron')?.clipboard;
  if (electronClipboard?.writeText) {
    electronClipboard.writeText(text);
    return Promise.resolve();
  }
  return navigator.clipboard.writeText(text);
}

const isTextEntry = (el: EventTarget | Element | null): boolean =>
  !!el && el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/** Progress chip + open button for a task's spreadsheet, used in My Tasks and Create Task. */
export const TaskSheetChip: React.FC<{ sheet: TaskSheetSummary; actionLabel: string; onOpen: () => void }> = ({
  sheet,
  actionLabel,
  onOpen,
}) => {
  const submitted = sheet.status === 'SUBMITTED';
  const pct = sheet.totalRows ? Math.round((sheet.answeredRows / sheet.totalRows) * 100) : 0;
  return (
    <div className="mt-3 flex items-center flex-wrap gap-2 font-normal">
      <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-semibold">
        <FileSpreadsheet className="w-3.5 h-3.5" />
        <span className="max-w-[200px] truncate">{sheet.fileName}</span>
      </span>
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        {sheet.answeredRows}/{sheet.totalRows} answered ({pct}%)
      </span>
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
          submitted
            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
            : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
        }`}
      >
        {submitted ? 'Sent to manager' : 'Draft'}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
      >
        {actionLabel}
      </button>
    </div>
  );
};

/**
 * Full-screen spreadsheet for a task. The assignee sees the manager's cells
 * locked (only numbers can be copied, nothing can be downloaded) and fills
 * in Client Response + Remarks per row, saves, then sends it to the manager.
 * A manager sees the same grid read-only, downloads the original or the
 * completed file, and can send it back for changes.
 */
export const TaskSheetWorkspace: React.FC<{
  taskId: string;
  onClose: () => void;
  onChanged?: () => void;
}> = ({ taskId, onClose, onChanged }) => {
  const [data, setData] = useState<TaskSheetData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<TaskSheetChanges>({});
  const editsRef = useRef(edits);
  editsRef.current = edits;

  const [activeSheet, setActiveSheet] = useState(0);
  const [filter, setFilter] = useState<'all' | 'pending' | 'answered'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [busy, setBusy] = useState<null | 'submit' | 'reopen' | 'original' | 'completed'>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState('');

  const flash = useCallback((kind: 'ok' | 'error' | 'info', text: string) => {
    setNotice({ kind, text });
  }, []);

  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await apiService.getTaskSheet(taskId);
      setData(res.data);
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Could not open the spreadsheet.'));
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const canEdit = !!data?.canEdit;
  // The assignee's view is protected; a manager (who may download anyway) is not.
  const isProtected = !!data && !data.canDownload;
  const dirtyCount = Object.keys(edits).length;

  const rowValue = useCallback(
    (key: string): { response: string; remarks: string } => {
      const edit = edits[key];
      if (edit) return edit;
      const saved = data?.responses[key];
      return { response: saved?.response || '', remarks: saved?.remarks || '' };
    },
    [edits, data],
  );

  const setRow = (key: string, patch: Partial<{ response: string; remarks: string }>) => {
    setEdits((prev) => {
      const current = prev[key] || {
        response: data?.responses[key]?.response || '',
        remarks: data?.responses[key]?.remarks || '',
      };
      return { ...prev, [key]: { ...current, ...patch } };
    });
  };

  const answeredCount = useMemo(() => {
    if (!data) return 0;
    const keys = new Set([...Object.keys(data.responses), ...Object.keys(edits)]);
    let n = 0;
    keys.forEach((k) => {
      if (rowValue(k).response) n++;
    });
    return n;
  }, [data, edits, rowValue]);

  /** Saves changed rows; returns false if it failed. */
  const save = useCallback(
    async (quiet = false): Promise<boolean> => {
      const sent = editsRef.current;
      if (Object.keys(sent).length === 0) return true;
      if (savingRef.current) return false;
      savingRef.current = true;
      setSaving(true);
      try {
        const res = await apiService.saveTaskSheet(taskId, sent);
        const result = res.data;
        setData((d) => (d ? { ...d, responses: result.responses, answeredRows: result.answeredRows, lastSavedAt: result.lastSavedAt } : d));
        // Keep anything typed while the save was in flight.
        setEdits((prev) => {
          const next = { ...prev };
          Object.keys(sent).forEach((k) => {
            if (next[k] === sent[k]) delete next[k];
          });
          return next;
        });
        if (!quiet) flash('ok', 'Changes saved');
        onChanged?.();
        return true;
      } catch (err) {
        flash('error', apiErrorMessage(err, 'Could not save - check your internet and try again.'));
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [taskId, flash, onChanged],
  );

  // Autosave every minute so a crash or a forgotten Save doesn't lose work.
  useEffect(() => {
    if (!canEdit) return;
    const t = setInterval(() => {
      if (Object.keys(editsRef.current).length > 0) void save(true);
    }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [canEdit, save]);

  const close = useCallback(async () => {
    if (canEdit && Object.keys(editsRef.current).length > 0) {
      const ok = await save(true);
      if (!ok) return;
    }
    onClose();
  }, [canEdit, save, onClose]);

  const copyValue = useCallback(
    (value: string) => {
      if (isProtected && !isCopyableValue(value)) {
        flash('info', 'Only numbers can be copied - names and text are protected.');
        return;
      }
      writeClipboard(value).then(
        () => flash('ok', `Copied ${value}`),
        () => flash('error', 'Could not copy'),
      );
    },
    [isProtected, flash],
  );

  const sheet = data?.sheets[activeSheet];

  // Keyboard + clipboard rules for the protected (assignee) view.
  useEffect(() => {
    if (!data) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !reopenOpen) {
        void close();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (canEdit) void save();
        return;
      }
      if (!isProtected) return;
      if (key === 'p') {
        e.preventDefault();
        return;
      }
      if (isTextEntry(document.activeElement)) return;
      if (key === 'a' || key === 'x') {
        e.preventDefault();
      } else if (key === 'c') {
        e.preventDefault();
        if (selected && sheet) copyValue(sheet.rows[selected.r]?.[selected.c] ?? '');
      }
    };
    const blockClipboard = (e: ClipboardEvent) => {
      if (isProtected && !isTextEntry(e.target)) e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('copy', blockClipboard, true);
    document.addEventListener('cut', blockClipboard, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('copy', blockClipboard, true);
      document.removeEventListener('cut', blockClipboard, true);
    };
  }, [data, isProtected, canEdit, selected, sheet, copyValue, save, close, reopenOpen]);

  const visibleRows = useMemo(() => {
    if (!sheet) return [];
    const q = search.trim().toLowerCase();
    const out: number[] = [];
    sheet.rows.forEach((row, ri) => {
      const v = rowValue(rowKey(activeSheet, ri));
      if (filter === 'pending' && v.response) return;
      if (filter === 'answered' && !v.response) return;
      if (q && !row.some((cell) => cell.toLowerCase().includes(q)) && !v.remarks.toLowerCase().includes(q)) return;
      out.push(ri);
    });
    return out;
  }, [sheet, activeSheet, filter, search, rowValue]);

  useEffect(() => {
    setPage(0);
    setSelected(null);
  }, [activeSheet, filter, search]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pageRows = visibleRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const handleSubmit = async () => {
    if (!data) return;
    const pending = data.totalRows - answeredCount;
    const message =
      pending > 0
        ? `${pending} of ${data.totalRows} rows have no client response yet.\n\nSend to your manager anyway? You can't edit it after sending unless your manager sends it back.`
        : `Send the completed spreadsheet to your manager?\n\nYou can't edit it after sending unless your manager sends it back.`;
    if (!window.confirm(message)) return;
    setBusy('submit');
    try {
      const res = await apiService.submitTaskSheet(taskId, editsRef.current);
      setEdits({});
      setData((d) =>
        d
          ? {
              ...d,
              ...res.data,
              canEdit: false,
            }
          : d,
      );
      flash('ok', 'Sent to your manager');
      onChanged?.();
    } catch (err) {
      flash('error', apiErrorMessage(err, 'Could not send - check your internet and try again.'));
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async (version: 'original' | 'completed') => {
    setBusy(version);
    try {
      const { blob, fileName } = await apiService.downloadTaskSheet(taskId, version);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      flash('error', apiErrorMessage(err, 'Download failed.'));
    } finally {
      setBusy(null);
    }
  };

  const handleReopen = async () => {
    setBusy('reopen');
    try {
      await apiService.reopenTaskSheet(taskId, reopenNote.trim());
      setReopenOpen(false);
      setReopenNote('');
      await load();
      flash('ok', 'Sent back to the employee for changes');
      onChanged?.();
    } catch (err) {
      flash('error', apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const btn =
    'inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-stretch justify-center p-4 font-sans">
      <div
        className="w-full max-w-[1400px] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden"
        onContextMenu={isProtected ? (e) => !isTextEntry(e.target) && e.preventDefault() : undefined}
        onDragStart={isProtected ? (e) => e.preventDefault() : undefined}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
              <h2 className="font-extrabold text-slate-800 dark:text-white truncate">{data?.fileName || 'Spreadsheet'}</h2>
              {data && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    data.status === 'SUBMITTED'
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {data.status === 'SUBMITTED' ? `Sent to manager ${formatTime(data.submittedAt)}` : 'Draft - not sent yet'}
                </span>
              )}
            </div>
            {data && (
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                <span>
                  Task: <span className="font-semibold">{data.taskTitle}</span>
                  {!isProtected && <> · {data.assigneeName}</>}
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-28 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <span
                      className="block h-full bg-emerald-500"
                      style={{ width: `${data.totalRows ? (answeredCount / data.totalRows) * 100 : 0}%` }}
                    />
                  </span>
                  {answeredCount}/{data.totalRows} answered
                </span>
                {canEdit && (
                  <span>
                    {saving
                      ? 'Saving…'
                      : dirtyCount > 0
                      ? `${dirtyCount} unsaved row${dirtyCount === 1 ? '' : 's'}`
                      : data.lastSavedAt
                      ? `Saved ${formatTime(data.lastSavedAt)}`
                      : 'Nothing saved yet'}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && (
              <>
                <button
                  onClick={() => void save()}
                  disabled={saving || dirtyCount === 0}
                  className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700`}
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save</span>
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={busy !== null || saving}
                  className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`}
                >
                  {busy === 'submit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Send to manager</span>
                </button>
              </>
            )}
            {data?.canDownload && (
              <>
                <button
                  onClick={() => handleDownload('original')}
                  disabled={busy !== null}
                  className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700`}
                >
                  {busy === 'original' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>Original file</span>
                </button>
                <button
                  onClick={() => handleDownload('completed')}
                  disabled={busy !== null}
                  className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}
                >
                  {busy === 'completed' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>Download with responses</span>
                </button>
              </>
            )}
            {data?.canReopen && (
              <button
                onClick={() => setReopenOpen((o) => !o)}
                disabled={busy !== null}
                className={`${btn} bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50`}
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Send back for changes</span>
              </button>
            )}
            <button
              onClick={() => void close()}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close (saves your changes)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {reopenOpen && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/60 dark:border-amber-900/40 flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={reopenNote}
              maxLength={500}
              onChange={(e) => setReopenNote(e.target.value)}
              placeholder="What should the employee fix? (optional)"
              className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handleReopen}
              disabled={busy === 'reopen'}
              className={`${btn} bg-amber-600 hover:bg-amber-700 text-white justify-center`}
            >
              {busy === 'reopen' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
              <span>Send back</span>
            </button>
          </div>
        )}

        {isProtected && data && (
          <div className="px-6 py-2 bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>
              {canEdit
                ? "Your manager's columns are locked. Fill in Client Response and Remarks, then Save and Send to manager. Only numbers can be copied (click the copy icon, or select a number and press Ctrl+C). This file can't be downloaded."
                : 'This spreadsheet was sent to your manager and is now read-only. Ask your manager to send it back if you need to change something.'}
            </span>
          </div>
        )}

        {/* Toolbar */}
        {data && sheet && (
          <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-3">
            {data.sheets.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto">
                {data.sheets.map((s, i) => (
                  <button
                    key={s.name + i}
                    onClick={() => setActiveSheet(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      i === activeSheet
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {(['all', 'pending', 'answered'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    filter === f
                      ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {f === 'all' ? 'All rows' : f === 'pending' ? 'No response yet' : 'Answered'}
                </button>
              ))}
            </div>
            <div className="relative md:ml-auto">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rows…"
                className="pl-8 pr-3 py-1.5 w-full md:w-56 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          {loadError ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-10 text-sm text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="font-semibold">{loadError}</p>
              <button onClick={load} className="mt-3 text-xs font-bold text-indigo-600 hover:underline cursor-pointer">
                Try again
              </button>
            </div>
          ) : !data || !sheet ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Opening spreadsheet…
            </div>
          ) : (
            <table className="min-w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 px-2 py-2 text-slate-400 font-semibold border-b border-r border-slate-200 dark:border-slate-700 w-10">
                    #
                  </th>
                  {sheet.header.map((h, c) => (
                    <th
                      key={c}
                      className="bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left text-slate-600 dark:text-slate-300 font-bold whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 select-none"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Lock className="w-3 h-3 text-slate-400" />
                        {h}
                      </span>
                    </th>
                  ))}
                  <th className="bg-indigo-50 dark:bg-indigo-950/60 px-3 py-2 text-left text-indigo-700 dark:text-indigo-300 font-bold whitespace-nowrap border-b border-r border-indigo-100 dark:border-indigo-900/50 min-w-[170px]">
                    Client Response
                  </th>
                  <th className="bg-indigo-50 dark:bg-indigo-950/60 px-3 py-2 text-left text-indigo-700 dark:text-indigo-300 font-bold whitespace-nowrap border-b border-r border-indigo-100 dark:border-indigo-900/50 min-w-[260px]">
                    Remarks
                  </th>
                  <th className="bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left text-slate-400 font-semibold whitespace-nowrap border-b border-slate-200 dark:border-slate-700">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={sheet.header.length + 4} className="p-10 text-center text-slate-400">
                      No rows match this filter.
                    </td>
                  </tr>
                )}
                {pageRows.map((ri) => {
                  const key = rowKey(activeSheet, ri);
                  const value = rowValue(key);
                  const saved = data.responses[key];
                  const unsaved = !!edits[key];
                  const row = sheet.rows[ri];
                  return (
                    <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="sticky left-0 bg-white dark:bg-slate-900 px-2 py-1.5 text-slate-400 text-center border-b border-r border-slate-100 dark:border-slate-800 select-none">
                        {ri + 2}
                      </td>
                      {sheet.header.map((_, c) => {
                        const cell = row[c] ?? '';
                        const copyable = cell !== '' && (!isProtected || isCopyableValue(cell));
                        const isSelected = selected?.r === ri && selected?.c === c;
                        return (
                          <td
                            key={c}
                            onClick={() => setSelected({ r: ri, c })}
                            title={cell}
                            className={`px-3 py-1.5 border-b border-r border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 max-w-[280px] ${
                              isProtected ? 'select-none' : ''
                            } ${isSelected ? 'outline outline-2 -outline-offset-2 outline-indigo-500' : ''}`}
                          >
                            <div className="group flex items-center gap-1.5">
                              <span className="truncate">{cell}</span>
                              {isProtected && copyable && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyValue(cell);
                                  }}
                                  className="shrink-0 p-0.5 rounded text-slate-300 hover:text-indigo-600 group-hover:text-slate-400 cursor-pointer"
                                  title="Copy number"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 border-b border-r border-slate-100 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/10">
                        {canEdit ? (
                          <select
                            value={value.response}
                            onChange={(e) => setRow(key, { response: e.target.value })}
                            className={`w-full px-2 py-1 rounded-lg border text-xs focus:outline-none focus:border-indigo-500 bg-white dark:bg-slate-900 ${
                              value.response
                                ? 'border-emerald-300 dark:border-emerald-800 text-slate-800 dark:text-white'
                                : 'border-slate-200 dark:border-slate-700 text-slate-400'
                            }`}
                          >
                            <option value="">— Select —</option>
                            {data.responseOptions.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={value.response ? 'font-semibold text-slate-800 dark:text-white' : 'text-slate-300'}>
                            {value.response || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 border-b border-r border-slate-100 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/10">
                        {canEdit ? (
                          <input
                            type="text"
                            value={value.remarks}
                            maxLength={500}
                            onChange={(e) => setRow(key, { remarks: e.target.value })}
                            placeholder="Add remarks…"
                            className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                          />
                        ) : (
                          <span className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{value.remarks}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 whitespace-nowrap">
                        {unsaved ? <span className="text-amber-600 font-semibold">Unsaved</span> : formatTime(saved?.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {data && sheet && (
          <div className="px-6 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              {visibleRows.length === 0
                ? '0 rows'
                : `Rows ${page * PAGE_SIZE + 1}–${Math.min(visibleRows.length, (page + 1) * PAGE_SIZE)} of ${visibleRows.length}`}
              {visibleRows.length !== sheet.rows.length && ` (filtered from ${sheet.rows.length})`}
            </span>
            {notice && (
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${
                  notice.kind === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : notice.kind === 'ok'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-indigo-600 dark:text-indigo-400'
                }`}
              >
                {notice.kind === 'error' ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {notice.text}
                {notice.kind === 'error' && (
                  <X className="w-3.5 h-3.5 cursor-pointer" onClick={() => setNotice(null)} />
                )}
              </span>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>
                Page {page + 1} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskSheetWorkspace;
