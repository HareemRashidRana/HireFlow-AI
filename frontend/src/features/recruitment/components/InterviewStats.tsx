import { interviewsApi } from '../../../api/interviews'
import { useQuery } from '../../../hooks/useQuery'
import { dayLabel } from '../lib/interviews'

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-navy-900">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/** Real counts from the database. Nothing here is a score or a ranking of people. */
export function InterviewStats({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useQuery((s) => interviewsApi.stats(s), `interview-stats-${refreshKey}`)
  if (loading && !data)
    return (
      <div aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    )
  if (error && !data)
    return (
      <p role="alert" className="text-sm text-rose-600">
        Couldn't load the interview numbers.{' '}
        <button type="button" onClick={reload} className="font-medium underline">
          Retry
        </button>
      </p>
    )
  if (!data) return null
  const s = data.by_status
  return (
    <section aria-label="Interview statistics">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Upcoming" value={data.upcoming} hint={`${data.next_7_days} in the next 7 days`} />
        <Tile label="Scheduled" value={s.scheduled} hint={`${s.confirmed} confirmed`} />
        <Tile label="Completed" value={s.completed} />
        <Tile label="Cancelled" value={s.cancelled} hint={`${s.rescheduled} rescheduled`} />
        <Tile label="Feedback pending" value={data.feedback_pending} hint="interviewers still to submit" />
        <Tile label="Feedback submitted" value={data.feedback_submitted} />
      </dl>
      {data.upcoming_by_day.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Next 14 days:{' '}
          {data.upcoming_by_day.map((d) => `${dayLabel(d.date)} (${d.count})`).join(' · ')}
        </p>
      )}
    </section>
  )
}
