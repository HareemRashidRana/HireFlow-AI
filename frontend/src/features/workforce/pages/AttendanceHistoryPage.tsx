import { useState } from 'react'
import { attendanceApi } from '../../../api/workforce'
import { Card, CardHeader } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { ClockIcon } from '../../../components/ui/icons'
import { Input } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { Flag, NotLinked, PageHeader, Pager, SectionTabs, Stat } from '../components/Shared'
import { attendanceTabs, useAccess } from '../lib/useAccess'
import { formatClock, formatDay, formatDuration, monthLabel, monthOf } from '../lib/workforce'

const PAGE_SIZE = 15

/** Your own attendance, month by month. Read-only: nothing here can be edited, only HR can correct it. */
export function AttendanceHistoryPage() {
  const access = useAccess()
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const [lateOnly, setLateOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [first, last] = [`${month}-01`, `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()).padStart(2, '0')}`]
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)

  const summary = useQuery((s) => attendanceApi.mySummary(month, s), `att-hist-summary-${month}`, access.hasRecord && valid)
  const records = useQuery(
    (s) => attendanceApi.mine({ start: first, end: last, late: lateOnly || undefined, page, page_size: PAGE_SIZE }, s),
    `att-hist-${month}-${lateOnly}-${page}`,
    access.hasRecord && valid,
  )
  const row = summary.data?.items[0]

  return (
    <>
      <PageHeader title="Attendance history" subtitle="Your recorded days. Corrections made by HR are marked." />
      <SectionTabs label="Attendance" tabs={attendanceTabs(access)} />
      {!access.hasRecord ? (
        <NotLinked />
      ) : (
        <div className="space-y-6">
          <form role="search" aria-label="Filter history" onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
            <div className="w-48">
              <Input label="Month" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1) }} />
            </div>
            <label className="flex items-center gap-2 pb-3 text-sm text-navy-900">
              <input type="checkbox" checked={lateOnly} onChange={(e) => { setLateOnly(e.target.checked); setPage(1) }} className="size-4 rounded border-slate-300" />
              Only late days
            </label>
          </form>

          {!valid ? (
            <p role="alert" className="text-sm text-rose-600">Choose a month.</p>
          ) : (
            <>
              {summary.error && !row ? (
                <p role="alert" className="text-sm text-rose-600">
                  Couldn&apos;t load the summary. <button type="button" onClick={summary.reload} className="font-medium underline">Retry</button>
                </p>
              ) : row ? (
                <dl aria-label={`Summary for ${monthLabel(month)}`} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <Stat label="Days present" value={row.present_days} hint={`of ${summary.data?.working_days_through_today ?? 0} working days so far`} />
                  <Stat label="Late" value={row.late_days} />
                  <Stat label="Left early" value={row.early_days} />
                  <Stat label="Absent" value={row.absent_days} hint={row.leave_days ? `${row.leave_days} on approved leave` : 'Not counting approved leave'} />
                  <Stat label="Hours worked" value={formatDuration(row.worked_minutes)} />
                </dl>
              ) : (
                <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading…</p>
              )}

              <Card>
                <CardHeader title={monthLabel(month)} />
                {records.loading && !records.data ? (
                  <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading records…</p>
                ) : records.error && !records.data ? (
                  <ErrorState title="Couldn't load your records" message={records.error.message} onRetry={records.reload} />
                ) : records.data && records.data.items.length === 0 ? (
                  <EmptyState icon={<ClockIcon className="size-7" />} title={lateOnly ? 'No late days' : 'No attendance this month'} description={lateOnly ? 'You were on time every day you checked in.' : 'Days you check in will appear here.'} />
                ) : records.data ? (
                  <>
                    <ul aria-label="Attendance records" className="divide-y divide-slate-100">
                      {records.data.items.map((r) => (
                        <li key={r.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[10rem_1fr_6rem] sm:items-center sm:px-6">
                          <span className="text-sm font-medium text-navy-900">{formatDay(r.work_date)}</span>
                          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                            {formatClock(r.check_in_at, r.timezone)} to {r.check_out_at ? formatClock(r.check_out_at, r.timezone) : 'still in'}
                            {r.is_late && <Flag tone="amber">Late</Flag>}
                            {r.left_early && <Flag tone="rose">Left early</Flag>}
                            {r.corrected && <Flag tone="lavender">Corrected by HR</Flag>}
                          </span>
                          <span className="text-sm font-medium text-navy-900 tabular-nums sm:text-right">{r.worked_minutes !== null ? formatDuration(r.worked_minutes) : 'Open'}</span>
                        </li>
                      ))}
                    </ul>
                    <Pager page={page} total={records.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
                  </>
                ) : null}
              </Card>
            </>
          )}
        </div>
      )}
    </>
  )
}
