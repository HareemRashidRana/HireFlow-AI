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

const GRANTS: Record<Permission, readonly UserRole[]> = {
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

/** Where a signed-in user lands: staff see the directory, employees see their own record. */
export function homePath(user: AuthUser): string {
  return can(user, 'employees:read') ? '/employees' : '/profile'
}

/** Only follow in-app paths ("/employees"), never "//evil.com" or "https://...". */
export function safeInternalPath(path: unknown): string | null {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : null
}
