import { useState } from 'react'
import { Link } from 'react-router-dom'
import { attendanceApi, leaveApi } from '../../../api/workforce'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Input } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { WorkforcePanel } from '../../dashboard/components/WorkforcePanel'
import { PageHeader, Pager, Stat } from '../../workforce/components/Shared'
import { formatDays, formatDuration, formatRange, monthLabel, monthOf } from '../../workforce/lib/workforce'

const actions = [
  { to: '/leave/approvals', label: 'Review leave requests' },
  { to: '/attendance/manage', label: 'Correct or add attendance' },
  { to: '/employees', label: 'Find an employee' },
  { to: '/leave/balances', label: 'Leave balances' },
  { to: '/settings/work', label: 'Work schedule & holidays' },
]

/** HR manager's landing page: how today is going, what is waiting, and the usual next steps. */
export function HrHomePage() {
  const waiting = useQuery((s) => leaveApi.list({ status: 'pending', page_size: 5 }, s), 'hr-home-waiting')
  return (
    <>
      <PageHeader title="HR dashboard" subtitle="Attendance, leave and people at a glance." />
      <div className="space-y-6">
        <WorkforcePanel />
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Waiting for a decision" action={<Link to="/leave/approvals" className="text-sm font-medium text-lavender-700 underline">Review all</Link>} />
            {waiting.error && !waiting.data ? (
              <ErrorState title="Couldn't load requests" message={waiting.error.message} onRetry={waiting.reload} />
            ) : !waiting.data ? (
              <p role="status" className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
            ) : waiting.data.items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">No leave requests are waiting.</p>
            ) : (
              <ul aria-label="Pending leave requests" className="divide-y divide-slate-100">
                {waiting.data.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6">
                    <span className="text-sm"><span className="font-medium text-navy-900">{r.employee.name}</span> <span className="text-slate-500">{r.leave_type.name}, {formatRange(r.start_date, r.end_date)}</span></span>
                    <span className="text-sm text-slate-600">{formatDays(r.days)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Quick actions" />
            <ul aria-label="Quick actions" className="divide-y divide-slate-100">
              {actions.map((a) => (
                <li key={a.to}><Link to={a.to} className="block px-5 py-3 text-sm font-medium text-navy-900 hover:bg-lavender-50/60 sm:px-6">{a.label}</Link></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}

const PAGE_SIZE = 15

/** HR reports: a month of attendance and leave per employee, with company totals. */
export function HrReportsPage() {
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const [page, setPage] = useState(1)
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  const summary = useQuery((s) => attendanceApi.summary({ month, page, page_size: PAGE_SIZE }, s), `hr-report-${month}-${page}`, ok)
  const leave = useQuery((s) => leaveApi.stats(s), 'hr-report-leave')
  const t = summary.data?.totals

  return (
    <>
      <PageHeader
        title="HR reports"
        subtitle="Workforce attendance and leave, by month."
        action={<Link to="/attendance/overview" className={buttonClasses('secondary', 'md')}>Open the daily view</Link>}
      />
      <div className="space-y-6">
        <div className="w-52"><Input label="Month" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1) }} /></div>

        {!ok ? (
          <p role="alert" className="text-sm text-rose-600">Choose a month.</p>
        ) : summary.error && !summary.data ? (
          <Card><ErrorState title="Couldn't load the report" message={summary.error.message} onRetry={summary.reload} /></Card>
        ) : !summary.data || !t ? (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading the report…</p>
        ) : (
          <>
            <dl aria-label={`Totals for ${monthLabel(month)}`} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Days present" value={t.present_days} hint={`${summary.data.working_days_through_today} working days so far, per person`} />
              <Stat label="Late arrivals" value={t.late_days} />
              <Stat label="Left early" value={t.early_days} />
              <Stat label="Absent days" value={t.absent_days} hint="No check-in, no leave" />
              <Stat label="Hours worked" value={formatDuration(t.worked_minutes)} />
            </dl>
            <Card>
              <CardHeader title={`By employee, ${monthLabel(month)}`} />
              {summary.data.items.length === 0 ? (
                <p className="px-5 py-8 text-sm text-slate-500 sm:px-6">There are no active employees to report on.</p>
              ) : (
                <>
                  <ul aria-label="Report by employee" className="divide-y divide-slate-100">
                    {summary.data.items.map((r) => (
                      <li key={r.employee.id} className="grid gap-1 px-5 py-3 sm:px-6 lg:grid-cols-[1.4fr_repeat(5,6rem)] lg:items-center">
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-navy-900">{r.employee.name}</span><span className="block text-xs text-slate-500">{r.employee.department}</span></span>
                        {([['Present', r.present_days], ['Late', r.late_days], ['Leave', r.leave_days], ['Absent', r.absent_days]] as const).map(([k, v]) => (
                          <span key={k} className="text-sm text-slate-600 tabular-nums"><span className="text-xs text-slate-500 lg:sr-only">{k}: </span>{v}</span>
                        ))}
                        <span className="text-sm text-slate-600 tabular-nums"><span className="text-xs text-slate-500 lg:sr-only">Hours: </span>{formatDuration(r.worked_minutes)}</span>
                      </li>
                    ))}
                  </ul>
                  <Pager page={page} total={summary.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
                </>
              )}
            </Card>
          </>
        )}

        <section aria-label="Leave right now">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Leave right now</h2>
          {leave.error && !leave.data ? (
            <p role="alert" className="text-sm text-rose-600">Couldn&apos;t load leave figures. <button type="button" onClick={leave.reload} className="font-medium underline">Retry</button></p>
          ) : leave.data ? (
            <dl aria-label="Leave statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Waiting for a decision" value={leave.data.pending_requests} />
              <Stat label="On leave today" value={leave.data.on_leave_today} />
              <Stat label="Approved days this month" value={formatDays(leave.data.approved_days_this_month)} hint="By start date" />
              <Stat label="Starting in 14 days" value={leave.data.starting_next_14_days} />
            </dl>
          ) : (
            <p role="status" className="text-sm text-slate-500">Loading…</p>
          )}
        </section>
      </div>
    </>
  )
}
