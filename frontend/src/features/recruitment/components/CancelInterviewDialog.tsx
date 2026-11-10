import { useState } from 'react'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Textarea } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import type { Interview } from '../../../types/interview'
import { formatRange } from '../lib/interviews'

interface Props {
  interview: Interview | null
  onClose: () => void
  onCancelled: (next: Interview) => void
}

/** Cancelling keeps the interview and its history. It does not touch the application's stage. */
export function CancelInterviewDialog({ interview, onClose, onCancelled }: Props) {
  return (
    <Modal open={interview !== null} onClose={onClose} title="Cancel this interview?">
      {interview && <Body key={interview.id} interview={interview} onClose={onClose} onCancelled={onCancelled} />}
    </Modal>
  )
}

function Body({ interview, onClose, onCancelled }: { interview: Interview } & Omit<Props, 'interview'>) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!reason.trim()) return setError('Say why it is being cancelled.')
    if (reason.trim().length > 500) return setError('Keep the reason under 500 characters.')
    setBusy(true)
    setError(null)
    try {
      onCancelled(await interviewsApi.cancel(interview.id, reason.trim()))
      toast.success('Interview cancelled.')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the interview.')
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
      <p>
        <strong className="text-navy-900">{interview.title}</strong> with {interview.application.candidate.first_name}{' '}
        {interview.application.candidate.last_name}, {formatRange(interview)}. It stays on record as cancelled, with its history. The
        application's stage is not changed.
      </p>
      <Textarea label="Reason" required value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} hint="Visible to staff. Not stored in the audit log." />
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep the interview
        </Button>
        <Button type="submit" variant="danger" loading={busy}>
          Cancel interview
        </Button>
      </div>
    </form>
  )
}
