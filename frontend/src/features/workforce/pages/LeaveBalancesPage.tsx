import { useState } from 'react'
import { leaveApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Input, Select, Textarea } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { EmployeeBalances } from '../../../types/workforce'
import { EmployeePicker } from '../components/EmployeePicker'
import type { PickedEmployee } from '../components/EmployeePicker'
import { Note, NotLinked, PageHeader, SectionTabs } from '../components/Shared'
import { leaveTabs, useAccess } from '../lib/useAccess'
import { formatDays } from '../lib/workforce'

function BalanceTable({ data }: { data: EmployeeBalances }) {
  if (data.balances.length === 0) return <p className="px-5 py-8 text-sm text-slate-500 sm:px-6">No leave types have a balance yet.</p>
  return (
    <ul aria-label={`Leave balances for ${data.year}`} className="divide-y divide-slate-100">
      {data.balances.map((b) => (
        <li key={b.leave_type.id} className="grid gap-2 px-5 py-4 sm:px-6 lg:grid-cols-[1.4fr_repeat(4,6rem)] lg:items-center">
          <span className="text-sm font-medium text-navy-900">{b.leave_type.name}</span>
          {([['Entitled', b.entitlement], ['Used', b.used], ['Pending', b.pending], ['Available', b.available]] as const).map(([k, v]) => (
            <span key={k} className={`text-sm tabular-nums ${k === 'Available' ? 'font-semibold text-navy-900' : 'text-slate-600'}`}>
              <span className="text-xs text-slate-500 lg:sr-only">{k}: </span>
              {formatDays(v)}
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}

function AdjustDialog({ data, open, onClose, onDone }: { data: EmployeeBalances | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [v, setV] = useState({ typeId: '', days: '', reason: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const submit = async () => {
    const e: Record<string, string> = {}
    const n = Number(v.days)
    if (!v.typeId) e.typeId = 'Choose a leave type.'
    if (v.days === '' || !Number.isFinite(n) || n === 0) e.days = 'Enter a number of days other than zero (use a minus sign to take days away).'
    if (!v.reason.trim()) e.reason = 'Say why you are adjusting this balance.'
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    setError(null)
    try {
      await leaveApi.adjust({ employee_id: data.employee.id, leave_type_id: v.typeId, year: data.year, days: n, reason: v.reason.trim() })
      toast.success('Balance adjusted. The change is in the ledger.')
      setV({ typeId: '', days: '', reason: '' })
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not adjust the balance.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Adjust ${data.employee.name}'s balance`}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="space-y-4">
        <Select label="Leave type" required value={v.typeId} error={errors.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>
          <option value="">Choose a type…</option>
          {data.balances.map((b) => <option key={b.leave_type.id} value={b.leave_type.id}>{b.leave_type.name}</option>)}
        </Select>
        <Input label="Days" type="number" step="0.5" required value={v.days} error={errors.days} hint={`For ${data.year}. Positive adds days, negative removes them.`} onChange={(e) => setV({ ...v, days: e.target.value })} />
        <Textarea label="Reason" required rows={3} maxLength={500} value={v.reason} error={errors.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save adjustment</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Your balances for a year. HR can look up anyone, grant the year's entitlement, and adjust with a reason. */
export function LeaveBalancesPage() {
  const access = useAccess()
  const toast = useToast()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [who, setWho] = useState<PickedEmployee | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [granting, setGranting] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const viewingOther = access.isHr && who !== null
  const mine = useQuery((s) => leaveApi.myBalances(year, s), `balances-me-${year}-${refresh}`, access.hasRecord && !viewingOther)
  const other = useQuery((s) => leaveApi.balances(who?.id ?? '', year, s), `balances-${who?.id}-${year}-${refresh}`, viewingOther)
  const shown = viewingOther ? other : mine
  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100

  const grant = async () => {
    setGranting(true)
    try {
      const r = await leaveApi.allocate(year, who?.id)
      toast.success(r.granted > 0 ? `${r.granted} entitlement${r.granted === 1 ? '' : 's'} granted for ${year}.` : `Everyone already has their ${year} entitlement.`)
      setRefresh((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not grant entitlements.')
    } finally {
      setGranting(false)
    }
  }

  return (
    <>
      <PageHeader title="Leave balances" subtitle="A balance is the entitlement, less approved leave, less requests still waiting." />
      <SectionTabs label="Leave" tabs={leaveTabs(access)} />
      <div className="space-y-6">
        <form role="search" aria-label="Choose balances" onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
          <div className="w-32">
            <Input label="Year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          {access.isHr && <div className="min-w-64 flex-1"><EmployeePicker allowAll label="Employee" value={who} onChange={setWho} /></div>}
        </form>
        {access.isHr && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={granting} disabled={!validYear} onClick={() => void grant()}>
              {who ? `Grant ${year} entitlement to ${who.name}` : `Grant ${year} entitlement to everyone`}
            </Button>
            <Button variant="secondary" disabled={!viewingOther || !shown.data} onClick={() => setAdjusting(true)}>Adjust balance</Button>
          </div>
        )}
        {access.isHr && !who && !access.hasRecord ? (
          <Note>Choose an employee to see their balances.</Note>
        ) : !viewingOther && !access.hasRecord ? (
          <NotLinked />
        ) : !validYear ? (
          <p role="alert" className="text-sm text-rose-600">Choose a year between 2000 and 2100.</p>
        ) : (
          <Card>
            <CardHeader title={viewingOther && shown.data ? `${shown.data.employee.name}, ${year}` : `Your balances, ${year}`} />
            {shown.loading && !shown.data ? (
              <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading balances…</p>
            ) : shown.error && !shown.data ? (
              <ErrorState title="Couldn't load balances" message={shown.error.message} onRetry={shown.reload} />
            ) : shown.data ? (
              <BalanceTable data={shown.data} />
            ) : null}
          </Card>
        )}
      </div>
      <AdjustDialog data={viewingOther ? (other.data ?? null) : null} open={adjusting} onClose={() => setAdjusting(false)} onDone={() => setRefresh((n) => n + 1)} />
    </>
  )
}
