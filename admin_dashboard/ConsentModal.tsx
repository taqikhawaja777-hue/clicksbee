import React, { useState } from 'react';
import { ShieldCheck, Lock, Eye, Clock, Trash2, PauseCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

interface ConsentModalProps {
  policyVersion?: string;
  onConsentAccepted: () => void;
}

export const ConsentModal: React.FC<ConsentModalProps> = ({
  policyVersion = '1.0.0',
  onConsentAccepted,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleAcceptConsent = async () => {
    if (!agreedToTerms) return;
    setIsSubmitting(true);

    try {
      // Record consent on backend
      await fetch('http://localhost:3000/api/v1/consent/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyVersion,
          ipAddress: '127.0.0.1',
          userAgent: 'WorkTrackPro Desktop Agent',
        }),
      });
    } catch (e) {
      console.warn('Backend API consent connection fallback mode:', e);
    }

    // Store consent locally
    localStorage.setItem(`stitch_consent_accepted_${policyVersion}`, 'true');
    setIsSubmitting(false);
    onConsentAccepted();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[9999] flex items-center justify-center p-4 select-none font-sans">
      <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh]">
        
        {/* Top Header Banner */}
        <div className="p-6 bg-indigo-600 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl">
              <ShieldCheck className="w-7 h-7 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight">Employee Monitoring Consent & Transparency Policy</h2>
              <p className="text-xs text-indigo-100 mt-0.5">Policy Version {policyVersion} · Mandatory First Launch Disclosure</p>
            </div>
          </div>
          <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-full text-xs font-bold">
            Transparent Compliance
          </span>
        </div>

        {/* Scrollable Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-slate-700 dark:text-slate-200">
          
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 rounded-2xl flex items-start space-x-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">Required Consent Notice:</strong> WorkTrackPro operates with complete employee self-visibility. Before desktop monitoring begins, you must review and acknowledge what data is collected and your privacy rights.
            </div>
          </div>

          {/* 5 Core Policy Pillars */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* 1. What is captured */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs">
                <Eye className="w-4 h-4" />
                <span>1. What Data Is Captured</span>
              </div>
              <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1 list-disc pl-4">
                <li>Full Desktop Screen Captures</li>
                <li>Active Application & Window Titles</li>
                <li>System Idle vs Active Work Duration</li>
              </ul>
            </div>

            {/* 2. Frequency */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs">
                <Clock className="w-4 h-4" />
                <span>2. Capture Frequency</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Screenshots are captured automatically at randomized 5 to 15-minute intervals only during active checked-in work sessions and configured shift hours.
              </p>
            </div>

            {/* 3. Who can view */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs">
                <Lock className="w-4 h-4" />
                <span>3. Authorized Viewers</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Only designated Organization Managers, System Administrators, and YOU (via your Employee Self-Visibility Portal) have access to monitoring logs.
              </p>
            </div>

            {/* 4. Retention */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs">
                <Trash2 className="w-4 h-4" />
                <span>4. Auto-Deletion Retention</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                All screenshots are automatically purged after 60 days via scheduled BullMQ retention jobs.
              </p>
            </div>

          </div>

          {/* 5. Pause & Privacy Rights */}
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/50 rounded-2xl space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-300 font-extrabold">
              <PauseCircle className="w-4 h-4" />
              <span>5. Pause & Privacy Controls (Section 2.3)</span>
            </div>
            <p className="text-emerald-800 dark:text-emerald-200 leading-relaxed">
              You can click <strong>"Pause Monitoring"</strong> at any time for personal breaks. While paused, no screenshots are captured. Excluded applications (such as password managers or banking apps) are automatically excluded from capture.
            </p>
          </div>

          {/* Agreement Checkbox */}
          <label className="flex items-center space-x-3 p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl cursor-pointer border border-slate-200 dark:border-slate-700">
            <input 
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-xs font-bold text-slate-800 dark:text-white">
              I have read, understood, and consent to the WorkTrackPro Employee Monitoring Policy (v{policyVersion}).
            </span>
          </label>

        </div>

        {/* Footer Actions */}
        <div className="p-5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-medium">
            Non-dismissable consent modal · WorkTrackPro v1.0
          </div>

          <button
            onClick={handleAcceptConsent}
            disabled={!agreedToTerms || isSubmitting}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-2xl flex items-center space-x-2 shadow-lg shadow-indigo-500/25 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>{isSubmitting ? 'Recording Consent...' : 'Accept & Proceed to Dashboard'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
