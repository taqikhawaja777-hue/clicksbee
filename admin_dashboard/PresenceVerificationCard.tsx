import React, { useEffect, useRef, useState } from 'react';
import { Camera, MousePointerClick, CheckCircle2, MoonStar, ChevronDown } from 'lucide-react';
import { mongoTrackingApiService, Employee } from './src/services/mongoTrackingApi.service';
import { useEmployee } from './EmployeeContext';
import { useShiftSummary } from './src/hooks/useShiftSummary';
import { attachPresencePreview } from './src/services/presenceDetector';

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

interface StatCardProps {
  label: string;
  seconds: number;
  icon: React.ElementType;
  accent: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, seconds, icon: Icon, accent }) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <div className={`p-2.5 rounded-2xl ${accent}`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
    <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-4">{formatDuration(seconds)}</h3>
  </div>
);

/**
 * Replaces the "Camera-Confirmed Active" StatCard's number with a live
 * preview of what the face detector currently sees, ONLY when this is the
 * logged-in employee's own card - the video feed comes from THIS device's
 * own camera, so it has no meaning for any other employee selected in the
 * dropdown above (there is still no video transmission between devices;
 * that invariant is untouched). Viewing someone else's data still shows
 * the plain duration number, same as before.
 */
const CameraPreviewCard: React.FC<{ seconds: number }> = ({ seconds }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let animId: number;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let cancelled = false;

    attachPresencePreview(canvasRef.current);

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        setCameraActive(true);

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const renderFrame = () => {
          if (cancelled || !canvas || !video) return;
          if (video.readyState >= 2) {
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          animId = requestAnimationFrame(renderFrame);
        };
        renderFrame();
      } catch (err: any) {
        console.warn('[CameraPreviewCard] Camera stream error:', err);
        setErrorMsg('Camera access unavailable or in use by another app');
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      if (animId) cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (video) {
        video.srcObject = null;
        video.remove();
      }
      attachPresencePreview(null);
    };
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">Camera-Confirmed Active</span>
        <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center gap-1.5">
          <Camera className="w-5 h-5" />
          {cameraActive && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
        </div>
      </div>
      <div className="mt-4 rounded-xl overflow-hidden bg-slate-900 aspect-video relative flex items-center justify-center">
        <canvas ref={canvasRef} className="w-full h-full object-cover" />
        {errorMsg && (
          <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-rose-400 bg-slate-900/90 font-medium">
            {errorMsg}
          </p>
        )}
        {!cameraActive && !errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400 text-xs gap-2">
            <Camera className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Activating camera…</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] text-slate-400 font-medium">Live - visible only to you, never recorded</p>
      <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">{formatDuration(seconds)} confirmed today</p>
    </div>
  );
};

/**
 * "Presence Verification" — for one employee: camera-confirmed active time
 * (from presence_logs, the only table with camera data) alongside
 * input-confirmed active/idle time. Sourced entirely from useShiftSummary -
 * THE single source of truth also used by EmployeeContext's Shift Live
 * Counter and the "Today, per employee" table (via useIdleTimeSummary,
 * which delegates to the same backend calculation). "Input-Confirmed
 * Active" and "Idle/Away" below use the SAME activeSeconds/idleSeconds
 * fields the table shows, not the separately-tracked
 * inputActiveSeconds/idleAwaySeconds fields (which are presence_logs-
 * derived and specific to camera-check samples, like Camera-Confirmed and
 * Combined Active) - keeping those two cards byte-identical to the table
 * is the whole point of this consolidation.
 */
export const PresenceVerificationCard: React.FC = () => {
  const { user } = useEmployee();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const { summary, loading } = useShiftSummary(selectedEmployeeId || null);

  useEffect(() => {
    mongoTrackingApiService
      .listEmployees()
      .then((list) => {
        setEmployees(list);
        if (list.length > 0) {
          // Default to whoever is actually logged in, not just the first
          // row the API happens to return - otherwise this card silently
          // shows a different employee's camera/idle data than the person
          // viewing it.
          const own = list.find((e) => e.email.toLowerCase() === user.email.toLowerCase());
          setSelectedEmployeeId((prev) => prev || own?.id || list[0].id);
        }
      })
      .catch((e) => console.warn('[PresenceVerificationCard] Failed to list employees:', e));
  }, [user.email]);

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6 space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 border border-indigo-200/60 dark:border-indigo-800/60">
            <Camera className="w-3.5 h-3.5" />
            <span>Presence Verification</span>
          </div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">Camera + Input Cross-Check</h2>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Camera presence combined with mouse/keyboard input. Your own camera feed is shown live to you only, so you can
            confirm you're in frame — it is never recorded, uploaded, or visible to anyone else. Input-Confirmed Active and
            Idle/Away below are the same figures as the "Today, per employee" table above; Camera-Confirmed and Combined
            Active are specific to camera-check samples.
          </p>
        </div>

        {employees.length > 0 && (
          <div className="relative">
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}
      </div>

      {employees.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-8">
          No employees are available yet.
        </p>
      ) : !selectedEmployee?.cameraMonitoringEnabled ? (
        <div className="text-center py-8 space-y-2">
          <Camera className="w-9 h-9 text-slate-300 mx-auto" />
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            Camera monitoring isn't enabled for {selectedEmployee?.fullName || 'this employee'}. Turn it on in
            Settings to see presence-verification stats here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <CameraPreviewCard seconds={summary?.cameraActiveSeconds || 0} />
          <StatCard
            label="Input-Confirmed Active"
            seconds={summary?.activeSeconds || 0}
            icon={MousePointerClick}
            accent="bg-purple-50 dark:bg-purple-950/50 text-purple-600"
          />
          <StatCard
            label="Combined Active (Camera Checks)"
            seconds={summary?.combinedActiveSeconds || 0}
            icon={CheckCircle2}
            accent="bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600"
          />
          <StatCard
            label="Idle/Away (Today)"
            seconds={summary?.idleSeconds || 0}
            icon={MoonStar}
            accent="bg-amber-50 dark:bg-amber-950/50 text-amber-600"
          />
        </div>
      )}
    </div>
  );
};

export default PresenceVerificationCard;
