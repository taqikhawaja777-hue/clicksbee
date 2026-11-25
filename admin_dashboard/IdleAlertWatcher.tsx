import React, { useEffect, useState } from 'react';
import { Clock, PhoneOff, ShieldAlert } from 'lucide-react';
import { apiService } from './src/services/api.service';
import { playAlertBeep } from './alertSound';

type IdleAlertPayload =
  | { state: 'idle'; idleSince: string }
  | { state: 'active'; reason: 'active' | 'break' | 'stopped'; idleSince: string; endedAt: string };

type ActivityAlertPayload =
  | { kind: 'no_call'; since: string; minutes: number }
  | { kind: 'suspicious'; since: string; reason: string | null };

type IdleEventBody = {
  event: 'IDLE_STARTED' | 'IDLE_ENDED' | 'NO_CALL_GAP' | 'SUSPICIOUS_ACTIVITY';
  idleSince: string;
  endedAt?: string;
  reason?: string;
};

/** Reports to the backend (which notifies the manager and writes the log); one retry on a network error. */
function report(body: IdleEventBody): void {
  apiService.reportIdleEvent(body).catch(() => {
    setTimeout(() => {
      apiService.reportIdleEvent(body).catch((err) => console.warn('[IdleAlert] Could not report idle event:', err));
    }, 15_000);
  });
}

const IDLE_CAPTURE_INTERVAL_MS = 60_000;

/**
 * Idle Alert Report: one capture while idle - screenshot (the backend gets its
 * AI summary through Live Monitor) plus a small camera picture when camera
 * presence is running. Never called while the employee is active.
 */
async function sendIdleCapture(idleSince: string): Promise<void> {
  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
  if (!ipcRenderer?.invoke) return;
  try {
    const [shot, presence] = await Promise.all([
      ipcRenderer.invoke('capture-idle-screenshot'),
      // Loaded only when someone is idle - keeps the camera/face library out of app start-up.
      import('./src/services/presenceDetector')
        .then((m) => m.captureIdlePresence())
        .catch(() => ({ status: 'OFF' as const, frameData: undefined })),
    ]);
    if (!shot?.success) return;
    await apiService.recordIdleCapture({
      idleSince,
      capturedAt: new Date().toISOString(),
      screenshot: shot.screenshot,
      camera: presence.frameData,
      cameraStatus: presence.status,
    });
  } catch (err) {
    console.warn('[IdleAlert] Could not send idle capture:', err);
  }
}

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Employee-only. The main-process tracker (idleTimeTracker.ts) sends
 * 'idle-alert' when the employee crosses 2 minutes without real input
 * during working time (never in breaks) and again when they come back, and
 * 'activity-alert' for "no call for 15 minutes" and suspicious activity
 * (mouse jiggler / auto-input). Beeps, shows an alert, reports each event.
 */
export const IdleAlertWatcher: React.FC = () => {
  const [idleSince, setIdleSince] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState<ActivityAlertPayload | null>(null);
  // Shown after they come back - the "you are idle" message disappears the
  // moment the mouse moves, so this one stays until they press OK.
  const [wasIdle, setWasIdle] = useState<{ idleSince: string; endedAt: string } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
    if (!ipcRenderer) return;
    const onIdleAlert = (_event: unknown, payload: IdleAlertPayload) => {
      if (payload.state === 'idle') {
        setIdleSince(payload.idleSince);
        setDismissed(false);
        setWasIdle(null);
        playAlertBeep(3);
        report({ event: 'IDLE_STARTED', idleSince: payload.idleSince });
      } else {
        setIdleSince(null);
        if (payload.reason === 'active') {
          report({ event: 'IDLE_ENDED', idleSince: payload.idleSince, endedAt: payload.endedAt });
          setWasIdle({ idleSince: payload.idleSince, endedAt: payload.endedAt });
        }
      }
    };
    const onActivityAlert = (_event: unknown, payload: ActivityAlertPayload) => {
      setNotice(payload);
      playAlertBeep(2);
      if (payload.kind === 'no_call') {
        report({ event: 'NO_CALL_GAP', idleSince: payload.since });
      } else {
        report({ event: 'SUSPICIOUS_ACTIVITY', idleSince: payload.since, reason: payload.reason || undefined });
      }
    };
    ipcRenderer.on('idle-alert', onIdleAlert);
    ipcRenderer.on('activity-alert', onActivityAlert);
    return () => {
      ipcRenderer.removeListener('idle-alert', onIdleAlert);
      ipcRenderer.removeListener('activity-alert', onActivityAlert);
    };
  }, []);

  // Idle Alert Report: capture right away, then every minute until the employee is back.
  useEffect(() => {
    if (!idleSince) return;
    void sendIdleCapture(idleSince);
    const t = setInterval(() => void sendIdleCapture(idleSince), IDLE_CAPTURE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [idleSince]);

  // Live "idle for N min" counter while the alert is showing.
  useEffect(() => {
    if (!idleSince) return;
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [idleSince]);

  if (idleSince && !dismissed) {
    const minutes = Math.max(2, Math.floor((Date.now() - new Date(idleSince).getTime()) / 60_000));
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-slate-900/40 backdrop-blur-[2px] font-sans">
        <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-amber-400 p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center mb-3 animate-pulse">
            <Clock className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">
            You are idle since {formatClock(idleSince)} ({minutes} min)
          </h2>
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-1">
            Move your mouse or press any key to continue working.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your manager has been notified and this is recorded in your log.
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
  }

  if (wasIdle) {
    const minutes = Math.max(
      2,
      Math.round((new Date(wasIdle.endedAt).getTime() - new Date(wasIdle.idleSince).getTime()) / 60_000),
    );
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-slate-900/40 backdrop-blur-[2px] font-sans">
        <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-amber-400 p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center mb-3">
            <Clock className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">
            You were idle from {formatClock(wasIdle.idleSince)} to {formatClock(wasIdle.endedAt)} ({minutes} min)
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your manager has been notified and this is recorded in your log.
          </p>
          <button
            onClick={() => setWasIdle(null)}
            className="mt-5 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-2xl transition-colors cursor-pointer"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (!notice) return null;
  const isNoCall = notice.kind === 'no_call';
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-slate-900/40 backdrop-blur-[2px] font-sans">
      <div
        className={`w-full max-w-md mx-4 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 p-6 text-center ${
          isNoCall ? 'border-indigo-400' : 'border-rose-400'
        }`}
      >
        <div
          className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-3 ${
            isNoCall ? 'bg-indigo-100 dark:bg-indigo-950/60' : 'bg-rose-100 dark:bg-rose-950/60'
          }`}
        >
          {isNoCall ? <PhoneOff className="w-7 h-7 text-indigo-600" /> : <ShieldAlert className="w-7 h-7 text-rose-600" />}
        </div>
        <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">
          {isNoCall ? `No call for ${notice.minutes} minutes` : 'Unusual activity detected'}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {isNoCall
            ? `Your last call ended at ${formatClock(notice.since)}. Your manager has been notified.`
            : 'Activity that does not look like real work was detected. It has been recorded and your manager notified.'}
        </p>
        <button
          onClick={() => setNotice(null)}
          className={`mt-5 px-6 py-2.5 text-white font-bold text-sm rounded-2xl transition-colors cursor-pointer ${
            isNoCall ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-rose-600 hover:bg-rose-700'
          }`}
        >
          OK
        </button>
      </div>
    </div>
  );
};

export default IdleAlertWatcher;
