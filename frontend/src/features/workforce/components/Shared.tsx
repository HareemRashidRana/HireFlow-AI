import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon } from '../../../components/ui/icons'
import type { LeaveStatus } from '../../../types/workforce'
import { statusLabels, statusStyles } from '../lib/workforce'

export interface Tab {
  to: string
  label: string
}

/** Links between the pages of one area (Attendance, Leave). Only tabs the person may use are passed. */
export function SectionTabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1 shadow-card">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            `shrink-0 rounded-xl px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              isActive ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-lavender-50 hover:text-navy-900'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-navy-900 tabular-nums">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6">
      <span>{total} in total</span>
      <span className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeftIcon className="size-4" />
        </Button>
        Page {page} of {pages}
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRightIcon className="size-4" />
        </Button>
      </span>
    </div>
  )
}

export function StatusPill({ status }: { status: LeaveStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}>{statusLabels[status]}</span>
}

export function Flag({ children, tone }: { children: ReactNode; tone: 'amber' | 'rose' | 'lavender' | 'slate' | 'emerald' }) {
  const tones = {
    amber: 'bg-amber-50 text-amber-800',
    rose: 'bg-rose-50 text-rose-700',
    lavender: 'bg-lavender-100 text-lavender-700',
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-700',
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

/** Shown to a login that has no employee record: self-service needs one. */
export function NotLinked() {
  return (
    <Card className="p-6">
      <div role="note" className="flex items-start gap-3 text-sm text-slate-600">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-lavender-600" />
        <p>
          Your account is not linked to an employee record, so there is no personal attendance or leave to show. Ask an administrator
          to link it.
        </p>
      </div>
    </Card>
  )
}

export function Note({ children, tone = 'lavender' }: { children: ReactNode; tone?: 'lavender' | 'amber' | 'rose' }) {
  const tones = { lavender: 'border-lavender-200 bg-lavender-50 text-navy-800', amber: 'border-amber-200 bg-amber-50 text-amber-900', rose: 'border-rose-200 bg-rose-50 text-rose-800' }
  return (
    <p role="note" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </p>
  )
}
