import { useMemo, useState } from 'react'
import { leaveApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { Input, Select, Textarea } from '../../../components/ui/Field'
import { SunIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { LeaveRequest, LeaveStatus } from '../../../types/workforce'
import { CancelLeaveDialog, LeaveHistoryDialog } from '../components/LeaveDialogs'
import { LeaveRequestRows } from '../components/LeaveRequestRows'
import type { RowAction } from '../components/LeaveRequestRows'
import { NotLinked, PageHeader, Pager, SectionTabs } from '../components/Shared'
import { leaveTabs, useAccess } from '../lib/useAccess'
import { balanceProblem, formatDays, statusLabels, validateLeave } from '../lib/workforce'
import type { LeaveFormValues } from '../lib/workforce'

const PAGE_SIZE = 10
const empty: LeaveFormValues = { leave_type_id: '', start_date: '', end_date: '', reason: '' }

/** Ask for leave, see what it will cost before sending, and follow your requests. */
export function MyLeavePage() {
  const access = useAccess()
  const toast = useToast()
  const [refresh, setRefresh] = useState(0)
  const [values, setValues] = useState<LeaveFormValues>(empty)
  const [errors, setErrors] = useState<Partial<Record<keyof LeaveFormValues, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<LeaveStatus | ''>('')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null)
  const [viewing, setViewing] = useState<LeaveRequest | null>(null)

  const types = useQuery((s) => leaveApi.types(false, s), 'leave-types', access.hasRecord)
  const year = values.start_date ? Number(values.start_date.slice(0, 4)) : undefined
  const balances = useQuery((s) => leaveApi.myBalances(year, s), `my-balances-${year ?? 'now'}-${refresh}`, access.hasRecord)
  const rangeOk = values.start_date !== '' && values.end_date !== '' && values.end_date >= values.start_date && values.start_date.slice(0, 4) === values.end_date.slice(0, 4)
  const preview = useQuery((s) => leaveApi.preview(values.start_date, values.end_date, s), `preview-${values.start_date}-${values.end_date}`, rangeOk)
  const list = useQuery((s) => leaveApi.mine({ status: status || undefined, page, page_size: PAGE_SIZE }, s), `my-leave-${status}-${page}-${refresh}`, access.hasRecord)

  const type = types.data?.find((t) => t.id === values.leave_type_id)
  const available = balances.data?.balances.find((b) => b.leave_type.id === values.leave_type_id)?.available
  const days = rangeOk ? preview.data?.days : undefined
  const shortfall = useMemo(() => balanceProblem(type, available, days), [type, available, days])
  const set = (patch: Partial<LeaveFormValues>) => {
    setValues((v) => ({ ...v, ...patch }))
    setErrors({})
    setServerError(null)
  }

  const submit = async () => {
    const found = validateLeave(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setServerError(null)
    try {
      await leaveApi.submit({ ...values, reason: values.reason.trim() })
      toast.success('Leave requested. HR has been asked to decide.')
      setValues(empty)
      setPage(1)
      setRefresh((n) => n + 1)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not send the request.')
    } finally {
      setBusy(false)
    }
  }

  const act = async (action: RowAction, r: LeaveRequest) => {
    if (action === 'cancel') return setCancelling(r)
    if (action === 'history') return setViewing(r)
    if (action !== 'withdraw') return
    setBusyId(r.id)
    try {
      await leaveApi.withdraw(r.id)
      toast.success('Request withdrawn.')
      setRefresh((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw the request.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader title="My leave requests" subtitle="Weekends and company holidays are not counted against you." />
      <SectionTabs label="Leave" tabs={leaveTabs(access)} />
      {!access.hasRecord ? (
        <NotLinked />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Request leave" />
            <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
              <Select label="Leave type" required value={values.leave_type_id} error={errors.leave_type_id} onChange={(e) => set({ leave_type_id: e.target.value })}>
                <option value="">Choose a type…</option>
                {(types.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_paid ? '' : ' (unpaid)'}</option>
                ))}
              </Select>
              <div className="flex items-end pb-3 text-sm text-slate-600" aria-live="polite">
                {type?.tracks_balance && available !== undefined ? (
                  <span>Available {year ?? ''}: <strong className="text-navy-900">{formatDays(available)}</strong></span>
                ) : type ? (
                  <span>{type.is_paid ? 'This type has no balance limit.' : 'Unpaid leave never uses your paid balance.'}</span>
                ) : null}
              </div>
              <Input label="First day" type="date" required value={values.start_date} error={errors.start_date} onChange={(e) => set({ start_date: e.target.value, end_date: values.end_date || e.target.value })} />
              <Input label="Last day" type="date" required value={values.end_date} min={values.start_date || undefined} error={errors.end_date} onChange={(e) => set({ end_date: e.target.value })} />
              <div className="lg:col-span-2" aria-live="polite" data-testid="leave-preview">
                {rangeOk && preview.loading && !preview.data ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Counting working days…</p>
                ) : rangeOk && preview.data ? (
                  <p className="rounded-xl bg-lavender-50 px-4 py-3 text-sm text-navy-900">
                    <strong>{formatDays(preview.data.days)}</strong> of leave
                    {preview.data.weekends_skipped + preview.data.holidays_skipped > 0 &&
                      ` (${preview.data.weekends_skipped} weekend day${preview.data.weekends_skipped === 1 ? '' : 's'} and ${preview.data.holidays_skipped} holiday${preview.data.holidays_skipped === 1 ? '' : 's'} not counted)`}
                    .{preview.data.days === 0 && ' There are no working days in this range.'}
                  </p>
                ) : rangeOk && preview.error ? (
                  <p role="alert" className="text-sm text-rose-600">{preview.error.message}</p>
                ) : null}
                {shortfall && <p role="alert" className="mt-2 text-sm text-rose-600">{shortfall}</p>}
              </div>
              <div className="lg:col-span-2">
                <Textarea label="Reason (optional)" rows={3} maxLength={1000} value={values.reason} error={errors.reason} onChange={(e) => set({ reason: e.target.value })} />
              </div>
              {serverError && <p role="alert" className="text-sm text-rose-600 lg:col-span-2">{serverError}</p>}
              <div className="lg:col-span-2">
                <Button type="submit" loading={busy} disabled={shortfall !== null || (days !== undefined && days === 0)}>Send request</Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader
              title="Your requests"
              action={
                <div className="w-40">
                  <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as LeaveStatus | ''); setPage(1) }}>
                    <option value="">All</option>
                    {(Object.keys(statusLabels) as LeaveStatus[]).map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
                  </Select>
                </div>
              }
            />
            {list.loading && !list.data ? (
              <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading your requests…</p>
            ) : list.error && !list.data ? (
              <ErrorState title="Couldn't load your requests" message={list.error.message} onRetry={list.reload} />
            ) : list.data && list.data.items.length === 0 ? (
              <EmptyState icon={<SunIcon className="size-7" />} title={status ? 'No requests with that status' : 'No leave requests yet'} description="When you ask for leave it will be listed here, with HR's decision." />
            ) : list.data ? (
              <>
                <LeaveRequestRows items={list.data.items} showEmployee={false} busyId={busyId} onAction={(a, r) => void act(a, r)} />
                <Pager page={page} total={list.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
              </>
            ) : null}
          </Card>
        </div>
      )}
      <CancelLeaveDialog request={cancelling} own onClose={() => setCancelling(null)} onDone={() => setRefresh((n) => n + 1)} />
      <LeaveHistoryDialog request={viewing} onClose={() => setViewing(null)} />
    </>
  )
}
