import { Link } from 'react-router-dom'
import { formatDateTime } from '../../../lib/format'
import type { Activity, InterviewBreakdown, SourceCount, TimeToHire } from '../../../types/analytics'
import { eventLabels, formatDays, percentOf, stageLabels, typeLabels } from '../lib/dashboard'

function Bars({ rows, label, color }: { rows: { key: string; label: string; count: number }[]; label: string; color: string }) {
  const total = rows.reduce((n, r) => n + r.count, 0)
  const max = Math.max(...rows.map((r) => r.count), 0)
  return (
    <ul aria-label={label} className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)_5rem]">
          <span className="truncate text-slate-600">{r.label}</span>
          <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <span className={`block h-full rounded-full ${color}`} style={{ width: `${max > 0 ? (r.count / max) * 100 : 0}%` }} />
          </span>
          <span className="text-right font-medium text-navy-900 tabular-nums">
            {r.count}
            <span className="ml-1.5 text-xs font-normal text-slate-500">{percentOf(r.count, total)}%</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

const STATUS_ROWS = [
  ['scheduled', 'Scheduled'],
  ['confirmed', 'Confirmed'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['rescheduled', 'Rescheduled'],
] as const

export function InterviewPanel({ data, upcoming }: { data: InterviewBreakdown; upcoming: number }) {
  const types = Object.entries(data.by_type).map(([k, count]) => ({ key: k, label: typeLabels[k] ?? k, count }))
  const any = STATUS_ROWS.some(([k]) => data[k] > 0)
  return (
    <div className="p-5 sm:p-6">
      <p className="text-sm text-slate-600">
        <span className="text-2xl font-semibold text-navy-900 tabular-nums">{upcoming}</span> upcoming right now
        <span className="text-xs text-slate-500"> (scheduled or confirmed, still to happen)</span>
      </p>
      {!any ? (
        <p className="mt-5 text-sm text-slate-500">No interviews were scheduled in this period.</p>
      ) : (
        <>
          <dl aria-label="Interviews in this period by status" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-3">
            {STATUS_ROWS.map(([k, label]) => (
              <div key={k} className="rounded-xl bg-lavender-50 px-3 py-2">
                <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-navy-900 tabular-nums">{data[k]}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-6 mb-3 text-xs font-medium tracking-wide text-slate-500 uppercase">By type (held or planned)</h3>
          {types.length === 0 ? (
            <p className="text-sm text-slate-500">Every interview in this period was cancelled or moved.</p>
          ) : (
            <Bars rows={types} label="Interviews by type" color="bg-lavender-500" />
          )}
        </>
      )}
    </div>
  )
}

export function SourcePanel({ sources }: { sources: SourceCount[] }) {
  if (sources.length === 0) return <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">No applications in this period, so there are no sources to show.</p>
  return (
    <div className="p-5 sm:p-6">
      <Bars rows={sources.map((s) => ({ key: s.source, label: s.label, count: s.count }))} label="Applications by source" color="bg-navy-700" />
      <p className="mt-4 text-xs text-slate-500">Taken from each application&apos;s recorded source. Nothing is guessed.</p>
    </div>
  )
}

export function TimeToHirePanel({ data }: { data: TimeToHire }) {
  return (
    <div className="p-5 sm:p-6">
      <p className="text-3xl font-semibold tracking-tight text-navy-900 tabular-nums">{formatDays(data.average_days)}</p>
      <p className="mt-1 text-sm text-slate-600">
        {data.hires_measured > 0
          ? `Average from application to hire, across ${data.hires_measured} hire${data.hires_measured === 1 ? '' : 's'} made in this period.`
          : 'No hires were made in this period, so there is nothing to average.'}
      </p>
      {data.hires_without_date > 0 && (
        <p role="note" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {data.hires_without_date} hired application{data.hires_without_date === 1 ? ' has' : 's have'} no recorded hire date, so {data.hires_without_date === 1 ? 'it is' : 'they are'} left out of this average.
        </p>
      )}
    </div>
  )
}

export function RecentActivity({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">No recruitment activity yet.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((a, i) => (
        <li key={`${a.application_id}-${a.at}-${i}`}>
          <Link to={`/recruitment/applications/${a.application_id}`} className="flex flex-wrap items-center justify-between gap-1 px-5 py-3 hover:bg-lavender-50/60 sm:px-6">
            <span className="min-w-0 text-sm text-navy-900">
              {eventLabels[a.event] ?? a.event}
              {a.to_stage && ['stage_changed', 'reopened'].includes(a.event) ? ` ${stageLabels[a.to_stage] ?? a.to_stage}` : ''}
              <span className="text-slate-500"> · {a.job_title}</span>
            </span>
            <time dateTime={a.at} className="text-xs text-slate-500">{formatDateTime(a.at)}</time>
          </Link>
        </li>
      ))}
    </ul>
  )
}
