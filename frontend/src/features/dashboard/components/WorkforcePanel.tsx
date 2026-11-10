import { Link } from 'react-router-dom'
import { workforceAnalyticsApi } from '../../../api/workforce'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatDay, monthLabel } from '../../workforce/lib/workforce'
import { niceScale } from '../lib/dashboard'

function Tile({ label, value, hint, to }: { label: string; value: string | number; hint?: string; to?: string }) {
  const body = (
    <>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-navy-900 tabular-nums">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  )
  const cls = 'rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card'
  return to ? (
    <Link to={to} className={`${cls} block hover:border-lavender-300`}>
      <div>{body}</div>
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Today's attendance and leave, from the real attendance and leave records. HR and admin only. */
export function WorkforcePanel() {
  const { data, error, loading, reload } = useQuery((s) => workforceAnalyticsApi.overview(s), 'workforce-overview')
  if (error && !data) {
    return (
      <Card>
        <ErrorState title="Couldn't load attendance and leave" message={error.message} onRetry={reload} />
      </Card>
    )
  }
  if (!data) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="size-4" /> {loading ? 'Loading attendance and leave…' : ''}
      </p>
    )
  }
  const { top } = niceScale(Math.max(...data.leave_trend.map((p) => p.approved_days), 0))
  const anyLeave = data.leave_trend.some((p) => p.approved_days > 0)
  return (
    <section aria-label="Attendance and leave" className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">
          Attendance and leave, {formatDay(data.date)} ({data.timezone})
        </h2>
        {!data.is_working_day && <p role="note" className="mb-3 rounded-xl border border-lavender-200 bg-lavender-50 px-4 py-3 text-sm text-navy-800">Today is not a working day, so nobody is expected.</p>}
        <dl aria-label="Workforce today" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Present today" value={data.present} hint={data.is_working_day ? `of ${data.expected} expected` : 'Not a working day'} to="/attendance/overview" />
          <Tile label="Late arrivals" value={data.late} to="/attendance/manage" />
          <Tile label="On approved leave" value={data.on_leave} to="/leave/calendar" />
          <Tile label="Pending leave requests" value={data.pending_leave_requests} to="/leave/approvals" />
          <Tile
            label="Monthly attendance"
            value={data.attendance_rate === null ? 'n/a' : `${Math.round(data.attendance_rate * 1000) / 10}%`}
            hint={data.attendance_rate === null ? 'No working day has finished yet this month' : 'Finished working days attended, leave excluded'}
          />
        </dl>
      </div>
      <Card>
        <CardHeader title="Approved leave by month" />
        {!anyLeave ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500 sm:px-6">No leave was approved in these months.</p>
        ) : (
          <div className="p-5 sm:p-6">
            <ul aria-label="Approved leave days per month" className="grid grid-cols-6 items-end gap-2" style={{ height: 140 }}>
              {data.leave_trend.map((p) => (
                <li key={p.month} className="flex h-full flex-col items-center justify-end gap-1 text-xs text-slate-600">
                  <span className="font-medium text-navy-900 tabular-nums">{p.approved_days % 1 === 0 ? p.approved_days : p.approved_days.toFixed(1)}</span>
                  <span aria-hidden="true" className="w-full max-w-10 rounded-t-md bg-lavender-500" style={{ height: `${(p.approved_days / top) * 100}%`, minHeight: p.approved_days > 0 ? 3 : 0 }} />
                  <span>{monthLabel(p.month).slice(0, 3)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Working days of approved leave, counted in the month each leave starts. The scale starts at 0.</p>
          </div>
        )}
      </Card>
    </section>
  )
}
