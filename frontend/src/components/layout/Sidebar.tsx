import { useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import { NavLink } from 'react-router-dom'
import { roleLabels } from '../../auth/permissions'
import type { Permission } from '../../auth/permissions'
import { useAuth } from '../../auth/useAuth'
import { useApiHealth } from '../../hooks/useApiHealth'
import type { ApiHealth } from '../../hooks/useApiHealth'
import { Avatar } from '../ui/Avatar'
import {
  BriefcaseIcon,
  ClipboardIcon,
  ContactIcon,
  KanbanIcon,
  KeyIcon,
  LogoutIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from '../ui/icons'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../ui/Toast'
import { Logo } from './Logo'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Shown only to users holding this permission. */
  permission?: Permission
  /** Shown only to users that have an employee record linked to their account. */
  needsEmployeeRecord?: boolean
}

const nav: NavItem[] = [
  { to: '/employees', label: 'Employees', icon: UsersIcon, permission: 'employees:read' },
  { to: '/recruitment/jobs', label: 'Jobs', icon: BriefcaseIcon, permission: 'recruitment:read' },
  { to: '/recruitment/candidates', label: 'Candidates', icon: ContactIcon, permission: 'recruitment:read' },
  { to: '/recruitment/applications', label: 'Applications', icon: ClipboardIcon, permission: 'recruitment:read' },
  { to: '/recruitment/pipeline', label: 'Pipeline', icon: KanbanIcon, permission: 'recruitment:read' },
  { to: '/recruitment/privacy', label: 'Privacy', icon: ShieldIcon, permission: 'privacy:manage' },
  { to: '/profile', label: 'My profile', icon: UserIcon, needsEmployeeRecord: true },
]

const healthUi: Record<ApiHealth, { dot: string; label: string }> = {
  checking: { dot: 'bg-slate-400', label: 'Checking API…' },
  online: { dot: 'bg-emerald-400', label: 'API connected' },
  degraded: { dot: 'bg-amber-400', label: 'Database unreachable' },
  offline: { dot: 'bg-rose-400', label: 'API offline' },
}

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-lavender-500/20 text-white ring-1 ring-lavender-400/30'
      : 'text-slate-300 hover:bg-white/5 hover:text-white'
  }`

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const health = healthUi[useApiHealth()]
  const { user, can, logout } = useAuth()
  const toast = useToast()
  const [signingOut, setSigningOut] = useState(false)

  const items = nav.filter((item) => {
    if (item.permission && !can(item.permission)) return false
    // Employees always get "My profile" (it explains if no record is linked); others only if linked.
    if (item.needsEmployeeRecord && !(user?.employee_id || user?.role === 'employee')) return false
    return true
  })

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await logout() // on success the router sends us to the login page
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out. Please try again.')
      setSigningOut(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-navy-900 px-4 py-6 text-white">
      <div className="px-2">
        <Logo light />
      </div>

      <nav aria-label="Main" className="mt-10 flex-1 space-y-1">
        <p className="px-3 pb-2 text-xs font-medium tracking-wider text-navy-600 uppercase">Manage</p>
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={linkClasses}>
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className="mb-3 rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <Avatar initials={user.email.slice(0, 2).toUpperCase()} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white" title={user.email}>
                {user.email}
              </p>
              <p className="text-xs text-lavender-300">{roleLabels[user.role]}</p>
            </div>
          </div>
          <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
            <NavLink to="/change-password" onClick={onNavigate} className={linkClasses}>
              <KeyIcon className="size-[18px]" />
              Change password
            </NavLink>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
            >
              {signingOut ? <Spinner className="size-[18px]" /> : <LogoutIcon className="size-[18px]" />}
              Sign out
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5 text-xs text-slate-300">
        <span className={`size-2 rounded-full ${health.dot}`} aria-hidden="true" />
        {health.label}
      </div>
    </div>
  )
}
