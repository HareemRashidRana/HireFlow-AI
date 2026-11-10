import { Link } from 'react-router-dom'
import { leaveApi } from '../../../api/workforce'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { PageHeader, SectionTabs, Stat, StatusPill } from '../components/Shared'
import { leaveTabs, useAccess } from '../lib/useAccess'
import { formatDays, formatRange } from '../lib/workforce'

/** Leave at a glance: your balances and requests, and for HR what is waiting and who is away. */
export function LeaveDashboardPage() {
  const access = useAccess()
  const balances = useQuery((s) => leaveApi.myBalances(undefined, s), 'leave-dash-balances', access.hasRecord)
  const mine = useQuery((s) => leaveApi.mine({ page_size: 5 }, s), 'leave-dash-mine', access.hasRecord)
  const stats = useQuery((s) => leaveApi.stats(s), 'leave-dash-stats', access.isHr)
  const waiting = useQuery((s) => leaveApi.list({ status: 'pending', page_size: 5 }, s), 'leave-dash-waiting', access.isHr)

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle="Balances, requests and approvals in one place."
        action={access.hasRecord ? <Link to="/leave/requests" className={buttonClasses('primary', 'md')}>Request leave</Link> : undefined}
      />
      <SectionTabs label="Leave" tabs={leaveTabs(access)} />
      <div className="space-y-6">
        {access.isHr && (
          <section aria-label="For HR">
            {stats.error && !stats.data ? (
              <Card><ErrorState title="Couldn't load leave figures" message={stats.error.message} onRetry={stats.reload} /></Card>
            ) : stats.data ? (
              <dl aria-label="Leave statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Waiting for a decision" value={stats.data.pending_requests} />
                <Stat label="On leave today" value={stats.data.on_leave_today} />
                <Stat label="Approved days this month" value={formatDays(stats.data.approved_days_this_month)} hint="By start date" />
                <Stat label="Starting in 14 days" value={stats.data.starting_next_14_days} />
              </dl>
            ) : (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading…</p>
            )}
            <Card className="mt-6">
              <CardHeader title="Waiting for a decision" action={<Link to="/leave/approvals" className="text-sm font-medium text-lavender-700 underline">Review all</Link>} />
              {waiting.error && !waiting.data ? (
                <ErrorState title="Couldn't load requests" message={waiting.error.message} onRetry={waiting.reload} />
              ) : waiting.data && waiting.data.items.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">Nothing is waiting.</p>
              ) : (
                <ul aria-label="Pending requests" className="divide-y divide-slate-100">
                  {waiting.data?.items.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6">
                      <span className="text-sm"><span className="font-medium text-navy-900">{r.employee.name}</span> <span className="text-slate-500">{r.leave_type.name}, {formatRange(r.start_date, r.end_date)}</span></span>
                      <span className="text-sm text-slate-600">{formatDays(r.days)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        )}

        {access.hasRecord && (
          <>
            <Card>
              <CardHeader title={`Your balances${balances.data ? `, ${balances.data.year}` : ''}`} action={<Link to="/leave/balances" className="text-sm font-medium text-lavender-700 underline">Details</Link>} />
              {balances.error && !balances.data ? (
                <ErrorState title="Couldn't load your balances" message={balances.error.message} onRetry={balances.reload} />
              ) : !balances.data ? (
                <p role="status" className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
              ) : balances.data.balances.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">No leave types have a balance yet.</p>
              ) : (
                <dl aria-label="Your balances" className="grid grid-cols-2 gap-3 p-5 sm:p-6 lg:grid-cols-3">
                  {balances.data.balances.map((b) => (
                    <Stat key={b.leave_type.id} label={b.leave_type.name} value={formatDays(b.available)} hint={`${formatDays(b.used)} used of ${formatDays(b.entitlement)}${b.pending ? `, ${formatDays(b.pending)} pending` : ''}`} />
                  ))}
                </dl>
              )}
            </Card>
            <Card>
              <CardHeader title="Your latest requests" action={<Link to="/leave/requests" className="text-sm font-medium text-lavender-700 underline">All requests</Link>} />
              {mine.error && !mine.data ? (
                <ErrorState title="Couldn't load your requests" message={mine.error.message} onRetry={mine.reload} />
              ) : mine.data && mine.data.items.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">You have not asked for leave yet.</p>
              ) : (
                <ul aria-label="Your latest requests" className="divide-y divide-slate-100">
                  {mine.data?.items.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6">
                      <span className="text-sm"><span className="font-medium text-navy-900">{r.leave_type.name}</span> <span className="text-slate-500">{formatRange(r.start_date, r.end_date)} ({formatDays(r.days)})</span></span>
                      <StatusPill status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
        {!access.hasRecord && !access.isHr && (
          <Card className="p-6"><p className="text-sm text-slate-600">Your account is not linked to an employee record, so there is no personal leave to show. Ask an administrator to link it.</p></Card>
        )}
      </div>
    </>
  )
}
