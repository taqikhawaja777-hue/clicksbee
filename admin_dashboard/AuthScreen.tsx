import React, { useState } from 'react';
import { Monitor, User, Mail, Lock, LogIn, UserPlus, ArrowRight, CheckCircle2, ShieldCheck, AlertCircle, Building2, Briefcase, KeyRound, X } from 'lucide-react';
import { useEmployee } from './EmployeeContext';

// Department and Designation are Employee-signup-only fields now - the
// Manager tab creates a bare admin/CEO-style account with neither (see
// isManagementTier()'s role-based fallback on the backend, which is
// exactly for a designation-less admin account like this). No separate
// department-management UI exists, so this stays a fixed list rather than
// fetching one from the backend.
const EMPLOYEE_DEPARTMENT_OPTIONS = ['Sales'];

// All designations live on the Employee tab now, including the two that
// used to be Manager-only (SM, HR) - designation, not which tab someone
// signed up through, is what determines management vs floor tier for
// messaging (see NotificationsService.isManagementTier on the backend).
const EMPLOYEE_DESIGNATION_OPTIONS = [
  { value: 'Team Lead', label: 'Team Lead' },
  { value: 'Employee', label: 'Employee' },
  { value: 'SM', label: 'SM (Sales Manager)' },
  { value: 'CSR', label: 'CSR (Customer Sales Representative)' },
  { value: 'HR', label: 'HR' },
];

interface AuthScreenProps {
  onLoginSuccess: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const { registerNewEmployee, loginEmployee } = useEmployee();
  const [isSignUpMode, setIsSignUpMode] = useState<boolean>(false); // Default Sign In tab
  const [roleMode, setRoleMode] = useState<'EMPLOYEE' | 'MANAGER'>('EMPLOYEE');
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [department, setDepartment] = useState<string>(EMPLOYEE_DEPARTMENT_OPTIONS[0]);
  const [designation, setDesignation] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(null);
  const [signupSuccessMsg, setSignupSuccessMsg] = useState<string | null>(null);

  // Manager tab is gated behind a shared unlock key - a soft deterrent
  // against casually clicking into Manager sign-in/signup, not real
  // access control (the key lives in this frontend bundle, and the
  // backend's own JWT/role checks are what actually gate Manager data).
  // Unlocked once per app session; switching to Employee and back to
  // Manager doesn't re-prompt.
  const MANAGER_UNLOCK_KEY = 'redrose';
  const [managerUnlocked, setManagerUnlocked] = useState<boolean>(false);
  const [showManagerKeyModal, setShowManagerKeyModal] = useState<boolean>(false);
  const [managerKeyInput, setManagerKeyInput] = useState<string>('');
  const [managerKeyError, setManagerKeyError] = useState<string | null>(null);

  const handleManagerKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (managerKeyInput.trim().toLowerCase() === MANAGER_UNLOCK_KEY) {
      setManagerUnlocked(true);
      setShowManagerKeyModal(false);
      setManagerKeyInput('');
      setManagerKeyError(null);
      setRoleMode('MANAGER');
      setDepartment(EMPLOYEE_DEPARTMENT_OPTIONS[0]);
      setDesignation('');
      setAuthErrorMsg(null);
    } else {
      setManagerKeyError('Incorrect key. Please try again.');
      setManagerKeyInput('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMsg(null);

    const cleanEmail = email.toLowerCase().trim();

    // Manager access is now allowed for any user with MANAGER role
    // Authorization handled by backend via JWT tokens and database role verification

    setIsSubmitting(true);

    try {
      if (isSignUpMode) {
        // Department/Designation are Employee-tab-only fields, not
        // rendered at all for Manager signup - never send whatever stale
        // value happens to be sitting in state for a field the user was
        // never shown, that would silently attribute a fake department to
        // a bare admin/CEO account.
        await registerNewEmployee(
          firstName.trim() || 'Taqi',
          lastName.trim() || 'Khawaja',
          cleanEmail,
          roleMode,
          password || 'Taqu77777',
          roleMode === 'EMPLOYEE' ? department : undefined,
          roleMode === 'EMPLOYEE' ? designation : undefined
        );

        setSignupSuccessMsg(`Account created as ${roleMode}! Saved in MongoDB. Please sign in below.`);
        setAuthErrorMsg(null);
        setIsSignUpMode(false);
      } else {
        const loginSuccessful = await loginEmployee(
          cleanEmail,
          password || 'Taqu77777',
          roleMode
        );

        if (loginSuccessful) {
          setAuthErrorMsg(null);
          onLoginSuccess();
        }
      }
    } catch (err: any) {
      console.log('Auth submission error:', err);
      setAuthErrorMsg(err?.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#f4f5fa] dark:bg-slate-950 flex items-center justify-center p-6 font-sans select-none transition-colors">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-2xl overflow-hidden">
        
        {/* Top Header Card */}
        <div className="bg-indigo-600 p-8 text-white text-center relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
          <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
            <Monitor className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">WorkTrackPro Portal</h1>
          <p className="text-indigo-100 text-xs mt-1">
            {roleMode === 'MANAGER' ? 'Manager Supervisor Portal' : 'Employee Workspace Portal'}
          </p>
        </div>

        {/* Form Container */}
        <div className="p-8 space-y-5">
          
          {/* Role Selection Switcher (EMPLOYEE vs MANAGER) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 text-center uppercase tracking-wider">
              Select Portal Access Role
            </label>
            <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setRoleMode('EMPLOYEE');
                  setDepartment(EMPLOYEE_DEPARTMENT_OPTIONS[0]);
                  setDesignation('');
                  setAuthErrorMsg(null);
                }}
                className={`py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 ${
                  roleMode === 'EMPLOYEE'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Employee</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (managerUnlocked) {
                    setRoleMode('MANAGER');
                    // Manager signup has neither field - reset to the
                    // Employee tab's defaults so they're back to sane
                    // values if the user switches back.
                    setDepartment(EMPLOYEE_DEPARTMENT_OPTIONS[0]);
                    setDesignation('');
                    setAuthErrorMsg(null);
                    return;
                  }
                  setManagerKeyInput('');
                  setManagerKeyError(null);
                  setShowManagerKeyModal(true);
                }}
                className={`py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 ${
                  roleMode === 'MANAGER'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-300" />
                <span>Manager</span>
              </button>
            </div>
          </div>

          {/* Error Alert Banner */}
          {authErrorMsg && (
            <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-2xl flex items-start space-x-2.5 text-xs text-red-800 dark:text-red-300">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Manager Access Restricted</p>
                <p className="mt-0.5">{authErrorMsg}</p>
              </div>
            </div>
          )}

          {/* Success Banner when redirected from Signup */}
          {signupSuccessMsg && !isSignUpMode && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl flex items-start space-x-2.5 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Registration Complete!</p>
                <p className="mt-0.5">{signupSuccessMsg}</p>
              </div>
            </div>
          )}

          {/* Mode Switcher Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 pb-2 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setIsSignUpMode(false)}
              className={`flex-1 py-1.5 text-center transition-colors ${
                !isSignUpMode ? 'text-indigo-600 dark:text-indigo-400 font-bold border-b-2 border-indigo-600' : 'text-slate-400'
              }`}
            >
              Sign In
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSignUpMode(true);
                setSignupSuccessMsg(null);
              }}
              className={`flex-1 py-1.5 text-center transition-colors ${
                isSignUpMode ? 'text-indigo-600 dark:text-indigo-400 font-bold border-b-2 border-indigo-600' : 'text-slate-400'
              }`}
            >
              New Signup
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {isSignUpMode && (
              <div className="grid grid-cols-2 gap-3">
                {/* First Name Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">First Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={roleMode === 'MANAGER' ? 'Taqi' : 'First Name'}
                      className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Last Name Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Last Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={roleMode === 'MANAGER' ? 'Khawaja' : 'Last Name'}
                      className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}

            {isSignUpMode && roleMode === 'EMPLOYEE' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Department</label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors appearance-none cursor-pointer"
                  >
                    {EMPLOYEE_DEPARTMENT_OPTIONS.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {isSignUpMode && roleMode === 'EMPLOYEE' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Designation</label>
                <div className="relative">
                  <Briefcase className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <select
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors appearance-none cursor-pointer"
                  >
                    <option value="">Select Designation (optional)</option>
                    {EMPLOYEE_DESIGNATION_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {roleMode === 'MANAGER' ? 'Manager Email Address' : 'Employee Email Address'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAuthErrorMsg(null);
                  }}
                  placeholder={roleMode === 'MANAGER' ? 'taqikhawaja777@gmail.com' : 'employee@stitchmonitor.com'}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthErrorMsg(null);
                  }}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/30 transition-all active:scale-98 cursor-pointer mt-2 disabled:opacity-50"
            >
              <span>
                {isSubmitting 
                  ? 'Verifying MongoDB Access...' 
                  : isSignUpMode 
                  ? `Register as ${roleMode}` 
                  : `Sign In to ${roleMode === 'MANAGER' ? 'Manager Dashboard' : 'Employee Portal'}`}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>

          </form>

        </div>

      </div>

      {/* Manager Unlock Key Modal - soft deterrent gate, not real access
          control (the backend's own JWT/role checks are what actually
          protect Manager data/endpoints). */}
      {showManagerKeyModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl text-indigo-600">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Manager Access Key</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowManagerKeyModal(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">Enter the unlock key to access the Manager portal.</p>

            <form onSubmit={handleManagerKeySubmit} className="space-y-3">
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  autoFocus
                  value={managerKeyInput}
                  onChange={(e) => {
                    setManagerKeyInput(e.target.value);
                    setManagerKeyError(null);
                  }}
                  placeholder="Enter key"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {managerKeyError && (
                <p className="text-xs text-rose-500 font-semibold flex items-center space-x-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{managerKeyError}</span>
                </p>
              )}

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-all active:scale-98 cursor-pointer"
              >
                Unlock
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthScreen;
