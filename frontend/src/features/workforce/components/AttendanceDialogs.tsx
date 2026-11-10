import { useState } from 'react'
import { attendanceApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Input, Textarea } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { AttendanceRecord } from '../../../types/workforce'
import { EmployeePicker } from './EmployeePicker'
import type { PickedEmployee } from './EmployeePicker'
import { formatClock, formatDay, nextDay, utcToWall, wallToUtc } from '../lib/workforce'

/** HR changes a record's times. A reason is required and the change is kept in the audit trail. */
export function CorrectDialog({ record, onClose, onDone }: { record: AttendanceRecord | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const tz = record?.timezone ?? 'UTC'
  const out = record?.check_out_at ? utcToWall(record.check_out_at, tz) : null
  const initial = record
    ? { inTime: utcToWall(record.check_in_at, tz).time, outTime: out?.time ?? '', nextDay: out !== null && out.date !== record.work_date, reason: '' }
    : { inTime: '', outTime: '', nextDay: false, reason: '' }
  return (
    <Modal open={record !== null} onClose={onClose} title="Correct attendance">
      {record && <CorrectForm key={record.id} record={record} tz={tz} initial={initial} toast={toast} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function CorrectForm({ record, tz, initial, toast, onClose, onDone }: {
  record: AttendanceRecord
  tz: string
  initial: { inTime: string; outTime: string; nextDay: boolean; reason: string }
  toast: ReturnType<typeof useToast>
  onClose: () => void
  onDone: () => void
}) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ inTime?: string; reason?: string }>({})
  const submit = async () => {
    const e: typeof errors = {}
    if (!v.inTime) e.inTime = 'Set the check-in time.'
    if (!v.reason.trim()) e.reason = 'Say why you are changing this record.'
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    setError(null)
    try {
      await attendanceApi.correct(record.id, {
        check_in_at: wallToUtc(record.work_date, v.inTime, tz),
        ...(v.outTime ? { check_out_at: wallToUtc(v.nextDay ? nextDay(record.work_date) : record.work_date, v.outTime, tz) } : {}),
        reason: v.reason.trim(),
      })
      toast.success('Record corrected. The change is in its history.')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the correction.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">
        {record.employee.name}, {formatDay(record.work_date)}. Times are in {tz}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Check in" type="time" required value={v.inTime} error={errors.inTime} onChange={(e) => setV({ ...v, inTime: e.target.value })} />
        <Input label="Check out" type="time" value={v.outTime} hint="Leave empty to keep it open" onChange={(e) => setV({ ...v, outTime: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-navy-900">
        <input type="checkbox" checked={v.nextDay} onChange={(e) => setV({ ...v, nextDay: e.target.checked })} className="size-4 rounded border-slate-300" />
        The check-out is on the next day (overnight shift)
      </label>
      <Textarea label="Reason" required rows={3} maxLength={500} value={v.reason} error={errors.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy}>Save correction</Button>
      </div>
    </form>
  )
}

/** HR adds a record for a day with none. It is marked as entered by HR, with the reason. */
export function AddRecordDialog({ open, tz, onClose, onDone }: { open: boolean; tz: string; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add an attendance record">
      {open && <AddForm tz={tz} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function AddForm({ tz, onClose, onDone }: { tz: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [who, setWho] = useState<PickedEmployee | null>(null)
  const [v, setV] = useState({ day: '', inTime: '09:00', outTime: '', nextDay: false, reason: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const e: Record<string, string> = {}
    if (!who) e.who = 'Choose the employee.'
    if (!v.day) e.day = 'Choose the day.'
    if (!v.inTime) e.inTime = 'Set the check-in time.'
    if (v.outTime && v.inTime && !v.nextDay && v.outTime <= v.inTime) e.outTime = 'The check-out must be after the check-in.'
    if (!v.reason.trim()) e.reason = 'Say why you are adding this record.'
    setErrors(e)
    if (Object.keys(e).length || !who) return
    setBusy(true)
    setError(null)
    try {
      await attendanceApi.addRecord({
        employee_id: who.id,
        work_date: v.day,
        check_in_at: wallToUtc(v.day, v.inTime, tz),
        check_out_at: v.outTime ? wallToUtc(v.nextDay ? nextDay(v.day) : v.day, v.outTime, tz) : null,
        reason: v.reason.trim(),
      })
      toast.success('Record added.')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the record.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="space-y-4">
      <EmployeePicker value={who} onChange={setWho} error={errors.who} />
      <Input label="Day" type="date" required value={v.day} error={errors.day} onChange={(e) => setV({ ...v, day: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Check in" type="time" required value={v.inTime} error={errors.inTime} hint={`Times are in ${tz}`} onChange={(e) => setV({ ...v, inTime: e.target.value })} />
        <Input label="Check out" type="time" value={v.outTime} error={errors.outTime} onChange={(e) => setV({ ...v, outTime: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-navy-900">
        <input type="checkbox" checked={v.nextDay} onChange={(e) => setV({ ...v, nextDay: e.target.checked })} className="size-4 rounded border-slate-300" />
        The check-out is on the next day (overnight shift)
      </label>
      <Textarea label="Reason" required rows={3} maxLength={500} value={v.reason} error={errors.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy}>Add record</Button>
      </div>
    </form>
  )
}

/** Every change ever made to a record: who, when, why, and what it was before. */
export function CorrectionsDialog({ record, onClose }: { record: AttendanceRecord | null; onClose: () => void }) {
  return (
    <Modal open={record !== null} onClose={onClose} title="Correction history" wide footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {record && <CorrectionsList record={record} />}
    </Modal>
  )
}

function CorrectionsList({ record }: { record: AttendanceRecord }) {
  const { data, error, loading, reload } = useQuery((s) => attendanceApi.corrections(record.id, s), `corrections-${record.id}`)
  if (loading && !data) return <p role="status" className="flex items-center gap-2"><Spinner className="size-4" /> Loading…</p>
  if (error && !data) return <p role="alert" className="text-rose-600">{error.message} <button type="button" onClick={reload} className="font-medium underline">Retry</button></p>
  if (!data || data.length === 0) return <p>No one has changed this record. It is exactly as it was recorded.</p>
  const time = (v: unknown, tz: string) => (typeof v === 'string' ? formatClock(v, tz) : 'still open')
  return (
    <ol aria-label="Corrections" className="space-y-3">
      {data.map((c) => (
        <li key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-medium text-navy-900">
            {c.kind === 'created' ? 'Added by' : 'Changed by'} {c.actor?.email ?? 'a former user'} <span className="font-normal text-slate-500">on {formatDateTime(c.created_at)}</span>
          </p>
          <p className="mt-1 text-slate-600">Reason: {c.reason}</p>
          <p className="mt-1 text-slate-600">
            {c.before ? `Before: ${time(c.before.check_in_at, record.timezone)} to ${time(c.before.check_out_at, record.timezone)}. ` : ''}
            Now: {time(c.after.check_in_at, record.timezone)} to {time(c.after.check_out_at, record.timezone)}.
          </p>
        </li>
      ))}
    </ol>
  )
}
