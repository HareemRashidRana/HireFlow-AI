import { useState } from 'react'
import { Link } from 'react-router-dom'
import { leaveApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import type { CalendarLeave } from '../../../types/workforce'
import { PageHeader, SectionTabs } from '../components/Shared'
import { leaveTabs, useAccess } from '../lib/useAccess'
import { formatDays, formatDay, inRange, monthGrid, monthLabel, monthOf, shiftMonth, weekdayNames } from '../lib/workforce'

const dayNumber = (day: string) => Number(day.slice(8))

/** Company holidays for everyone, your own approved leave, and (for HR) everyone's approved leave. */
export function LeaveCalendarPage() {
  const access = useAccess()
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const { data, error, loading, reload } = useQuery((s) => leaveApi.calendar(month, s), `leave-calendar-${month}`)
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.day, h.name]))
  const mine = (day: string) => (data?.my_leave ?? []).filter((l) => inRange(day, l.start_date, l.end_date))
  const team = (day: string) => (data?.team_leave ?? []).filter((l) => inRange(day, l.start_date, l.end_date))
  const listed: CalendarLeave[] = access.isHr ? (data?.team_leave ?? []) : (data?.my_leave ?? [])

  return (
    <>
      <PageHeader
        title="Leave calendar"
        subtitle="Company holidays and approved leave."
        action={access.isHr ? <Link to="/settings/work" className="text-sm font-medium text-lavender-700 underline">Manage holidays</Link> : undefined}
      />
      <SectionTabs label="Leave" tabs={leaveTabs(access)} />
      <Card>
        <CardHeader
          title={monthLabel(month)}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeftIcon className="size-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => setMonth(monthOf(new Date()))}>This month</Button>
              <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRightIcon className="size-4" /></Button>
            </div>
          }
        />
        {error && !data ? (
          <ErrorState title="Couldn't load the calendar" message={error.message} onRetry={reload} />
        ) : !data ? (
          <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
        ) : (
          <div aria-busy={loading} className="p-3 sm:p-5">
            <div role="table" aria-label={`Calendar for ${monthLabel(month)}`} className="hidden md:block">
              <div role="row" className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-medium text-slate-500">
                {weekdayNames.map((n) => <span key={n} role="columnheader">{n.slice(0, 3)}</span>)}
              </div>
              {monthGrid(month).map((week, i) => (
                <div role="row" key={i} className="grid grid-cols-7 gap-1">
                  {week.map((day, j) =>
                    day === null ? (
                      <span key={j} role="cell" className="min-h-20 rounded-lg bg-slate-50/60" />
                    ) : (
                      <span
                        key={day}
                        role="cell"
                        aria-label={`${formatDay(day)}${holidays.has(day) ? `, holiday: ${holidays.get(day)}` : ''}`}
                        className={`min-h-20 rounded-lg border p-1.5 text-xs ${holidays.has(day) ? 'border-lavender-300 bg-lavender-100' : 'border-slate-200 bg-white'}`}
                      >
                        <span className="font-medium text-navy-900">{dayNumber(day)}</span>
                        {holidays.has(day) && <span className="mt-0.5 block text-lavender-700">{holidays.get(day)}</span>}
                        {mine(day).map((l, k) => <span key={k} className="mt-0.5 block rounded bg-navy-900 px-1 text-white">You: {l.leave_type}</span>)}
                        {access.isHr && team(day).length > 0 && <span className="mt-0.5 block text-slate-600">{team(day).length} away</span>}
                      </span>
                    ),
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4 md:mt-6">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy-900">Holidays</h3>
                {data.holidays.length === 0 ? (
                  <p className="text-sm text-slate-500">No company holidays this month.</p>
                ) : (
                  <ul aria-label="Holidays" className="space-y-1 text-sm text-slate-600">
                    {data.holidays.map((h) => <li key={h.id}><span className="font-medium text-navy-900">{formatDay(h.day)}</span>: {h.name}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy-900">{access.isHr ? 'Approved leave' : 'Your approved leave'}</h3>
                {listed.length === 0 ? (
                  <p className="text-sm text-slate-500">No approved leave this month.</p>
                ) : (
                  <ul aria-label="Approved leave" className="space-y-1 text-sm text-slate-600">
                    {listed.map((l, i) => (
                      <li key={i}>
                        {access.isHr && <span className="font-medium text-navy-900">{l.employee}: </span>}
                        {l.leave_type}, {formatDay(l.start_date)}{l.start_date === l.end_date ? '' : ` to ${formatDay(l.end_date)}`} ({formatDays(l.days)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
