import type { ComponentType, SVGProps } from 'react'
import { BriefcaseIcon, CalendarIcon, ClipboardIcon, ContactIcon, UsersIcon } from '../../../components/ui/icons'
import type { Kpis } from '../../../types/analytics'

interface Card {
  label: string
  value: number
  hint: string
  scope: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

function cards(k: Kpis, period: string): Card[] {
  return [
    { label: 'Employees', value: k.total_employees, hint: `${k.active_employees} active`, scope: 'Right now', icon: UsersIcon },
    { label: 'Candidates', value: k.total_candidates, hint: 'In the talent pool', scope: 'Right now', icon: ContactIcon },
    { label: 'Open jobs', value: k.open_jobs, hint: `${k.closed_jobs} closed`, scope: 'Right now', icon: BriefcaseIcon },
    { label: 'Applications', value: k.total_applications, hint: 'Received in this period', scope: period, icon: ClipboardIcon },
    { label: 'Hires', value: k.hires, hint: 'By hire date', scope: period, icon: UsersIcon },
    { label: 'Upcoming interviews', value: k.upcoming_interviews, hint: `${k.completed_interviews} completed in this period`, scope: 'Right now', icon: CalendarIcon },
  ]
}

/** The headline numbers. Each says whether it is "right now" or for the chosen period. */
export function KpiCards({ kpis, period }: { kpis: Kpis; period: string }) {
  return (
    <dl aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
      {cards(kpis, period).map((c) => (
        <div key={c.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{c.label}</dt>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-lavender-100 text-lavender-600" aria-hidden="true">
              <c.icon className="size-4" />
            </span>
          </div>
          <dd className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 tabular-nums">{c.value.toLocaleString()}</dd>
          <p className="mt-0.5 text-xs text-slate-500">{c.hint}</p>
          <p className="mt-2 text-[11px] font-medium text-lavender-700">{c.scope}</p>
        </div>
      ))}
    </dl>
  )
}

export function KpiSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading key figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-[132px] animate-pulse rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
          <div className="h-3 w-20 rounded bg-slate-100" />
          <div className="mt-4 h-8 w-14 rounded bg-slate-100" />
          <div className="mt-3 h-3 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}
