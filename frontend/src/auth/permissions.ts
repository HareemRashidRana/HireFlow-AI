import type { AuthUser, UserRole } from '../types/auth'

/**
 * What each role may do. This MIRRORS the rules enforced by the backend (app/api/v1/employees.py
 * and users.py). It only decides what the UI shows: the server is the authority and re-checks every
 * request, so hiding a button is a convenience, never a security control.
 */
export type Permission =
  | 'employees:read'
  | 'employees:write'
  | 'employees:delete'
  | 'users:manage'
  | 'recruitment:read'
  | 'recruitment:write'
  | 'recruitment:delete'
  | 'candidates:delete'
  | 'applications:assign'
  | 'privacy:manage'
  | 'privacy:purge'
  | 'resumes:manage'
  | 'resumes:delete'
  | 'screening:use'
  | 'interviews:use'
  | 'analytics:read'
  | 'workforce:manage'

export const GRANTS: Record<Permission, readonly UserRole[]> = {
  'employees:read': ['admin', 'hr_manager', 'recruiter'], // browse the whole directory
  'employees:write': ['admin', 'hr_manager'], // create and edit
  'employees:delete': ['admin'],
  'users:manage': ['admin'],
  'recruitment:read': ['admin', 'hr_manager', 'recruiter'], // view jobs
  'recruitment:write': ['admin', 'hr_manager', 'recruiter'], // create, edit, change job status
  'recruitment:delete': ['admin'], // delete draft jobs
  // Candidates use recruitment:read / recruitment:write for viewing and editing. Deleting one is
  // wider than deleting a job (HR handles data corrections) but still not open to recruiters.
  'candidates:delete': ['admin', 'hr_manager'],
  // Applications use recruitment:read / recruitment:write. Assigning ANY recruiter is HR / admin
  // only (a recruiter can only take an application for themselves). Hiring and reopening are also
  // HR / admin only, but the server tells the UI per application what is allowed, so no permission
  // is needed for them here.
  'applications:assign': ['admin', 'hr_manager'],
  // Candidate privacy: retention review, audit trail, export, anonymize and PREVIEWING a purge.
  // Recruiters get none of it. Actually deleting expired candidates is administrators only (and the
  // server also needs PRIVACY_PURGE_ENABLED). The API enforces all of this; this just shapes the UI.
  'privacy:manage': ['admin', 'hr_manager'],
  'privacy:purge': ['admin'],
  // Resumes: view, download, upload, re-read, review and make active for recruitment staff.
  // Deleting a resume file is HR / admin only. Employees get nothing. The API enforces all of it.
  'resumes:manage': ['admin', 'hr_manager', 'recruiter'],
  'resumes:delete': ['admin', 'hr_manager'],
  // Requirements Coverage: create, view and review. Employees get nothing; nobody can edit or delete
  // an assessment (the API has no such operation).
  'screening:use': ['admin', 'hr_manager', 'recruiter'],
  // Interviews: schedule, view, change and give feedback. Employees get nothing. Feedback is further
  // limited by the server (only an assigned interviewer writes it; HR and admins read submitted feedback).
  'interviews:use': ['admin', 'hr_manager', 'recruiter'],
  // Recruitment analytics and the dashboard: aggregate counts only. Employees get nothing; the API enforces it.
  'analytics:read': ['admin', 'hr_manager', 'recruiter'],
  // Attendance and leave administration: see everyone's attendance, correct it, decide leave, grant
  // balances, set the working rules. Self-service (own attendance, own leave) needs only a linked
  // employee record, so it is not a role permission. The API enforces all of it.
  'workforce:manage': ['admin', 'hr_manager'],
}

export function can(user: AuthUser | null, permission: Permission): boolean {
  return user !== null && GRANTS[permission].includes(user.role)
}

export const roleLabels: Record<UserRole, string> = {
  admin: 'Administrator',
  hr_manager: 'HR Manager',
  recruiter: 'Recruiter',
  employee: 'Employee',
}

/** Each role has its own landing page: its own panel. */
export const roleHomes: Record<UserRole, string> = {
  admin: '/admin',
  hr_manager: '/hr',
  recruiter: '/recruiter',
  employee: '/employee',
}

/** Where a signed-in user lands. */
export function homePath(user: AuthUser): string {
  return roleHomes[user.role]
}

interface RouteRule {
  pattern: RegExp
  roles?: readonly UserRole[]
  permission?: Permission
}

/**
 * Pages that only some people may open. This MIRRORS the guards in App.tsx (a test reads App.tsx and
 * fails if the two disagree); it exists so that, after signing in, we never send someone to a page
 * their role cannot open. The route guards and the server still enforce access: this only decides
 * where to land. First match wins, so specific patterns come before general ones.
 */
export const ROUTE_RULES: readonly RouteRule[] = [
  { pattern: /^\/dashboard$/, permission: 'analytics:read' },
  { pattern: /^\/attendance\/(overview|manage)$/, permission: 'workforce:manage' },
  { pattern: /^\/leave\/approvals$/, permission: 'workforce:manage' },
  { pattern: /^\/settings\/work$/, permission: 'workforce:manage' },
  { pattern: /^\/admin$/, roles: ['admin'] },
  { pattern: /^\/admin\/(users|roles)$/, permission: 'users:manage' },
  { pattern: /^\/admin\/settings$/, permission: 'workforce:manage' },
  { pattern: /^\/hr(\/reports)?$/, roles: ['hr_manager'] },
  { pattern: /^\/recruiter$/, roles: ['recruiter'] },
  { pattern: /^\/employee$/, roles: ['employee'] },
  { pattern: /^\/employees$/, permission: 'employees:read' },
  { pattern: /^\/employees\/new$/, permission: 'employees:write' },
  { pattern: /^\/employees\/[^/]+\/edit$/, permission: 'employees:write' },
  { pattern: /^\/recruitment\/interviews(\/[^/]+)?$/, permission: 'interviews:use' },
  { pattern: /^\/recruitment\/(jobs|candidates|applications)\/new$/, permission: 'recruitment:write' },
  { pattern: /^\/recruitment\/(jobs|candidates)\/[^/]+\/edit$/, permission: 'recruitment:write' },
  { pattern: /^\/recruitment\/(jobs|candidates|applications)(\/[^/]+)?$/, permission: 'recruitment:read' },
  { pattern: /^\/recruitment\/pipeline$/, permission: 'recruitment:read' },
  { pattern: /^\/recruitment\/privacy$/, permission: 'privacy:manage' },
]

/** Whether this person may open `path`. Pages with no rule are open to every signed-in user. */
export function canOpenPath(user: AuthUser, path: string): boolean {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  const rule = ROUTE_RULES.find((r) => r.pattern.test(clean))
  if (!rule) return true
  if (rule.roles && !rule.roles.includes(user.role)) return false
  if (rule.permission && !can(user, rule.permission)) return false
  return true
}

/**
 * Where to send someone right after they sign in. A page they were heading to is honoured only if
 * their role can actually open it; otherwise (for example another role's dashboard) they land on
 * their own home, never on an access-denied page.
 */
export function landingPath(user: AuthUser, requested: unknown): string {
  const from = safeInternalPath(requested)
  return from !== null && canOpenPath(user, from) ? from : homePath(user)
}

/** Only follow in-app paths ("/employees"), never "//evil.com" or "https://...". */
export function safeInternalPath(path: unknown): string | null {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : null
}
