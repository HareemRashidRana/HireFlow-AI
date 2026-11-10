import { useState } from 'react'
import { attendanceApi, configApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { Input } from '../../../components/ui/Field'
import { ClockIcon, PlusIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import type { AttendanceRecord } from '../../../types/workforce'
import { AddRecordDialog, CorrectDialog, CorrectionsDialog } from '../components/AttendanceDialogs'
import { EmployeePicker } from '../components/EmployeePicker'
import type { PickedEmployee } from '../components/EmployeePicker'
import { Flag, PageHeader, Pager, SectionTabs } from '../components/Shared'
import { attendanceTabs, useAccess } from '../lib/useAccess'
import { formatClock, formatDay, formatDuration } from '../lib/workforce'

const PAGE_SIZE = 15

/** HR: find any attendance record, add a missing one, correct one, and read what has been changed. */
export function AttendanceManagePage() {
  const access = useAccess()
  const [who, setWho] = useState<PickedEmployee | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [lateOnly, setLateOnly] = useState(false)
  const [openOnly, setOpenOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [adding, setAdding] = useState(false)
  const [correcting, setCorrecting] = useState<AttendanceRecord | null>(null)
  const [viewing, setViewing] = useState<AttendanceRecord | null>(null)

  const reset = () => setPage(1)
  const settings = useQuery((s) => configApi.settings(s), 'work-settings')
  const params = { employee_id: who?.id, start: start || undefined, end: end || undefined, late: lateOnly || undefined, state: openOnly ? ('open' as const) : undefined }
  const records = useQuery(
    (s) => attendanceApi.records({ ...params, page, page_size: PAGE_SIZE }, s),
    `att-manage-${JSON.stringify(params)}-${page}-${refresh}`,
  )
  const filtered = who !== null || start !== '' || end !== '' || lateOnly || openOnly

  return (
    <>
      <PageHeader
        title="Records and corrections"
        subtitle="Every correction needs a reason and is kept in the record's history."
        action={
          <Button onClick={() => setAdding(true)} disabled={!settings.data}>
            <PlusIcon className="size-4" /> Add a record
          </Button>
        }
      />
      <SectionTabs label="Attendance" tabs={attendanceTabs(access)} />
      <div className="space-y-6">
        <form role="search" aria-label="Filter records" onSubmit={(e) => e.preventDefault()} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
            <EmployeePicker allowAll value={who} onChange={(e) => { setWho(e); reset() }} />
            <Input label="From" type="date" value={start} onChange={(e) => { setStart(e.target.value); reset() }} />
            <Input label="To" type="date" value={end} onChange={(e) => { setEnd(e.target.value); reset() }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-navy-900">
              <input type="checkbox" checked={lateOnly} onChange={(e) => { setLateOnly(e.target.checked); reset() }} className="size-4 rounded border-slate-300" /> Late only
            </label>
            <label className="flex items-center gap-2 text-sm text-navy-900">
              <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); reset() }} className="size-4 rounded border-slate-300" /> Not checked out
            </label>
            {filtered && (
              <Button variant="secondary" size="sm" onClick={() => { setWho(null); setStart(''); setEnd(''); setLateOnly(false); setOpenOnly(false); reset() }}>
                Clear filters
              </Button>
            )}
          </div>
        </form>

        <Card>
          <CardHeader title="Attendance records" />
          {records.loading && !records.data ? (
            <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading records…</p>
          ) : records.error && !records.data ? (
            <ErrorState title="Couldn't load records" message={records.error.message} onRetry={records.reload} />
          ) : records.data && records.data.items.length === 0 ? (
            <EmptyState icon={<ClockIcon className="size-7" />} title={filtered ? 'No records match' : 'No attendance yet'} description={filtered ? 'Try clearing a filter.' : 'Records appear when people check in, or when you add one.'} />
          ) : records.data ? (
            <>
              <ul aria-label="Records" className="divide-y divide-slate-100">
                {records.data.items.map((r) => (
                  <li key={r.id} className="grid gap-3 px-5 py-3 sm:px-6 lg:grid-cols-[1.2fr_1.2fr_1.4fr_auto] lg:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-navy-900">{r.employee.name}</span>
                      <span className="block text-xs text-slate-500">{r.employee.department}</span>
                    </span>
                    <span className="text-sm text-slate-600">{formatDay(r.work_date)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      {formatClock(r.check_in_at, r.timezone)} to {r.check_out_at ? formatClock(r.check_out_at, r.timezone) : 'open'}
                      {r.worked_minutes !== null && <span className="tabular-nums">({formatDuration(r.worked_minutes)})</span>}
                      {r.is_late && <Flag tone="amber">Late</Flag>}
                      {r.left_early && <Flag tone="rose">Left early</Flag>}
                      {r.source === 'hr' && <Flag tone="lavender">Added by HR</Flag>}
                      {r.corrected && r.source !== 'hr' && <Flag tone="lavender">Corrected</Flag>}
                      {r.state === 'open' && <Flag tone="slate">Open</Flag>}
                    </span>
                    <span className="flex gap-2">
                      <Button variant="secondary" size="sm" aria-label={`Correct ${r.employee.name} on ${formatDay(r.work_date)}`} onClick={() => setCorrecting(r)}>Correct</Button>
                      <Button variant="ghost" size="sm" aria-label={`History for ${r.employee.name} on ${formatDay(r.work_date)}`} onClick={() => setViewing(r)}>History</Button>
                    </span>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={records.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          ) : null}
        </Card>
      </div>

      <AddRecordDialog open={adding} tz={settings.data?.timezone ?? 'UTC'} onClose={() => setAdding(false)} onDone={() => setRefresh((n) => n + 1)} />
      <CorrectDialog record={correcting} onClose={() => setCorrecting(null)} onDone={() => setRefresh((n) => n + 1)} />
      <CorrectionsDialog record={viewing} onClose={() => setViewing(null)} />
    </>
  )
}
