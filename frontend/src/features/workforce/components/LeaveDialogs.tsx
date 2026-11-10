import { useState } from 'react'
import { leaveApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Textarea } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { LeaveRequest } from '../../../types/workforce'
import { formatDays, formatRange } from '../lib/workforce'

const eventText: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
}

function Summary({ r }: { r: LeaveRequest }) {
  return (
    <p className="text-sm text-slate-600">
      <span className="font-medium text-navy-900">{r.employee.name}</span>: {r.leave_type.name}, {formatRange(r.start_date, r.end_date)} ({formatDays(r.days)}).
    </p>
  )
}

/** Approve (note optional) or reject (reason required). The server also refuses your own request. */
export function DecisionDialog({
  request,
  mode,
  onClose,
  onDone,
}: {
  request: LeaveRequest | null
  mode: 'approve' | 'reject' | null
  onClose: () => void
  onDone: () => void
}) {
  return (
    <Modal open={request !== null && mode !== null} onClose={onClose} title={mode === 'reject' ? 'Reject leave request' : 'Approve leave request'}>
      {request && mode && <DecisionForm key={`${request.id}-${mode}`} request={request} mode={mode} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function DecisionForm({ request, mode, onClose, onDone }: { request: LeaveRequest; mode: 'approve' | 'reject'; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reject = mode === 'reject'
  const submit = async () => {
    if (reject && !reason.trim()) {
      setError('Say why you are rejecting this request.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await (reject ? leaveApi.reject(request.id, reason.trim()) : leaveApi.approve(request.id, reason.trim()))
      toast.success(reject ? 'Request rejected.' : 'Request approved.')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="space-y-4">
      <Summary r={request} />
      {request.reason && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">Reason given: {request.reason}</p>}
      <Textarea
        label={reject ? 'Reason for rejecting' : 'Note (optional)'}
        required={reject}
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => { setReason(e.target.value); setError(null) }}
        hint="The employee can read this."
      />
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant={reject ? 'danger' : 'primary'} loading={busy}>{reject ? 'Reject request' : 'Approve request'}</Button>
      </div>
    </form>
  )
}

/** Cancel approved leave that has not started; the days go back to the balance. */
export function CancelLeaveDialog({ request, own, onClose, onDone }: { request: LeaveRequest | null; own: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={request !== null} onClose={onClose} title="Cancel approved leave">
      {request && <CancelForm key={request.id} request={request} own={own} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function CancelForm({ request, own, onClose, onDone }: { request: LeaveRequest; own: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!own && !reason.trim()) {
      setError('Say why you are cancelling this leave.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await leaveApi.cancel(request.id, reason.trim())
      toast.success('Leave cancelled. The days were returned to the balance.')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="space-y-4">
      <Summary r={request} />
      <p className="text-sm text-slate-600">The {formatDays(request.days)} will go back to the balance. Leave that has already started cannot be cancelled.</p>
      <Textarea label={own ? 'Reason (optional)' : 'Reason'} required={!own} rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }} />
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Keep the leave</Button>
        <Button type="submit" variant="danger" loading={busy}>Cancel leave</Button>
      </div>
    </form>
  )
}

/** Who did what to a request, and why. */
export function LeaveHistoryDialog({ request, onClose }: { request: LeaveRequest | null; onClose: () => void }) {
  return (
    <Modal open={request !== null} onClose={onClose} title="Request history" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {request && <HistoryList request={request} />}
    </Modal>
  )
}

function HistoryList({ request }: { request: LeaveRequest }) {
  const { data, error, loading, reload } = useQuery((s) => leaveApi.history(request.id, s), `leave-history-${request.id}`)
  if (loading && !data) return <p role="status" className="flex items-center gap-2"><Spinner className="size-4" /> Loading…</p>
  if (error && !data) return <p role="alert" className="text-rose-600">{error.message} <button type="button" onClick={reload} className="font-medium underline">Retry</button></p>
  return (
    <ol aria-label="History" className="space-y-3">
      {(data ?? []).map((e, i) => (
        <li key={i} className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-medium text-navy-900">
            {eventText[e.event_type] ?? e.event_type} <span className="font-normal text-slate-500">by {e.actor_email ?? 'a former user'}, {formatDateTime(e.created_at)}</span>
          </p>
          {e.note && <p className="mt-1 text-slate-600">{e.note}</p>}
        </li>
      ))}
    </ol>
  )
}
