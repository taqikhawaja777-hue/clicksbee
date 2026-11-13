import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { apiService } from './src/services/api.service';
import { playAlertBeep } from './alertSound';

type IdleAlertPayload =
  | { state: 'idle'; idleSince: string }
  | { state: 'active'; reason: 'active' | 'break' | 'stopped'; idleSince: string; endedAt: string };

type IdleEventBody = { event: 'IDLE_STARTED' | 'IDLE_ENDED'; idleSince: string; endedAt?: string };

/** Reports to the backend (which notifies the manager and writes the log); one retry on a network error. */
function report(body: IdleEventBody): void {
  apiService.reportIdleEvent(body).catch(() => {
    setTimeout(() => {
      apiService.reportIdleEvent(body).catch((err) => console.warn('[IdleAlert] Could not report idle event:', err));
    }, 15_000);
  });
}

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Employee-only. The main-process tracker (idleTimeTracker.ts) sends
 * 'idle-alert' when the employee crosses 2 minutes without mouse/keyboard
 * input during working time (never in breaks) and again when they come back.
 * Beeps, shows an alert on screen, and reports both events.
 */
export const IdleAlertWatcher: React.FC = () => {
  const [idleSince, setIdleSince] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
    if (!ipcRenderer) return;
    const onIdleAlert = (_event: unknown, payload: IdleAlertPayload) => {
      if (payload.state === 'idle') {
        setIdleSince(payload.idleSince);
        setDismissed(false);
        playAlertBeep(3);
        report({ event: 'IDLE_STARTED', idleSince: payload.idleSince });
      } else {
        setIdleSince(null);
        if (payload.reason === 'active') {
          report({ event: 'IDLE_ENDED', idleSince: payload.idleSince, endedAt: payload.endedAt });
        }
      }
    };
    ipcRenderer.on('idle-alert', onIdleAlert);
    return () => {
      ipcRenderer.removeListener('idle-alert', onIdleAlert);
    };
  }, []);

  // Live "idle for N min" counter while the alert is showing.
  useEffect(() => {
    if (!idleSince) return;
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [idleSince]);

  if (!idleSince || dismissed) return null;
  const minutes = Math.max(2, Math.floor((Date.now() - new Date(idleSince).getTime()) / 60_000));

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-slate-900/40 backdrop-blur-[2px] font-sans">
      <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-amber-400 p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center mb-3 animate-pulse">
          <Clock className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">You are idle</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          No mouse or keyboard activity since {formatClock(idleSince)} ({minutes} min). Your manager has been notified and
          this is recorded in your log.
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="mt-5 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-2xl transition-colors cursor-pointer"
        >
          I'm back
        </button>
      </div>
    </div>
  );
};

export default IdleAlertWatcher;
