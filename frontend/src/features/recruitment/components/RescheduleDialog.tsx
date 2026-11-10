import { useState } from 'react'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Input, Select, Textarea } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import type { Interview } from '../../../types/interview'
import { dayOf, formatRange, minutesBetween, timeOf, zoneOptions } from '../lib/interviews'

interface Props {
  interview: Interview | null
  onClose: () => void
  /** Receives the NEW interview. */
  onRescheduled: (next: Interview) => void
}

export function RescheduleDialog({ interview, onClose, onRescheduled }: Props) {
  return (
    <Modal open={interview !== null} onClose={onClose} title="Reschedule interview">
      {interview && <Body key={interview.id} interview={interview} onClose={onClose} onRescheduled={onRescheduled} />}
    </Modal>
  )
}

function Body({ interview, onClose, onRescheduled }: { interview: Interview } & Omit<Props, 'interview'>) {
  const toast = useToast()
  const [date, setDate] = useState(dayOf(interview.starts_local))
  const [start, setStart] = useState(timeOf(interview.starts_local))
  const [end, setEnd] = useState(timeOf(interview.ends_local))
  const [zone, setZone] = useState(interview.timezone)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!date || !start || !end) return setError('Choose the date and both times.')
    if (minutesBetween(start, end) <= 0) return setError('The end time must be after the start time.')
    if (reason.length > 300) return setError('Keep the reason under 300 characters.')
    setBusy(true)
    setError(null)
    try {
      const next = await interviewsApi.reschedule(interview.id, {
        starts_at: `${date}T${start}`,
        ends_at: `${date}T${end}`,
        timezone: zone,
        reason: reason.trim() || null,
      })
      toast.success('Interview rescheduled. The original is kept in the history.')
      onRescheduled(next)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reschedule the interview.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
        Now: {formatRange(interview)}. The original stays on record, marked rescheduled; a new interview is created with the same
        people, and any clash is checked again.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="New date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Select label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)}>
          {zoneOptions(zone).map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </Select>
        <Input label="Starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        <Input label="Ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <Textarea label="Reason (optional)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} hint="Not stored in the audit log." />
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep the current time
        </Button>
        <Button type="submit" loading={busy}>
          Reschedule
        </Button>
      </div>
    </form>
  )
}
