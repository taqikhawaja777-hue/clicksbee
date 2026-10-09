import { useEffect, useState } from 'react';

type UpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
  message: string;
  version?: string;
};

const initialStatus: UpdateStatus = {
  state: 'idle',
  message: 'Updates are checked automatically.',
};

/** Displays the native Electron updater state without affecting web builds. */
export function UpdateStatusIndicator() {
  const [status, setStatus] = useState<UpdateStatus>(initialStatus);

  useEffect(() => {
    const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
    if (!ipcRenderer) return;

    ipcRenderer.invoke('updater:get-status').then(setStatus).catch(() => undefined);
    const onStatus = (_event: unknown, nextStatus: UpdateStatus) => setStatus(nextStatus);
    ipcRenderer.on('updater:status', onStatus);
    return () => ipcRenderer.removeListener('updater:status', onStatus);
  }, []);

  const color = status.state === 'error'
    ? '#dc2626'
    : status.state === 'ready'
    ? '#059669'
    : '#64748b';

  return (
    <div
      title={status.message}
      style={{
        position: 'fixed',
        right: 24,
        bottom: 20,
        zIndex: 1000,
        maxWidth: 320,
        padding: '8px 12px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.96)',
        boxShadow: '0 4px 16px rgba(15,23,42,0.15)',
        color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {status.message}
    </div>
  );
}
