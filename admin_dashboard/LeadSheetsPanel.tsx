import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, MapPin, Plus, Save, Send, Sheet, Trash2, X } from 'lucide-react';
import {
  apiService,
  apiErrorMessage,
  LEAD_FIELDS,
  LeadField,
  LeadRecipient,
  LeadRow,
  LeadSheet,
  LeadSheetSummary,
} from './src/services/api.service';

const COLUMNS: { field: LeadField; label: string; width: string }[] = [
  { field: 'customerName', label: 'Customer Name', width: 'min-w-[160px]' },
  { field: 'contact', label: 'Contact', width: 'min-w-[130px]' },
  { field: 'address', label: 'Address (Maps link)', width: 'min-w-[220px]' },
  { field: 'offer', label: 'Offer', width: 'min-w-[110px]' },
  { field: 'time', label: 'Time', width: 'min-w-[110px]' },
  { field: 'reference', label: 'Reference', width: 'min-w-[130px]' },
  { field: 'customerResponse', label: 'Customer Response', width: 'min-w-[200px]' },
];
// Column order for pasting from Excel: the 7 text fields, chat proof is attached separately.
const PASTE_ORDER: LeadField[] = ['customerName', 'contact', 'address', 'offer', 'time', 'reference', 'customerResponse'];

const AUTOSAVE_DELAY_MS = 2000;

const unwrap = <T,>(res: any): T => (res && typeof res === 'object' && 'data' in res ? res.data : res) as T;
const newRow = (): LeadRow => ({
  id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  customerName: '',
  contact: '',
  address: '',
  offer: '',
  time: '',
  reference: '',
  customerResponse: '',
  chatProofId: null,
});

const MAPS_URL = /^https:\/\/((maps\.app\.goo\.gl|goo\.gl\/maps)\/|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+\/)/i;

/** A Google Maps link opens as-is; any other address text opens as a Maps search. */
export function mapsLinkFor(address: string): string | null {
  const a = address.trim();
  if (!a) return null;
  if (MAPS_URL.test(a)) return a;
  if (/^https?:\/\//i.test(a)) return null; // not a maps link - never open arbitrary sites
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
}

/** Screenshot -> JPEG at most 1400 px wide (well under the 1 MB server limit). */
async function compressImage(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1400 / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const statusBadge = (s: LeadSheetSummary) =>
  s.status === 'SENT'
    ? { text: s.mine ? `Sent to ${s.closerName}` : `From ${s.createdByName} to ${s.closerName}`, cls: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400' }
    : { text: 'Draft', cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400' };

/**
 * Lead sheets: an employee fills customer rows (paste straight from Excel),
 * attaches a chat-proof screenshot per customer and sends the sheet to one
 * Closer, Team Lead or Back Office person, who can then view and edit it.
 * The agent can only view it after sending. Only Admin can download -
 * there is no download.
 */
export const LeadSheetsPanel: React.FC<{ standalone?: boolean }> = ({ standalone }) => {
  const [sheets, setSheets] = useState<LeadSheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setSheets(unwrap<LeadSheetSummary[]>(await apiService.getLeadSheets()) || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load lead sheets.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Electron has no window.prompt - the name is typed in an inline box instead.
  const [newTitle, setNewTitle] = useState<string | null>(null);

  const create = async () => {
    const title = (newTitle || '').trim();
    if (!title) return;
    setCreating(true);
    try {
      const sheet = unwrap<LeadSheet>(await apiService.createLeadSheet(title));
      setNewTitle(null);
      await load();
      setOpenId(sheet.id);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the sheet.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden ${standalone ? 'max-w-5xl' : ''}`}>
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl text-emerald-600">
            <Sheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white">Lead Sheets</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Customer details for a Closer, Team Lead or Back Office. Paste rows from Excel, attach the chat screenshot, then send. View and edit in the app only - no download.
            </p>
          </div>
        </div>
        {newTitle === null ? (
          <button
            onClick={() => setNewTitle(`Leads ${new Date().toLocaleDateString()}`)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Lead Sheet</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') setNewTitle(null);
              }}
              placeholder="Sheet name"
              className="w-48 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => void create()}
              disabled={creating || !newTitle.trim()}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setNewTitle(null)} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {error && <p className="px-6 pt-4 text-xs font-semibold text-rose-600">{error}</p>}
      {loading ? (
        <p className="p-6 text-xs text-slate-400">Loading…</p>
      ) : sheets.length === 0 ? (
        <p className="p-6 text-xs text-slate-400">No lead sheets yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {sheets.map((s) => {
            const badge = statusBadge(s);
            return (
              <div key={s.id} className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{s.title}</p>
                  <p className="text-[11px] text-slate-400">
                    {s.rowCount} customer{s.rowCount === 1 ? '' : 's'}
                    {!s.mine && s.status === 'DRAFT' ? ` · by ${s.createdByName}` : ''}
                    {s.sentAt ? ` · sent ${new Date(s.sentAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
                  <button
                    onClick={() => setOpenId(s.id)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    {s.status === 'DRAFT' && s.mine ? 'Edit' : 'Open'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openId && (
        <LeadSheetEditor
          sheetId={openId}
          onClose={() => {
            setOpenId(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

const LeadSheetEditor: React.FC<{ sheetId: string; onClose: () => void }> = ({ sheetId, onClose }) => {
  const [sheet, setSheet] = useState<LeadSheet | null>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [closers, setClosers] = useState<LeadRecipient[]>([]);
  const [closerId, setCloserId] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'send' | 'delete' | 'proof' | 'download'>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [proofView, setProofView] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const proofRowRef = useRef<number | null>(null);

  const editable = !!sheet?.canEdit;

  useEffect(() => {
    apiService
      .getLeadSheet(sheetId)
      .then((res) => {
        const s = unwrap<LeadSheet>(res);
        setSheet(s);
        setTitle(s.title);
        setRows(s.canEdit && s.rows.length === 0 ? [newRow(), newRow(), newRow()] : s.rows);
        if (s.canSend) {
          apiService
            .getLeadRecipients()
            .then((c) => setClosers(unwrap<LeadRecipient[]>(c) || []))
            .catch(() => undefined);
        }
      })
      .catch((err) => setMessage({ ok: false, text: apiErrorMessage(err, 'Could not open the sheet.') }));
  }, [sheetId]);

  // No printing of customer data from this window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const setCell = (ri: number, field: LeadField, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === ri ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  /** Pasting several cells from Excel (tab/newline separated) fills right and down, adding rows. */
  const onPaste = (ri: number, field: LeadField) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    const startCol = PASTE_ORDER.indexOf(field);
    setRows((prev) => {
      const next = [...prev];
      lines.forEach((line, li) => {
        const target = ri + li;
        while (next.length <= target) next.push(newRow());
        const row = { ...next[target] };
        line.split('\t').forEach((value, ci) => {
          const f = PASTE_ORDER[startCol + ci];
          if (f) row[f] = value.trim();
        });
        next[target] = row;
      });
      return next;
    });
    setDirty(true);
  };

  // Latest values, so an edit typed while a save is in flight stays "unsaved" and gets the next save.
  const latest = useRef({ rows, title });
  latest.current = { rows, title };

  const save = async (quiet = false): Promise<boolean> => {
    if (!editable) return true;
    setBusy('save');
    const sent = { rows, title };
    try {
      const s = unwrap<LeadSheet>(await apiService.updateLeadSheet(sheetId, sent));
      setSheet(s);
      if (latest.current.rows === sent.rows && latest.current.title === sent.title) setDirty(false);
      if (!quiet) setMessage({ ok: true, text: 'Saved.' });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not save.') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // No Save button: changes save by themselves 2 s after the last edit (and on close / send).
  useEffect(() => {
    if (!editable || !dirty || busy) return;
    const t = setTimeout(() => void save(true), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, title, dirty, editable, busy]);

  const send = async () => {
    if (!closerId) {
      setMessage({ ok: false, text: 'Choose who to send it to.' });
      return;
    }
    const closer = closers.find((c) => c.id === closerId)?.name || 'them';
    if (!window.confirm(`Send this sheet to ${closer}? After sending only they (and Admin) can change it.`)) return;
    if (!(await save(true))) return;
    setBusy('send');
    try {
      const s = unwrap<LeadSheet>(await apiService.sendLeadSheet(sheetId, closerId));
      setSheet(s);
      setRows(s.rows);
      setMessage({ ok: true, text: `Sent to ${closer}.` });
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not send.') });
    } finally {
      setBusy(null);
    }
  };

  // Admin only - the server refuses everyone else.
  const download = async () => {
    if (dirty && !(await save(true))) return;
    setBusy('download');
    try {
      const { blob, fileName } = await apiService.downloadLeadSheet(sheetId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Download failed.') });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(sheet?.status === 'SENT' ? 'Delete this sheet for everyone?' : 'Delete this draft sheet?')) return;
    setBusy('delete');
    try {
      await apiService.deleteLeadSheet(sheetId);
      onClose();
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not delete.') });
      setBusy(null);
    }
  };

  const attachProof = async (ri: number, file: Blob) => {
    setBusy('proof');
    try {
      const image = await compressImage(file);
      const { chatProofId } = unwrap<{ chatProofId: string }>(await apiService.addLeadChatProof(sheetId, image));
      setRows((prev) => prev.map((r, i) => (i === ri ? { ...r, chatProofId } : r)));
      setDirty(true);
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not attach the screenshot.') });
    } finally {
      setBusy(null);
    }
  };

  const viewProof = async (proofId: string) => {
    try {
      setProofView(unwrap<{ image: string }>(await apiService.getLeadChatProof(sheetId, proofId)).image);
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, 'Could not open the screenshot.') });
    }
  };

  const close = async () => {
    if (editable && dirty && !(await save(true))) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-stretch justify-center p-4 font-sans">
      <div className="w-full max-w-[1400px] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl flex flex-col overflow-hidden select-text">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
          <Sheet className="w-5 h-5 text-emerald-600" />
          {editable && (sheet?.canSend || sheet?.canDownload) ? (
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              className="flex-1 min-w-[200px] px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          ) : (
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-slate-800 dark:text-white">{sheet?.title}</p>
              {sheet && (
                <p className="text-[11px] text-slate-400">
                  By {sheet.createdByName}
                  {sheet.closerName ? ` · sent to ${sheet.closerName}` : ''}
                  {sheet.sentAt ? ` · ${new Date(sheet.sentAt).toLocaleString()}` : ''} · {editable ? 'you can edit' : 'view only'}
                </p>
              )}
            </div>
          )}

          {editable && (
            <button
              onClick={() => void save()}
              disabled={busy !== null}
              title="Saves the sheet in the app (nothing is downloaded)"
              className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 font-bold text-xs rounded-xl cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}</span>
            </button>
          )}
          {sheet?.canDownload && (
            <button
              onClick={() => void download()}
              disabled={busy !== null}
              title="Admin only"
              className="inline-flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{busy === 'download' ? 'Downloading…' : 'Download Excel'}</span>
            </button>
          )}
          {sheet?.canSend && (
            <>
              <select
                value={closerId}
                onChange={(e) => setCloserId(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="">Send to…</option>
                {closers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.roleLabel})
                  </option>
                ))}
              </select>
              <button
                onClick={() => void send()}
                disabled={busy !== null}
                className="inline-flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{busy === 'send' ? 'Sending…' : 'Send'}</span>
              </button>
            </>
          )}
          {sheet?.canDelete && (
            <button
              onClick={() => void remove()}
              disabled={busy !== null}
              title="Delete sheet"
              className="p-2 text-slate-400 hover:text-rose-600 disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => void close()} title="Close" className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {message && (
          <p className={`px-5 pt-3 text-xs font-semibold ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
        )}
        {editable && (
          <p className="px-5 pt-2 text-[11px] text-slate-400">
            Tip: copy rows from Excel (columns in this order: Name, Contact, Address, Offer, Time, Reference, Response) and paste into a
            Customer Name cell - all fields fill in. Click "Attach" or paste a screenshot (Ctrl+V) into the Chat Proof cell.
          </p>
        )}

        <div className="flex-1 overflow-auto p-5">
          {!sheet ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : (
            <table className="min-w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="bg-slate-100 dark:bg-slate-800 px-2 py-2 text-slate-400 border-b border-r border-slate-200 dark:border-slate-700 w-10">#</th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.field}
                      className={`bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 ${col.width}`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 min-w-[120px]">
                    Chat Proof
                  </th>
                  {editable && <th className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 w-8" />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 3} className="p-8 text-center text-slate-400">
                      No customers in this sheet.
                    </td>
                  </tr>
                )}
                {rows.map((row, ri) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-2 py-1.5 text-center text-slate-400 border-b border-r border-slate-100 dark:border-slate-800">{ri + 1}</td>
                    {COLUMNS.map((col) => (
                      <td key={col.field} className="px-1.5 py-1 border-b border-r border-slate-100 dark:border-slate-800 align-top">
                        {col.field === 'address' && !editable ? (
                          <AddressCell value={row.address} />
                        ) : editable ? (
                          <div className="flex items-center gap-1">
                            <input
                              value={row[col.field]}
                              onChange={(e) => setCell(ri, col.field, e.target.value)}
                              onPaste={onPaste(ri, col.field)}
                              className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-indigo-500 rounded-lg text-xs text-slate-800 dark:text-white focus:outline-none"
                            />
                            {col.field === 'address' && mapsLinkFor(row.address) && (
                              <a href={mapsLinkFor(row.address)!} target="_blank" rel="noreferrer" title="Open in Google Maps">
                                <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="block px-2 py-1 text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                            {row[col.field] || '—'}
                          </span>
                        )}
                      </td>
                    ))}
                    <td
                      className="px-2 py-1 border-b border-r border-slate-100 dark:border-slate-800 align-top"
                      tabIndex={editable ? 0 : undefined}
                      onPaste={(e) => {
                        if (!editable) return;
                        const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
                        if (file) {
                          e.preventDefault();
                          void attachProof(ri, file);
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {row.chatProofId && (
                          <button
                            onClick={() => void viewProof(row.chatProofId!)}
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold cursor-pointer"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            View
                          </button>
                        )}
                        {editable && (
                          <button
                            onClick={() => {
                              proofRowRef.current = ri;
                              fileInput.current?.click();
                            }}
                            disabled={busy === 'proof'}
                            className="text-slate-500 hover:text-indigo-600 font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {row.chatProofId ? 'Replace' : busy === 'proof' ? '…' : 'Attach'}
                          </button>
                        )}
                        {!editable && !row.chatProofId && <span className="text-slate-400">—</span>}
                      </div>
                    </td>
                    {editable && (
                      <td className="px-1 border-b border-slate-100 dark:border-slate-800">
                        <button
                          onClick={() => {
                            setRows((prev) => prev.filter((_, i) => i !== ri));
                            setDirty(true);
                          }}
                          title="Remove row"
                          className="p-1 text-slate-300 hover:text-rose-600 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editable && (
            <button
              onClick={() => {
                setRows((prev) => [...prev, newRow()]);
                setDirty(true);
              }}
              className="mt-3 inline-flex items-center space-x-1.5 px-3 py-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 font-bold text-xs rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add customer</span>
            </button>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            const ri = proofRowRef.current;
            e.target.value = '';
            if (file && ri !== null) void attachProof(ri, file);
          }}
        />
      </div>

      {proofView && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6" onClick={() => setProofView(null)}>
          <img
            src={proofView}
            alt="Chat proof"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="max-w-full max-h-full rounded-xl shadow-2xl select-none"
          />
          <button onClick={() => setProofView(null)} className="absolute top-5 right-5 p-2 text-white/80 hover:text-white cursor-pointer">
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
};

const AddressCell: React.FC<{ value: string }> = ({ value }) => {
  const link = mapsLinkFor(value);
  if (!value) return <span className="block px-2 py-1 text-slate-400">—</span>;
  return link ? (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      title="Open in Google Maps"
      className="inline-flex items-center gap-1 px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:underline break-all"
    >
      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
      {value}
    </a>
  ) : (
    <span className="block px-2 py-1 text-slate-700 dark:text-slate-300 break-all">{value}</span>
  );
};

export default LeadSheetsPanel;
