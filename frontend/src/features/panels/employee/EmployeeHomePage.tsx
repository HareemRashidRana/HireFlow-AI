import { Link } from 'react-router-dom'
import { employeesApi } from '../../../api/employees'
import { attendanceApi, leaveApi } from '../../../api/workforce'
import { useAuth } from '../../../auth/useAuth'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { CheckInCard } from '../../workforce/components/CheckInCard'
import { NotLinked, PageHeader, Stat, StatusPill } from '../../workforce/components/Shared'
import { formatDays, formatDuration, formatRange, monthLabel } from '../../workforce/lib/workforce'
import { useTodayAttendance } from '../../workforce/lib/useTodayAttendance'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/**
 * The employee's own start page. One big button for the thing done every day, then leave, in plain
 * words: how many days are left, what to do to ask for more, and what happened to earlier requests.
 */
export function EmployeeHomePage() {
  const { user } = useAuth()
  const linked = user?.employee_id != null
  const { today, refresh, busy, checkIn, checkOut } = useTodayAttendance(linked)
  const me = useQuery((s) => employeesApi.getMine(s), 'employee-home-me', linked)
  const balances = useQuery((s) => leaveApi.myBalances(undefined, s), `employee-home-balances-${refresh}`, linked)
  const requests = useQuery((s) => leaveApi.mine({ page_size: 4 }, s), `employee-home-requests-${refresh}`, linked)
  const month = today.data?.work_date.slice(0, 7)
  const summary = useQuery((s) => attendanceApi.mySummary(month ?? '', s), `employee-home-month-${month}-${refresh}`, month !== undefined)
  const row = summary.data?.items[0]
  const t = today.data

  return (
    <>
      <PageHeader title={`${greeting()}${me.data ? `, ${me.data.first_name}` : ''}`} subtitle="Everything you need for your working day." />
      {!linked ? (
        <NotLinked />
      ) : (
        <div className="space-y-8">
          <section aria-label="Today">
            {today.error && !t ? (
              <Card><ErrorState title="Couldn't load today" message={today.error.message} onRetry={today.reload} /></Card>
            ) : !t ? (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading your day…</p>
            ) : (
              <CheckInCard large t={t} busy={busy} onCheckIn={() => void checkIn()} onCheckOut={() => void checkOut()} />
            )}
          </section>

          <section aria-label="My leave">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-navy-900">My leave</h2>
              <Link to="/leave/requests" className={buttonClasses('primary', 'md')}>Apply for leave</Link>
            </div>
            {balances.error && !balances.data ? (
              <Card><ErrorState title="Couldn't load your leave" message={balances.error.message} onRetry={balances.reload} /></Card>
            ) : !balances.data ? (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading…</p>
            ) : balances.data.balances.length === 0 ? (
              <p className="text-sm text-slate-500">HR has not set up your leave days yet.</p>
            ) : (
              <dl aria-label="Leave days you can still take" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {balances.data.balances.map((b) => (
                  <Stat key={b.leave_type.id} label={b.leave_type.name} value={formatDays(b.available)} hint={`left of ${formatDays(b.entitlement)} this year`} />
                ))}
              </dl>
            )}
          </section>

          <Card>
            <CardHeader title="My latest leave requests" action={<Link to="/leave/requests" className="text-sm font-medium text-lavender-700 underline">See all</Link>} />
            {requests.error && !requests.data ? (
              <ErrorState title="Couldn't load your requests" message={requests.error.message} onRetry={requests.reload} />
            ) : !requests.data ? (
              <p role="status" className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
            ) : requests.data.items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">You have not asked for leave yet. Choose Apply for leave when you need time off.</p>
            ) : (
              <ul aria-label="My latest leave requests" className="divide-y divide-slate-100">
                {requests.data.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6">
                    <span className="text-sm"><span className="font-medium text-navy-900">{r.leave_type.name}</span> <span className="text-slate-500">{formatRange(r.start_date, r.end_date)} ({formatDays(r.days)})</span></span>
                    <StatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section aria-label="My attendance this month">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-navy-900">{month ? `My attendance in ${monthLabel(month)}` : 'My attendance'}</h2>
              <Link to="/attendance/history" className="text-sm font-medium text-lavender-700 underline">See my attendance history</Link>
            </div>
            {summary.error && !row ? (
              <p role="alert" className="text-sm text-rose-600">Couldn&apos;t load this month. <button type="button" onClick={summary.reload} className="font-medium underline">Retry</button></p>
            ) : row ? (
              <dl aria-label="Attendance this month" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Days I came in" value={row.present_days} />
                <Stat label="Times I was late" value={row.late_days} />
                <Stat label="Days I was absent" value={row.absent_days} />
                <Stat label="Hours worked" value={formatDuration(row.worked_minutes)} />
              </dl>
            ) : (
              <p role="status" className="text-sm text-slate-500">Loading…</p>
            )}
          </section>
        </div>
      )}
    </>
  )
}
