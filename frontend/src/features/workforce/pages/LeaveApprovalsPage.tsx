import { useState } from 'react'
import { leaveApi } from '../../../api/workforce'
import { Card, CardHeader } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { Select } from '../../../components/ui/Field'
import { SunIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import type { LeaveRequest, LeaveStatus } from '../../../types/workforce'
import { EmployeePicker } from '../components/EmployeePicker'
import type { PickedEmployee } from '../components/EmployeePicker'
import { CancelLeaveDialog, DecisionDialog, LeaveHistoryDialog } from '../components/LeaveDialogs'
import { LeaveRequestRows } from '../components/LeaveRequestRows'
import type { RowAction } from '../components/LeaveRequestRows'
import { Note, PageHeader, Pager, SectionTabs } from '../components/Shared'
import { leaveTabs, useAccess } from '../lib/useAccess'
import { statusLabels } from '../lib/workforce'

const PAGE_SIZE = 10

/** HR: decide leave requests. Your own requests show no approve or reject button, whatever your role. */
export function LeaveApprovalsPage() {
  const access = useAccess()
  const [status, setStatus] = useState<LeaveStatus | ''>('pending')
  const [who, setWho] = useState<PickedEmployee | null>(null)
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; mode: 'approve' | 'reject' } | null>(null)
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null)
  const [viewing, setViewing] = useState<LeaveRequest | null>(null)
  const list = useQuery(
    (s) => leaveApi.list({ status: status || undefined, employee_id: who?.id, page, page_size: PAGE_SIZE }, s),
    `approvals-${status}-${who?.id ?? ''}-${page}-${refresh}`,
  )
  const done = () => setRefresh((n) => n + 1)
  const act = (action: RowAction, r: LeaveRequest) => {
    if (action === 'approve' || action === 'reject') setDeciding({ request: r, mode: action })
    else if (action === 'cancel') setCancelling(r)
    else if (action === 'history') setViewing(r)
  }
  const hasOwn = list.data?.items.some((r) => r.employee.id === access.employeeId && r.status === 'pending')

  return (
    <>
      <PageHeader title="Leave approvals" subtitle="Approving takes the days from the employee's balance, once." />
      <SectionTabs label="Leave" tabs={leaveTabs(access)} />
      <div className="space-y-6">
        <form role="search" aria-label="Filter requests" onSubmit={(e) => e.preventDefault()} className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:grid-cols-[12rem_1fr]">
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as LeaveStatus | ''); setPage(1) }}>
            <option value="">All</option>
            {(Object.keys(statusLabels) as LeaveStatus[]).map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
          </Select>
          <EmployeePicker allowAll label="Employee" value={who} onChange={(e) => { setWho(e); setPage(1) }} />
        </form>
        {hasOwn && <Note>Your own pending request is listed, but another HR manager or administrator has to decide it.</Note>}
        <Card>
          <CardHeader title={status ? `${statusLabels[status]} requests` : 'All requests'} />
          {list.loading && !list.data ? (
            <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading requests…</p>
          ) : list.error && !list.data ? (
            <ErrorState title="Couldn't load requests" message={list.error.message} onRetry={list.reload} />
          ) : list.data && list.data.items.length === 0 ? (
            <EmptyState icon={<SunIcon className="size-7" />} title={status === 'pending' ? 'Nothing waiting for a decision' : 'No requests found'} description={status === 'pending' ? 'New requests will appear here.' : 'Try another status or person.'} />
          ) : list.data ? (
            <>
              <LeaveRequestRows items={list.data.items} showEmployee onAction={act} />
              <Pager page={page} total={list.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          ) : null}
        </Card>
      </div>
      <DecisionDialog request={deciding?.request ?? null} mode={deciding?.mode ?? null} onClose={() => setDeciding(null)} onDone={done} />
      <CancelLeaveDialog request={cancelling} own={cancelling?.employee.id === access.employeeId} onClose={() => setCancelling(null)} onDone={done} />
      <LeaveHistoryDialog request={viewing} onClose={() => setViewing(null)} />
    </>
  )
}
