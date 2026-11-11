import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useApiHealth } from '../../hooks/useApiHealth'
import type { ApiHealth } from '../../hooks/useApiHealth'
import { Logo } from './Logo'
import { navFor } from './navigation'

const healthUi: Record<ApiHealth, { dot: string; label: string }> = {
  checking: { dot: 'bg-slate-400', label: 'Checking API…' },
  online: { dot: 'bg-emerald-400', label: 'API connected' },
  degraded: { dot: 'bg-amber-400', label: 'Database unreachable' },
  offline: { dot: 'bg-rose-400', label: 'API offline' },
}

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-lavender-500/20 text-white ring-1 ring-lavender-400/30' : 'text-slate-300 hover:bg-white/5 hover:text-white'
  }`

/**
 * The navigation of the signed-in person's own panel. The list scrolls on its own, so a long menu on
 * a short screen can never push anything out of reach. (Sign out lives in the profile menu in the top
 * bar, which is always on screen.)
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const health = healthUi[useApiHealth()]
  const { user, can } = useAuth()
  if (!user) return null
  const { panel, groups } = navFor(user, can)

  return (
    <div className="flex h-full min-h-0 flex-col bg-navy-900 text-white" data-panel={panel.id}>
      <div className="shrink-0 px-6 pt-6">
        <Logo light />
        <div className="mt-4 rounded-xl bg-white/5 px-3 py-2.5">
          <p className="text-sm font-semibold text-white">{panel.title}</p>
          <p className="text-xs text-lavender-300">{panel.tagline}</p>
        </div>
      </div>

      <nav aria-label="Main" className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {groups.map((g, i) => (
          <div key={g.label ?? i} className="space-y-1">
            {g.label && <p className="px-3 pb-1 text-xs font-medium tracking-wider text-navy-600 uppercase">{g.label}</p>}
            {g.items.map(({ to, label, icon: Icon, prefix }) => (
              <NavLink key={to + label} to={to} end={!prefix} onClick={onNavigate} className={linkClasses}>
                <Icon className="size-5 shrink-0" />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="shrink-0 px-4 pb-4">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5 text-xs text-slate-300">
          <span className={`size-2 rounded-full ${health.dot}`} aria-hidden="true" />
          {health.label}
        </div>
      </div>
    </div>
  )
}
