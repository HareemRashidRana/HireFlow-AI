import type { Permission } from '../../../auth/permissions'
import type { UserRole } from '../../../types/auth'

export const roles: UserRole[] = ['admin', 'hr_manager', 'recruiter', 'employee']

export function validateNewUser(v: { email: string; password: string; role: string }): Record<string, string> {
  const e: Record<string, string> = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Enter a valid email address.'
  if (!v.role) e.role = 'Choose a role.'
  if (v.password.length < 12) e.password = 'Use at least 12 characters.'
  else if (v.password.length > 128) e.password = 'Use at most 128 characters.'
  else if (!v.password.trim()) e.password = 'The password cannot be only spaces.'
  else if (v.email.includes('@') && v.email.split('@')[0].length >= 4 && v.password.toLowerCase().includes(v.email.split('@')[0].toLowerCase()))
    e.password = 'The password must not contain the email address.'
  return e
}

/** What each permission means, in plain words. */
export const permissionLabels: Record<Permission, string> = {
  'users:manage': 'Create and manage user accounts',
  'employees:read': 'Browse the employee directory',
  'employees:write': 'Create and edit employee records',
  'employees:delete': 'Delete employee records',
  'recruitment:read': 'View jobs, candidates and applications',
  'recruitment:write': 'Create and edit jobs, candidates and applications',
  'recruitment:delete': 'Delete draft jobs',
  'candidates:delete': 'Delete candidates',
  'applications:assign': 'Assign any recruiter to an application',
  'privacy:manage': 'Candidate privacy: audit, export, anonymise, retention',
  'privacy:purge': 'Permanently purge expired candidates',
  'resumes:manage': 'Upload, review and use resumes',
  'resumes:delete': 'Delete resume files',
  'screening:use': 'Requirements coverage on applications',
  'interviews:use': 'Schedule interviews and give feedback',
  'analytics:read': 'Recruitment analytics dashboard',
  'workforce:manage': 'Attendance and leave administration, work schedule',
}
