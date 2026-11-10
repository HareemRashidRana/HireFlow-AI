import { useState } from 'react'
import { attendanceApi } from '../../../api/workforce'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Input } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { Note, PageHeader, Pager, SectionTabs, Stat } from '../components/Shared'
import { attendanceTabs, useAccess } from '../lib/useAccess'
import { dayKey, formatDay, formatDuration, monthLabel, monthOf } from '../lib/workforce'

const PAGE_SIZE = 15

/** HR: how today is going, and a month of attendance per employee. Absence is computed, never invented. */
export function AttendanceOverviewPage() {
  const access = useAccess()
  const [day, setDay] = useState(() => dayKey(new Date()))
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const [page, setPage] = useState(1)
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(day)
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  const stats = useQuery((s) => attendanceApi.stats(day, s), `att-stats-${day}`, dayOk)
  const summary = useQuery((s) => attendanceApi.summary({ month, page, page_size: PAGE_SIZE }, s), `att-month-${month}-${page}`, monthOk)
  const s = stats.data

  return (
    <>
      <PageHeader title="Attendance overview" subtitle="Who is in, who is late and who is away, for any day and any month." />
      <SectionTabs label="Attendance" tabs={attendanceTabs(access)} />
      <div className="space-y-6">
        <div className="w-52">
          <Input label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        {stats.error && !s ? (
          <Card><ErrorState title="Couldn't load the day" message={stats.error.message} onRetry={stats.reload} /></Card>
        ) : !s ? (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading…</p>
        ) : (
          <>
            {s.holiday_name && <Note>{formatDay(s.date)} is a company holiday: {s.holiday_name}. Nobody is expected.</Note>}
            {!s.holiday_name && !s.is_working_day && <Note>{formatDay(s.date)} is not a working day. Nobody is expected.</Note>}
            <dl aria-label={`Attendance on ${s.date}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
              <Stat label="Expected" value={s.expected} hint="Active employees" />
              <Stat label="Present" value={s.present} hint={`${s.checked_out} finished, ${s.still_in} still in`} />
              <Stat label="Late" value={s.late} />
              <Stat label="On leave" value={s.on_leave} />
              <Stat label="Not checked in" value={s.not_checked_in} hint="Expected, not on leave" />
              <Stat label="Still in" value={s.still_in} />
              <Stat label="Finished" value={s.checked_out} />
            </dl>
          </>
        )}

        <Card>
          <CardHeader title={monthOk ? monthLabel(month) : 'Month'} action={<div className="w-44"><Input label="Month" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1) }} /></div>} />
          {!monthOk ? (
            <p role="alert" className="px-5 py-6 text-sm text-rose-600 sm:px-6">Choose a month.</p>
          ) : summary.error && !summary.data ? (
            <ErrorState title="Couldn't load the month" message={summary.error.message} onRetry={summary.reload} />
          ) : !summary.data ? (
            <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
          ) : summary.data.items.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-500 sm:px-6">There are no active employees to show.</p>
          ) : (
            <>
              <p className="px-5 pt-4 text-xs text-slate-500 sm:px-6">
                {summary.data.working_days_so_far} working day{summary.data.working_days_so_far === 1 ? '' : 's'} finished so far. Absent means a finished working day with no check-in and no approved leave.
              </p>
              <ul aria-label="Attendance by employee" className="divide-y divide-slate-100">
                {summary.data.items.map((r) => (
                  <li key={r.employee.id} className="grid gap-2 px-5 py-3 sm:px-6 lg:grid-cols-[1fr_repeat(5,5.5rem)] lg:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-navy-900">{r.employee.name}</span>
                      <span className="block text-xs text-slate-500">{r.employee.department}</span>
                    </span>
                    {([['Present', r.present_days], ['Late', r.late_days], ['On leave', r.leave_days], ['Absent', r.absent_days]] as const).map(([k, v]) => (
                      <span key={k} className={`text-sm tabular-nums ${k === 'Absent' && v > 0 ? 'font-semibold text-rose-600' : 'text-slate-600'}`}>
                        <span className="text-xs text-slate-500 lg:sr-only">{k}: </span>{v}
                      </span>
                    ))}
                    <span className="text-sm text-slate-600 tabular-nums"><span className="text-xs text-slate-500 lg:sr-only">Hours: </span>{formatDuration(r.worked_minutes)}</span>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={summary.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          )}
        </Card>
      </div>
    </>
  )
}
