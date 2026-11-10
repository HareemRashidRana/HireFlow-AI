import { useEffect, useState } from 'react'
import { attendanceApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { AttendanceRecord } from '../../../types/workforce'
import { Flag, Note, NotLinked, PageHeader, SectionTabs, Stat } from '../components/Shared'
import { formatClock, formatDay, formatDuration, monthLabel } from '../lib/workforce'
import { attendanceTabs, useAccess } from '../lib/useAccess'

/** Minutes since check-in, ticking while the page is open. */
function useElapsedMinutes(checkIn: string | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [active])
  return checkIn ? Math.max(0, Math.floor((now - new Date(checkIn).getTime()) / 60_000)) : 0
}

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
  const toast = useToast()
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const today = useQuery((s) => attendanceApi.today(s), `att-today-${refresh}`, access.hasRecord)
  const month = today.data?.work_date.slice(0, 7)
  const summary = useQuery((s) => attendanceApi.mySummary(month ?? '', s), `att-summary-${month}-${refresh}`, month !== undefined)
  const recent = useQuery((s) => attendanceApi.mine({ page_size: 7 }, s), `att-recent-${refresh}`, access.hasRecord)
  const t = today.data
  const minutes = useElapsedMinutes(t?.record?.check_in_at ?? null, t?.state === 'checked_in')
  const worked = t?.state === 'checked_out' ? (t.record?.worked_minutes ?? t.minutes_so_far) : t?.state === 'checked_in' ? minutes : 0

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await work()
      toast.success(done)
      setRefresh((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

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
          {t.stale_open_from && (
            <Note tone="rose">You still have an open check-in from {formatDay(t.stale_open_from)}. Ask HR to close it before you check in again.</Note>
          )}
          {t.holiday_name && <Note>Today is a company holiday: {t.holiday_name}.</Note>}
          {!t.holiday_name && !t.is_working_day && <Note>Today is not a working day.</Note>}
          {t.on_leave && <Note>You are on approved leave today.</Note>}

          <Card>
            <CardHeader title={formatDay(t.work_date)} />
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Status</p>
                <p className="mt-1 text-xl font-semibold text-navy-900" data-testid="attendance-state">
                  {t.state === 'not_checked_in' ? 'Not checked in' : t.state === 'checked_in' ? 'Checked in' : 'Checked out'}
                </p>
                {t.record && (
                  <p className="mt-1 text-sm text-slate-600">
                    In at {formatClock(t.record.check_in_at, t.timezone)}
                    {t.record.check_out_at ? `, out at ${formatClock(t.record.check_out_at, t.timezone)}` : ''} ({t.timezone})
                    {t.record.is_late && <span className="ml-2"><Flag tone="amber">Late</Flag></span>}
                    {t.record.left_early && <span className="ml-2"><Flag tone="rose">Left early</Flag></span>}
                  </p>
                )}
                <p className="mt-3 text-xs font-medium tracking-wide text-slate-500 uppercase">Worked today</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-navy-900 tabular-nums" aria-live="polite">
                  {formatDuration(worked)}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  Working day {t.work_start.slice(0, 5)} to {t.work_end.slice(0, 5)}, with {t.grace_minutes} minutes of grace before a check-in
                  counts as late.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                {t.state === 'not_checked_in' && (
                  <Button size="md" loading={busy} disabled={t.stale_open_from !== null} onClick={() => void act(attendanceApi.checkIn, 'You are checked in.')}>
                    Check in
                  </Button>
                )}
                {t.state === 'checked_in' && (
                  <Button size="md" loading={busy} onClick={() => void act(attendanceApi.checkOut, 'You are checked out.')}>
                    Check out
                  </Button>
                )}
                {t.state === 'checked_out' && <p className="text-sm text-slate-500">You have finished for today.</p>}
              </div>
            </div>
          </Card>

          <section aria-label="This month">
            <h2 className="mb-3 text-sm font-semibold text-navy-900">{month ? monthLabel(month) : 'This month'}</h2>
            {summary.error && !summary.data ? (
              <p role="alert" className="text-sm text-rose-600">
                Couldn&apos;t load the month. <button type="button" onClick={summary.reload} className="font-medium underline">Retry</button>
              </p>
            ) : summary.data?.items[0] ? (
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Days present" value={summary.data.items[0].present_days} hint={`of ${summary.data.working_days_so_far} working days so far`} />
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
