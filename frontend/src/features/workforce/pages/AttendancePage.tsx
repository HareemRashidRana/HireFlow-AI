import { attendanceApi } from '../../../api/workforce'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import type { AttendanceRecord } from '../../../types/workforce'
import { CheckInCard } from '../components/CheckInCard'
import { Flag, NotLinked, PageHeader, SectionTabs, Stat } from '../components/Shared'
import { formatClock, formatDay, formatDuration, monthLabel } from '../lib/workforce'
import { attendanceTabs, useAccess } from '../lib/useAccess'
import { useTodayAttendance } from '../lib/useTodayAttendance'

function RecentRow({ r }: { r: AttendanceRecord }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6">
      <span className="text-sm font-medium text-navy-900">{formatDay(r.work_date)}</span>
      <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {formatClock(r.check_in_at, r.timezone)} to {r.check_out_at ? formatClock(r.check_out_at, r.timezone) : 'still in'}
        <span className="tabular-nums">{r.worked_minutes !== null ? formatDuration(r.worked_minutes) : ''}</span>
        {r.is_late && <Flag tone="amber">Late</Flag>}
        {r.left_early && <Flag tone="rose">Left early</Flag>}
        {r.corrected && <Flag tone="lavender">Corrected by HR</Flag>}
      </span>
    </li>
  )
}

export function AttendancePage() {
  const access = useAccess()
  const { today, refresh, busy, checkIn, checkOut } = useTodayAttendance(access.hasRecord)
  const month = today.data?.work_date.slice(0, 7)
  const summary = useQuery((s) => attendanceApi.mySummary(month ?? '', s), `att-summary-${month}-${refresh}`, month !== undefined)
  const recent = useQuery((s) => attendanceApi.mine({ page_size: 7 }, s), `att-recent-${refresh}`, access.hasRecord)
  const t = today.data

  return (
    <>
      <PageHeader title="Attendance" subtitle="Check in when you start and check out when you finish. Your hours are recorded from the server's clock." />
      <SectionTabs label="Attendance" tabs={attendanceTabs(access)} />
      {!access.hasRecord ? (
        <NotLinked />
      ) : today.error && !t ? (
        <Card>
          <ErrorState title="Couldn't load your attendance" message={today.error.message} onRetry={today.reload} />
        </Card>
      ) : !t ? (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="size-4" /> Loading your attendance…
        </p>
      ) : (
        <div className="space-y-6">
          <CheckInCard t={t} busy={busy} onCheckIn={() => void checkIn()} onCheckOut={() => void checkOut()} />

          <section aria-label="This month">
            <h2 className="mb-3 text-sm font-semibold text-navy-900">{month ? monthLabel(month) : 'This month'}</h2>
            {summary.error && !summary.data ? (
              <p role="alert" className="text-sm text-rose-600">
                Couldn&apos;t load the month. <button type="button" onClick={summary.reload} className="font-medium underline">Retry</button>
              </p>
            ) : summary.data?.items[0] ? (
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Days present" value={summary.data.items[0].present_days} hint={`of ${summary.data.working_days_through_today} working days so far, including today`} />
                <Stat label="Late" value={summary.data.items[0].late_days} />
                <Stat label="Left early" value={summary.data.items[0].early_days} />
                <Stat label="Absent" value={summary.data.items[0].absent_days} hint="Working days with no check-in and no leave" />
                <Stat label="Hours worked" value={formatDuration(summary.data.items[0].worked_minutes)} />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Loading…</p>
            )}
          </section>

          <Card>
            <CardHeader title="Recent days" />
            {recent.error && !recent.data ? (
              <ErrorState title="Couldn't load recent days" message={recent.error.message} onRetry={recent.reload} />
            ) : recent.data && recent.data.items.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-500 sm:px-6">No attendance recorded yet. Your first check-in will show here.</p>
            ) : (
              <ul className="divide-y divide-slate-100">{recent.data?.items.map((r) => <RecentRow key={r.id} r={r} />)}</ul>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
