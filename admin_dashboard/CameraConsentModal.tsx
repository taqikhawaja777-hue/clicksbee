import React, { useState } from 'react';
import { Camera, ShieldCheck, EyeOff, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface CameraConsentModalProps {
  onDecision: (consented: boolean) => void;
}

/**
 * Camera-monitoring-specific consent gate. Separate from the base
 * ConsentModal (screenshots/activity monitoring) because camera monitoring
 * is opt-in per employee/team (ManagerSettingsView's toggle) rather than a
 * blanket policy everyone is subject to — this only appears when an admin
 * has actually enabled it for this employee, and unlike the base modal,
 * declining is a fully supported path (falls back to input-only tracking).
 */
export const CameraConsentModal: React.FC<CameraConsentModalProps> = ({ onDecision }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDecision = async (consented: boolean) => {
    setIsSubmitting(true);
    try {
      onDecision(consented);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 select-none font-sans">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="p-6 bg-indigo-600 text-white flex items-center space-x-3">
          <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl">
            <Camera className="w-7 h-7 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">Camera Presence Detection — Consent Required</h2>
            <p className="text-xs text-indigo-100 mt-0.5">Your team has enabled this optional feature. Review before it activates.</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-slate-700 dark:text-slate-200">
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 rounded-2xl flex items-start space-x-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              This is separate from, and in addition to, the screenshot/activity monitoring you already consented to. You can decline this specific feature without affecting the rest of the app.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs">
                <Clock className="w-4 h-4" />
                <span>What happens</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Every 15–30 seconds, your webcam briefly turns on (you'll see your device's camera indicator light), captures one frame, and checks locally on your machine whether a face is present.
              </p>
            </div>

            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/50 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-300 font-extrabold text-xs">
                <EyeOff className="w-4 h-4" />
                <span>What is NOT done</span>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                The image is never saved, uploaded, or shown to anyone — not to your manager, not to us. Only a yes/no result and a timestamp are recorded. No facial recognition or identification of any kind.
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2">
            <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs">
              <ShieldCheck className="w-4 h-4" />
              <span>Why it's combined with existing idle tracking</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              A moment is only ever counted as idle if you're both away from the camera AND not touching your mouse/keyboard — so reading or thinking at your desk without typing won't get flagged as idle.
            </p>
          </div>

          <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            If you decline, nothing changes for you — your activity will keep being tracked the same way it is today, using mouse/keyboard input only.
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end space-x-3">
          <button
            onClick={() => handleDecision(false)}
            disabled={isSubmitting}
            className="px-5 py-3 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-extrabold text-xs rounded-2xl flex items-center space-x-2 transition-all cursor-pointer"
          >
            <XCircle className="w-4 h-4" />
            <span>Decline (keep input-only tracking)</span>
          </button>
          <button
            onClick={() => handleDecision(true)}
            disabled={isSubmitting}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-2xl flex items-center space-x-2 shadow-lg shadow-indigo-500/25 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>{isSubmitting ? 'Saving...' : 'I Agree'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default CameraConsentModal;
