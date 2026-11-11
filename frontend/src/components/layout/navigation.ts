import type { ComponentType, SVGProps } from 'react'
import { roleHomes } from '../../auth/permissions'
import type { Permission } from '../../auth/permissions'
import type { AuthUser, UserRole } from '../../types/auth'
import {
  BriefcaseIcon,
  CalendarIcon,
  ChartIcon,
  ClipboardIcon,
  ClockIcon,
  ContactIcon,
  HomeIcon,
  KanbanIcon,
  ShieldIcon,
  SlidersIcon,
  SunIcon,
  UserIcon,
  UsersIcon,
} from '../ui/icons'

/**
 * The four panels. Each role gets its OWN navigation and landing page; nothing from another role's
 * work area is listed. This only decides what is shown: the server still checks every request, and
 * the route guards still check the same permissions, so hiding a link never grants or removes access.
 */
export interface NavItem {
  to: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Shown only to people holding this permission. */
  requires?: Permission
  /** Also lit on deeper pages (a job's detail page keeps "Job postings" lit). Default: exact match. */
  prefix?: boolean
}

export interface NavGroup {
  label?: string
  /** Only for people whose login is linked to an employee record (their own attendance and leave). */
  needsRecord?: boolean
  items: NavItem[]
}

export interface Panel {
  id: 'admin' | 'hr' | 'recruiter' | 'employee'
  title: string
  tagline: string
  home: string
  groups: NavGroup[]
}

const myWork: NavGroup = {
  label: 'My work',
  needsRecord: true,
  items: [
    { to: '/attendance', label: 'My attendance', icon: ClockIcon },
    { to: '/leave/requests', label: 'My leave', icon: SunIcon },
    { to: '/profile', label: 'My profile', icon: UserIcon },
  ],
}

export const panels: Record<UserRole, Panel> = {
  admin: {
    id: 'admin',
    title: 'Admin Console',
    tagline: 'Accounts, roles and company settings',
    home: roleHomes.admin,
    groups: [
      { items: [{ to: '/admin', label: 'System overview', icon: HomeIcon }] },
      {
        label: 'Administration',
        items: [
          { to: '/admin/users', label: 'Users & accounts', icon: UsersIcon, requires: 'users:manage', prefix: true },
          { to: '/admin/roles', label: 'Roles & permissions', icon: ShieldIcon, requires: 'users:manage' },
          { to: '/admin/settings', label: 'Company settings', icon: SlidersIcon, requires: 'workforce:manage' },
          { to: '/recruitment/privacy', label: 'Data privacy', icon: ShieldIcon, requires: 'privacy:manage', prefix: true },
        ],
      },
      { label: 'People', items: [{ to: '/employees', label: 'Employees', icon: UsersIcon, requires: 'employees:read', prefix: true }] },
      {
        label: 'Attendance & leave',
        items: [
          { to: '/attendance/overview', label: 'Today & month', icon: ClockIcon, requires: 'workforce:manage' },
          { to: '/attendance/manage', label: 'Records & corrections', icon: ClipboardIcon, requires: 'workforce:manage' },
          { to: '/leave/approvals', label: 'Leave approvals', icon: SunIcon, requires: 'workforce:manage' },
          { to: '/leave/balances', label: 'Leave balances', icon: ClipboardIcon, requires: 'workforce:manage' },
          { to: '/leave/calendar', label: 'Leave calendar', icon: CalendarIcon, requires: 'workforce:manage' },
        ],
      },
      {
        label: 'Recruitment',
        items: [
          { to: '/recruitment/jobs', label: 'Job postings', icon: BriefcaseIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/candidates', label: 'Candidates & resumes', icon: ContactIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/applications', label: 'Applications', icon: ClipboardIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/pipeline', label: 'Hiring pipeline', icon: KanbanIcon, requires: 'recruitment:read' },
          { to: '/recruitment/interviews', label: 'Interviews', icon: CalendarIcon, requires: 'interviews:use', prefix: true },
        ],
      },
      { label: 'Reports', items: [{ to: '/dashboard', label: 'System reports', icon: ChartIcon, requires: 'analytics:read' }] },
      myWork,
    ],
  },
  hr_manager: {
    id: 'hr',
    title: 'HR Workspace',
    tagline: 'People, attendance and leave',
    home: roleHomes.hr_manager,
    groups: [
      { items: [{ to: '/hr', label: 'HR dashboard', icon: HomeIcon }] },
      { label: 'People', items: [{ to: '/employees', label: 'Employees', icon: UsersIcon, requires: 'employees:read', prefix: true }] },
      {
        label: 'Attendance',
        items: [
          { to: '/attendance/overview', label: 'Today & month', icon: ClockIcon, requires: 'workforce:manage' },
          { to: '/attendance/manage', label: 'Records & corrections', icon: ClipboardIcon, requires: 'workforce:manage' },
        ],
      },
      {
        label: 'Leave',
        items: [
          { to: '/leave/approvals', label: 'Approvals', icon: SunIcon, requires: 'workforce:manage' },
          { to: '/leave/balances', label: 'Balances', icon: ClipboardIcon, requires: 'workforce:manage' },
          { to: '/leave/calendar', label: 'Leave calendar', icon: CalendarIcon, requires: 'workforce:manage' },
        ],
      },
      {
        label: 'Configuration',
        items: [
          { to: '/settings/work', label: 'Work schedule & holidays', icon: SlidersIcon, requires: 'workforce:manage' },
          { to: '/recruitment/privacy', label: 'Data privacy', icon: ShieldIcon, requires: 'privacy:manage', prefix: true },
        ],
      },
      {
        label: 'Recruitment',
        items: [
          { to: '/recruitment/jobs', label: 'Job postings', icon: BriefcaseIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/candidates', label: 'Candidates & resumes', icon: ContactIcon, requires: 'recruitment:read', prefix: true },
          // Only HR and admin may mark someone as hired, so that decision keeps its own entry point.
          { to: '/recruitment/pipeline', label: 'Hiring decisions', icon: KanbanIcon, requires: 'recruitment:read' },
          { to: '/recruitment/interviews', label: 'Interviews', icon: CalendarIcon, requires: 'interviews:use', prefix: true },
        ],
      },
      {
        label: 'Reports',
        items: [
          { to: '/hr/reports', label: 'HR reports', icon: ChartIcon, requires: 'workforce:manage' },
          { to: '/dashboard', label: 'Recruitment analytics', icon: ChartIcon, requires: 'analytics:read' },
        ],
      },
      myWork,
    ],
  },
  recruiter: {
    id: 'recruiter',
    title: 'Recruiting',
    tagline: 'Jobs, candidates and hiring',
    home: roleHomes.recruiter,
    groups: [
      { items: [{ to: '/recruiter', label: 'Recruitment dashboard', icon: HomeIcon }] },
      {
        label: 'Hiring',
        items: [
          { to: '/recruitment/jobs', label: 'Job postings', icon: BriefcaseIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/candidates', label: 'Candidates & resumes', icon: ContactIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/applications', label: 'Applications', icon: ClipboardIcon, requires: 'recruitment:read', prefix: true },
          { to: '/recruitment/pipeline', label: 'Hiring pipeline', icon: KanbanIcon, requires: 'recruitment:read' },
          { to: '/recruitment/interviews', label: 'Interviews', icon: CalendarIcon, requires: 'interviews:use', prefix: true },
        ],
      },
      { label: 'Insights', items: [{ to: '/dashboard', label: 'Recruitment analytics', icon: ChartIcon, requires: 'analytics:read' }] },
      myWork,
    ],
  },
  employee: {
    id: 'employee',
    title: 'My Portal',
    tagline: 'Your day, your leave, your details',
    home: roleHomes.employee,
    groups: [
      {
        items: [
          { to: '/employee', label: 'Home', icon: HomeIcon },
          { to: '/attendance', label: 'Attendance', icon: ClockIcon, prefix: true },
          { to: '/leave', label: 'Leave', icon: SunIcon, prefix: true },
          { to: '/profile', label: 'My profile', icon: UserIcon },
        ],
      },
    ],
  },
}

export const panelFor = (role: UserRole): Panel => panels[role]

/** The navigation this person should see: their panel's groups, minus anything they may not use. */
export function navFor(user: AuthUser, can: (permission: Permission) => boolean): { panel: Panel; groups: NavGroup[] } {
  const panel = panelFor(user.role)
  const linked = user.employee_id !== null
  const groups = panel.groups
    .filter((g) => !g.needsRecord || linked)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || can(i.requires)) }))
    .filter((g) => g.items.length > 0)
  return { panel, groups }
}
