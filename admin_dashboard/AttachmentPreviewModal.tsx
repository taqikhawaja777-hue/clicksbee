import React, { useEffect, useState } from 'react';
import { X, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { API_ORIGIN } from './src/services/api.service';

export const ACCEPTED_DOC_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp';

export interface AttachmentRef {
  url: string;
  name?: string | null;
}

export const attachmentDisplayName = (attachment: AttachmentRef): string =>
  attachment.name || decodeURIComponent(attachment.url.split('/').pop() || 'attachment').replace(/^\d+_/, '');

export const attachmentAbsoluteUrl = (url: string): string =>
  /^https?:\/\//i.test(url) ? url : `${API_ORIGIN}${url}`;

const isPdf = (name: string) => /\.pdf$/i.test(name);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);

/**
 * In-app viewer for a message/task attachment. The file is fetched as a
 * blob so the viewer is same-origin - the API's X-Frame-Options header
 * would block pointing an <iframe> at it directly.
 */
export const AttachmentPreviewModal: React.FC<{
  attachment: AttachmentRef | null;
  onClose: () => void;
  /** false = view only: no Download / Open externally, no PDF toolbar, no right-click save. */
  allowDownload?: boolean;
}> = ({ attachment, onClose, allowDownload = true }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const absoluteUrl = attachment ? attachmentAbsoluteUrl(attachment.url) : '';
  const fileName = attachment ? attachmentDisplayName(attachment) : '';

  useEffect(() => {
    if (!absoluteUrl) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setError(null);
    fetch(absoluteUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Could not load this file');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [absoluteUrl]);

  useEffect(() => {
    if (!attachment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachment, onClose]);

  if (!attachment) return null;

  const openExternal = () => {
    const shell = (window as any).require?.('electron')?.shell;
    if (shell?.openExternal) shell.openExternal(absoluteUrl);
    else window.open(absoluteUrl, '_blank', 'noopener');
  };

  const actionClasses =
    'inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors';

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-slate-200/80 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="text-sm font-bold text-slate-800 dark:text-white truncate">{fileName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {allowDownload && blobUrl && (
              <a href={blobUrl} download={fileName} className={actionClasses}>
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            )}
            {allowDownload ? (
              <button type="button" onClick={openExternal} className={actionClasses}>
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open externally</span>
              </button>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-[11px] font-bold">
                View only
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-auto"
          onContextMenu={allowDownload ? undefined : (e) => e.preventDefault()}
        >
          {error ? (
            <p className="text-sm text-rose-500 font-medium">{error}</p>
          ) : !blobUrl ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading…</span>
            </div>
          ) : isPdf(fileName) ? (
            <iframe
              src={allowDownload ? blobUrl : `${blobUrl}#toolbar=0&navpanes=0`}
              title={fileName}
              className="w-full h-full border-0"
            />
          ) : isImage(fileName) ? (
            <img src={blobUrl} alt={fileName} className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="text-center space-y-2 p-8">
              <FileText className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                Preview isn't available for this file type.
              </p>
              <p className="text-xs text-slate-400">
                {allowDownload ? 'Use Download or Open externally to view it.' : 'Ask your manager for a PDF or image version.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Compact clickable chip used wherever an attachment is listed. */
export const AttachmentChip: React.FC<{
  attachment: AttachmentRef;
  label?: string;
  onOpen: (attachment: AttachmentRef) => void;
}> = ({ attachment, label, onOpen }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onOpen(attachment);
    }}
    className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors max-w-full"
  >
    <FileText className="w-3.5 h-3.5 shrink-0" />
    <span className="truncate">{label || attachmentDisplayName(attachment)}</span>
  </button>
);

export default AttachmentPreviewModal;
