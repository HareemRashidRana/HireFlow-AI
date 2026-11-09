import { NavLink } from 'react-router-dom'
import { useApiHealth } from '../../hooks/useApiHealth'
import type { ApiHealth } from '../../hooks/useApiHealth'
import { UsersIcon } from '../ui/icons'
import { Logo } from './Logo'

const nav = [{ to: '/employees', label: 'Employees', icon: UsersIcon }]

const healthUi: Record<ApiHealth, { dot: string; label: string }> = {
  checking: { dot: 'bg-slate-400', label: 'Checking API…' },
  online: { dot: 'bg-emerald-400', label: 'API connected' },
  degraded: { dot: 'bg-amber-400', label: 'Database unreachable' },
  offline: { dot: 'bg-rose-400', label: 'API offline' },
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const health = healthUi[useApiHealth()]

  return (
    <div className="flex h-full flex-col bg-navy-900 px-4 py-6 text-white">
      <div className="px-2">
        <Logo light />
      </div>

      <nav aria-label="Main" className="mt-10 flex-1 space-y-1">
        <p className="px-3 pb-2 text-xs font-medium tracking-wider text-navy-600 uppercase">Manage</p>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-lavender-500/20 text-white ring-1 ring-lavender-400/30'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5 text-xs text-slate-300">
        <span className={`size-2 rounded-full ${health.dot}`} aria-hidden="true" />
        {health.label}
      </div>
    </div>
  )
}
