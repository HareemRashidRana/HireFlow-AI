import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import type { TodayStatus } from '../../../types/workforce'
import { formatClock, formatDay, formatDuration } from '../lib/workforce'
import { Flag, Note } from './Shared'

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

/**
 * Today's status with the Check in / Check out button. `large` makes the button the biggest thing on
 * the page (the Employee home); otherwise it is the normal-sized control of the attendance page.
 */
export function CheckInCard({
  t,
  busy,
  onCheckIn,
  onCheckOut,
  large = false,
}: {
  t: TodayStatus
  busy: boolean
  onCheckIn: () => void
  onCheckOut: () => void
  large?: boolean
}) {
  const minutes = useElapsedMinutes(t.record?.check_in_at ?? null, t.state === 'checked_in')
  const worked = t.state === 'checked_out' ? (t.record?.worked_minutes ?? t.minutes_so_far) : t.state === 'checked_in' ? minutes : 0
  const size = large ? 'h-14 w-full px-8 text-base sm:w-auto sm:min-w-48' : ''

  return (
    <>
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
              <Button size="md" className={size} loading={busy} disabled={t.stale_open_from !== null} onClick={onCheckIn}>
                Check in
              </Button>
            )}
            {t.state === 'checked_in' && (
              <Button size="md" className={size} loading={busy} onClick={onCheckOut}>
                Check out
              </Button>
            )}
            {t.state === 'checked_out' && <p className="text-sm text-slate-500">You have finished for today.</p>}
          </div>
        </div>
      </Card>
    </>
  )
}
