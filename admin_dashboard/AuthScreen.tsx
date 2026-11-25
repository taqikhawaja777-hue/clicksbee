import React, { useEffect, useRef, useState } from 'react';
import { Monitor, User, Mail, Lock, ArrowRight, CheckCircle2, ShieldCheck, AlertCircle, Building2, Briefcase, KeyRound, X, Users } from 'lucide-react';
import { useEmployee, SignupCategory } from './EmployeeContext';
import { Category } from './src/services/api.service';

// Department and Designation are Employee-signup-only fields. No separate
// department-management UI exists, so this stays a fixed list.
const EMPLOYEE_DEPARTMENT_OPTIONS = ['Sales'];

// Employee (sales) tab: Team Lead / SM / HR moved to the Office and Manager
// categories, so each option appears in only one place.
const EMPLOYEE_DESIGNATION_OPTIONS = [
  { value: 'Employee', label: 'Employee' },
  { value: 'CSR', label: 'CSR (Customer Sales Representative)' },
];

// Office category - each decides the user's permissions (server: access.util.ts).
const OFFICE_CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'SM', label: 'SM (Sales Manager)' },
  { value: 'TEAM_LEAD', label: 'Team Lead' },
  { value: 'BACK_OFFICE', label: 'Back Office' },
  { value: 'VALIDATOR', label: 'Validator' },
  { value: 'CLOSER', label: 'Closer' },
];

// Unlock keys for the Office / Manager tabs. This is only a convenience gate
// in the app - the server checks the key again on signup (OFFICE_SIGNUP_KEY /
// MANAGER_SIGNUP_KEY) and decides every permission itself.
const TAB_KEYS: Record<'OFFICE' | 'MANAGER', string> = { OFFICE: 'blacksheep', MANAGER: 'redrose' };
const PORTAL_STORAGE_KEY = 'stitch_auth_portal';

const PORTAL_TITLES: Record<SignupCategory, string> = {
  EMPLOYEE: 'Employee Workspace Portal',
  OFFICE: 'Office Portal',
  MANAGER: 'Manager Supervisor Portal',
};

interface AuthScreenProps {
  onLoginSuccess: () => void;
  // Set when dashboard.tsx's auth:unauthorized listener bounced the user
  // back here because their refresh token itself died (expired past 7d,
  // revoked, or missing) - a plain access-token expiry self-heals
  // silently via apiService and never reaches this screen at all.
  sessionExpiredMessage?: string;
}

const inputClasses =
  'w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors';

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess, sessionExpiredMessage }) => {
  const { registerNewEmployee, loginEmployee } = useEmployee();
  const [isSignUpMode, setIsSignUpMode] = useState<boolean>(false); // Default Sign In tab
  const [roleMode, setRoleMode] = useState<SignupCategory>('EMPLOYEE');
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [rememberCredentials, setRememberCredentials] = useState<boolean>(true);
  const [department, setDepartment] = useState<string>(EMPLOYEE_DEPARTMENT_OPTIONS[0]);
  const [designation, setDesignation] = useState<string>('');
  const [officeCategory, setOfficeCategory] = useState<Category | ''>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(sessionExpiredMessage || null);
  const [signupSuccessMsg, setSignupSuccessMsg] = useState<string | null>(null);

  // Keys entered this session for the Office / Manager tabs (sent with signup).
  const [unlockedKeys, setUnlockedKeys] = useState<Partial<Record<'OFFICE' | 'MANAGER', string>>>({});
  const [keyModalFor, setKeyModalFor] = useState<'OFFICE' | 'MANAGER' | null>(null);
  const [keyInput, setKeyInput] = useState<string>('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const autoLoginTried = useRef(false);

  const resetCategoryFields = () => {
    setDepartment(EMPLOYEE_DEPARTMENT_OPTIONS[0]);
    setDesignation('');
    setOfficeCategory('');
    setAuthErrorMsg(null);
  };

  const ipc = () => (window as any).require?.('electron')?.ipcRenderer;

  const doLogin = async (loginEmail: string, loginPassword: string, portal: SignupCategory) => {
    const ok = await loginEmployee(loginEmail, loginPassword, portal);
    if (ok) {
      try {
        localStorage.setItem(PORTAL_STORAGE_KEY, portal);
      } catch {
        // storage unavailable
      }
      onLoginSuccess();
    }
    return ok;
  };

  useEffect(() => {
    const savedEmail = localStorage.getItem('stitch_auth_email') || '';
    if (savedEmail) setEmail(savedEmail);
    const savedPortal = localStorage.getItem(PORTAL_STORAGE_KEY) as SignupCategory | null;

    ipc()
      ?.invoke?.('auth:get-saved-credentials')
      .then(async (saved: { email: string; password: string } | null) => {
        if (!saved) return;
        setEmail(saved.email);
        setPassword(saved.password);
        setRememberCredentials(true);
        // Started by Windows sign-in / the restart watchdog (hidden in the
        // tray): sign in by ourselves so tracking starts without anyone clicking.
        const launch = await ipc()?.invoke?.('get-launch-info').catch(() => null);
        if (launch?.background && !autoLoginTried.current) {
          autoLoginTried.current = true;
          const portal = savedPortal || 'EMPLOYEE';
          setRoleMode(portal);
          try {
            await doLogin(saved.email, saved.password, portal);
          } catch (err) {
            console.warn('[Auth] Background sign-in failed - showing the window:', err);
            ipc()?.invoke?.('show-main-window');
          }
        }
      })
      .catch((error: unknown) => {
        console.warn('[Auth] Could not load saved credentials:', error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCredentials = async (cleanEmail: string, submittedPassword: string) => {
    try {
      localStorage.setItem('stitch_auth_email', cleanEmail);
    } catch (error) {
      console.warn('[Auth] Could not remember the email address:', error);
    }
    const ipcRenderer = ipc();
    if (!ipcRenderer?.invoke) return;

    try {
      if (rememberCredentials) {
        await ipcRenderer.invoke('auth:save-credentials', { email: cleanEmail, password: submittedPassword });
      } else {
        await ipcRenderer.invoke('auth:clear-saved-credentials');
      }
    } catch (error) {
      console.warn('[Auth] Could not save credentials securely:', error);
    }
  };

  const selectPortal = (portal: SignupCategory) => {
    if (portal === 'EMPLOYEE' || unlockedKeys[portal]) {
      setRoleMode(portal);
      resetCategoryFields();
      return;
    }
    setKeyInput('');
    setKeyError(null);
    setKeyModalFor(portal);
  };

  const handleKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyModalFor) return;
    if (keyInput.trim().toLowerCase() === TAB_KEYS[keyModalFor]) {
      setUnlockedKeys((prev) => ({ ...prev, [keyModalFor]: keyInput.trim() }));
      setRoleMode(keyModalFor);
      resetCategoryFields();
      setKeyModalFor(null);
      setKeyInput('');
    } else {
      setKeyError('Incorrect key. Please try again.');
      setKeyInput('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMsg(null);
    const cleanEmail = email.toLowerCase().trim();

    if (isSignUpMode && roleMode === 'OFFICE' && !officeCategory) {
      setAuthErrorMsg('Choose your Office Category.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUpMode) {
        await registerNewEmployee(
          firstName.trim() || 'Taqi',
          lastName.trim() || 'Khawaja',
          cleanEmail,
          roleMode,
          password || 'Taqu77777',
          roleMode === 'EMPLOYEE' ? department : undefined,
          roleMode === 'EMPLOYEE' ? designation : undefined,
          roleMode === 'OFFICE' ? (officeCategory as Category) : undefined,
          roleMode === 'EMPLOYEE' ? undefined : unlockedKeys[roleMode],
        );

        await saveCredentials(cleanEmail, password || 'Taqu77777');

        const created =
          roleMode === 'OFFICE'
            ? OFFICE_CATEGORY_OPTIONS.find((o) => o.value === officeCategory)?.label
            : roleMode === 'MANAGER'
            ? 'HR'
            : 'Employee';
        setSignupSuccessMsg(`Account created as ${created}. Please sign in below.`);
        setAuthErrorMsg(null);
        setIsSignUpMode(false);
      } else {
        const ok = await doLogin(cleanEmail, password || 'Taqu77777', roleMode);
        if (ok) {
          await saveCredentials(cleanEmail, password || 'Taqu77777');
          setAuthErrorMsg(null);
        }
      }
    } catch (err: any) {
      console.log('Auth submission error:', err);
      setAuthErrorMsg(err?.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabClass = (portal: SignupCategory) =>
    `py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 ${
      roleMode === portal
        ? portal === 'EMPLOYEE'
          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
          : 'bg-indigo-600 text-white shadow-md'
        : 'text-slate-500 dark:text-slate-400'
    }`;

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
          <p className="text-indigo-100 text-xs mt-1">{PORTAL_TITLES[roleMode]}</p>
        </div>

        {/* Form Container */}
        <div className="p-8 space-y-5">
          {/* Category switcher: Employee / Office / Manager */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 text-center uppercase tracking-wider">
              Select Portal Access Role
            </label>
            <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl text-xs font-bold">
              <button type="button" onClick={() => selectPortal('EMPLOYEE')} className={tabClass('EMPLOYEE')}>
                <User className="w-4 h-4" />
                <span>Employee</span>
              </button>
              <button type="button" onClick={() => selectPortal('OFFICE')} className={tabClass('OFFICE')}>
                <Users className="w-4 h-4" />
                <span>Office</span>
              </button>
              <button type="button" onClick={() => selectPortal('MANAGER')} className={tabClass('MANAGER')}>
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
                <p className="font-bold">{roleMode === 'MANAGER' ? 'Manager Access Restricted' : 'Sign-In Failed'}</p>
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

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
            {isSignUpMode && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">First Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First Name"
                      className={inputClasses}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Last Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last Name"
                      className={inputClasses}
                    />
                  </div>
                </div>
              </div>
            )}

            {isSignUpMode && roleMode === 'EMPLOYEE' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Department</label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className={`${inputClasses} appearance-none cursor-pointer`}
                    >
                      {EMPLOYEE_DEPARTMENT_OPTIONS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Designation</label>
                  <div className="relative">
                    <Briefcase className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <select
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      className={`${inputClasses} appearance-none cursor-pointer`}
                    >
                      <option value="">Select Designation (optional)</option>
                      {EMPLOYEE_DESIGNATION_OPTIONS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {isSignUpMode && roleMode === 'OFFICE' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Office Category <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Users className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <select
                    required
                    value={officeCategory}
                    onChange={(e) => setOfficeCategory(e.target.value as Category)}
                    className={`${inputClasses} appearance-none cursor-pointer`}
                  >
                    <option value="">Select Office Category</option>
                    {OFFICE_CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Your category decides what you can see in the app.</p>
              </div>
            )}

            {isSignUpMode && roleMode === 'MANAGER' && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
                Manager signup creates an <span className="font-bold">HR</span> account. Admin / Boss access can only be given by
                an existing Admin (Users page).
              </p>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAuthErrorMsg(null);
                  }}
                  placeholder="name@company.com"
                  className={inputClasses}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete={isSignUpMode ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthErrorMsg(null);
                  }}
                  placeholder="••••••••"
                  className={inputClasses}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={rememberCredentials}
                onChange={(e) => setRememberCredentials(e.target.checked)}
                className="accent-indigo-600"
              />
              Remember me on this device
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/30 transition-all active:scale-98 cursor-pointer mt-2 disabled:opacity-50"
            >
              <span>
                {isSubmitting
                  ? 'Please wait...'
                  : isSignUpMode
                  ? `Register (${roleMode === 'EMPLOYEE' ? 'Employee' : roleMode === 'OFFICE' ? 'Office' : 'HR'})`
                  : `Sign In to ${PORTAL_TITLES[roleMode]}`}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Unlock key for the Office / Manager tabs (checked again on the server for signup). */}
      {keyModalFor && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl text-indigo-600">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {keyModalFor === 'OFFICE' ? 'Office Access Key' : 'Manager Access Key'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setKeyModalFor(null)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Enter the unlock key to access the {keyModalFor === 'OFFICE' ? 'Office' : 'Manager'} portal.
            </p>

            <form onSubmit={handleKeySubmit} className="space-y-3">
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  autoFocus
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setKeyError(null);
                  }}
                  placeholder="Enter key"
                  className={inputClasses}
                />
              </div>
              {keyError && (
                <p className="text-xs text-rose-500 font-semibold flex items-center space-x-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{keyError}</span>
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
