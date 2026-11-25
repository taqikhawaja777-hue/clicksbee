/**
 * THE permission table. Every role-based decision in the backend (route
 * guards and per-row data scoping) goes through this file, so the rules in
 * one place match what the desktop app shows.
 *
 * Signup categories:
 *   Employee  - sales employees (EMPLOYEE): unchanged from before.
 *   Office    - SM, TEAM_LEAD, BACK_OFFICE, VALIDATOR, CLOSER (key-protected).
 *   Manager   - ADMIN (= Boss, full access) and HR (key-protected; only HR can
 *               be self-created - Admin is granted by an existing Admin).
 */

export const CATEGORIES = [
  'ADMIN',
  'HR',
  'SM',
  'TEAM_LEAD',
  'BACK_OFFICE',
  'VALIDATOR',
  'CLOSER',
  'EMPLOYEE',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const OFFICE_CATEGORIES: Category[] = ['SM', 'TEAM_LEAD', 'BACK_OFFICE', 'VALIDATOR', 'CLOSER'];
/** Tracked automatically from Windows sign-in, all day, without check-in. */
export const AUTO_TRACKED_CATEGORIES: Category[] = ['TEAM_LEAD', 'BACK_OFFICE', 'VALIDATOR', 'CLOSER'];
/**
 * No check-in / check-out and no duty hours: attendance is recorded
 * automatically when they sign in, at any time of day.
 */
export const FLEXIBLE_HOURS_CATEGORIES: Category[] = ['BACK_OFFICE', 'VALIDATOR'];

export function hasFlexibleHours(user: Pick<AccessUser, 'role' | 'designation' | 'officeCategory'>): boolean {
  return FLEXIBLE_HOURS_CATEGORIES.includes(categoryOf(user));
}

/** People whose call/productivity data SM and Admin review ("agents"). */
export const AGENT_CATEGORIES: Category[] = ['CLOSER', 'EMPLOYEE', 'TEAM_LEAD'];

export const CATEGORY_LABELS: Record<Category, string> = {
  ADMIN: 'Admin / Boss',
  HR: 'HR',
  SM: 'SM (Sales Manager)',
  TEAM_LEAD: 'Team Lead',
  BACK_OFFICE: 'Back Office',
  VALIDATOR: 'Validator',
  CLOSER: 'Closer',
  EMPLOYEE: 'Employee (Sales)',
};

export interface AccessUser {
  id: string;
  role: string;
  designation?: string | null;
  officeCategory?: string | null;
  managerId?: string | null;
  organizationId?: string;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * The user's category. Accounts created before categories existed have no
 * officeCategory - derived from their role + designation so they keep
 * working without a migration (Admin can change it on the Users page).
 */
export function categoryOf(user: Pick<AccessUser, 'role' | 'designation' | 'officeCategory'>): Category {
  if (isCategory(user.officeCategory)) return user.officeCategory;
  const designation = (user.designation || '').trim().toLowerCase();
  if (designation === 'hr') return 'HR';
  if (designation === 'sm') return 'SM';
  if (designation === 'team lead') return 'TEAM_LEAD';
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return 'ADMIN';
  return 'EMPLOYEE';
}

/** Backend Role + designation stored for a category (keeps older code paths consistent). */
export function storageFor(category: Category): { role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'; designation: string | null } {
  switch (category) {
    case 'ADMIN':
      return { role: 'ADMIN', designation: null };
    case 'HR':
      return { role: 'MANAGER', designation: 'HR' };
    case 'SM':
      return { role: 'EMPLOYEE', designation: 'SM' };
    case 'TEAM_LEAD':
      return { role: 'EMPLOYEE', designation: 'Team Lead' };
    case 'CLOSER':
      return { role: 'EMPLOYEE', designation: 'Closer' };
    case 'BACK_OFFICE':
      return { role: 'EMPLOYEE', designation: 'Back Office' };
    case 'VALIDATOR':
      return { role: 'EMPLOYEE', designation: 'Validator' };
    default:
      return { role: 'EMPLOYEE', designation: null };
  }
}

export type Permission =
  /** Screenshot gallery, files and the screenshot report. */
  | 'screenshots.view'
  /** Live Monitor (AI analysis of the employee's screen). */
  | 'liveMonitor.view'
  /** Employee camera presence view (Idle Time page camera card). */
  | 'camera.view'
  /** Recruitment module. */
  | 'candidates.manage'
  /** Users page: change anyone's category / Team Lead / Admin rights. */
  | 'users.manage'
  /** The existing Manager-portal pages and APIs (employees, attendance, tasks for anyone, logs, settings). */
  | 'managerPortal'
  /** Assign spreadsheets (lead lists) to anyone. */
  | 'leads.assignAny'
  /** Assign spreadsheets (lead lists) / tasks to the Team Lead's own agents. */
  | 'leads.assignTeam'
  /** Active/idle/productivity of every agent. */
  | 'productivity.all'
  /** Active/idle/productivity of the Team Lead's own agents. */
  | 'productivity.team'
  /** Dialer timings (Jabber/3CX/Yeastar, calls). */
  | 'dialer.reports'
  /** Full-day app/window activity logs - scope decided by canViewActivityLog(). */
  | 'activityLogs.view'
  /** Login / check-in records (Logs page) - SM is limited to login actions. */
  | 'loginRecords.view'
  /** Attendance report. */
  | 'attendance.reports'
  /** Organization settings (screenshot destination, camera, unproductive apps). */
  | 'org.settings';

const MATRIX: Record<Permission, Category[]> = {
  'screenshots.view': ['ADMIN'],
  'liveMonitor.view': ['ADMIN'],
  'camera.view': ['ADMIN'],
  'candidates.manage': ['ADMIN', 'HR'],
  'users.manage': ['ADMIN'],
  managerPortal: ['ADMIN', 'HR'],
  'leads.assignAny': ['ADMIN'],
  'leads.assignTeam': ['TEAM_LEAD'],
  'productivity.all': ['ADMIN', 'SM'],
  'productivity.team': ['TEAM_LEAD'],
  'dialer.reports': ['ADMIN', 'SM'],
  'activityLogs.view': ['ADMIN', 'SM', 'TEAM_LEAD'],
  'loginRecords.view': ['ADMIN', 'HR', 'SM'],
  'attendance.reports': ['ADMIN', 'HR', 'SM'],
  'org.settings': ['ADMIN'],
};

export function can(user: Pick<AccessUser, 'role' | 'designation' | 'officeCategory'>, permission: Permission): boolean {
  return MATRIX[permission].includes(categoryOf(user));
}

/** Every permission a user has - sent to the desktop app to build the menu. */
export function permissionsOf(user: Pick<AccessUser, 'role' | 'designation' | 'officeCategory'>): Permission[] {
  const category = categoryOf(user);
  return (Object.keys(MATRIX) as Permission[]).filter((p) => MATRIX[p].includes(category));
}

export interface AccessTarget {
  id: string;
  role: string;
  designation?: string | null;
  officeCategory?: string | null;
  managerId?: string | null;
}

/** Is `target` one of this Team Lead's own agents? */
export function isOwnAgent(viewer: Pick<AccessUser, 'id'>, target: Pick<AccessTarget, 'managerId'>): boolean {
  return !!target.managerId && target.managerId === viewer.id;
}

/**
 * Full-day activity logs:
 *   Admin/Boss - everyone (incl. Back Office and Validator).
 *   SM         - all Team Leads and Closers.
 *   Team Lead  - their own agents.
 */
export function canViewActivityLog(viewer: AccessUser, target: AccessTarget): boolean {
  const viewerCategory = categoryOf(viewer);
  if (viewerCategory === 'ADMIN') return true;
  const targetCategory = categoryOf(target);
  if (viewerCategory === 'SM') return targetCategory === 'TEAM_LEAD' || targetCategory === 'CLOSER';
  if (viewerCategory === 'TEAM_LEAD') return isOwnAgent(viewer, target);
  return false;
}

/**
 * Agent productivity / idle (Idle Time, team view, shift summaries):
 *   Admin/Boss and SM - all agents; Team Lead - own agents; everyone - themselves.
 */
export function canViewProductivityOf(viewer: AccessUser, target: AccessTarget): boolean {
  if (viewer.id === target.id) return true;
  if (can(viewer, 'productivity.all')) return true;
  if (can(viewer, 'productivity.team')) return isOwnAgent(viewer, target);
  return false;
}

/** Fields removed from report rows for viewers without dialer.reports / productivity rights. */
export const DIALER_FIELDS = [
  'jabberSeconds',
  'threeCxSeconds',
  'yeastarSeconds',
  'callSeconds',
  'callCount',
  'dialingSeconds',
  'longestNoCallGapSeconds',
] as const;
export const PRODUCTIVITY_FIELDS = [
  'productivityPercentage',
  'activeSeconds',
  'idleSeconds',
  'otherWorkSeconds',
  'unproductiveSeconds',
  'spreadsheetSeconds',
  'suspiciousSeconds',
  'activityState',
] as const;

export function redactRow<T extends Record<string, any>>(
  row: T,
  options: { dialer: boolean; productivity: boolean },
): T {
  const copy: Record<string, any> = { ...row };
  if (!options.dialer) for (const f of DIALER_FIELDS) delete copy[f];
  if (!options.productivity) for (const f of PRODUCTIVITY_FIELDS) delete copy[f];
  return copy as T;
}
