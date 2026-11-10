import { useState } from 'react'
import { applicationsApi } from '../../../api/applications'
import { ApiError } from '../../../api/errors'
import { Button } from '../../../components/ui/Button'
import { Textarea } from '../../../components/ui/Field'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import type { Application, ApplicationListItem } from '../../../types/application'
import { stageLabels } from '../lib/applicationStages'

type Target = Pick<ApplicationListItem, 'id' | 'stage' | 'candidate'>

interface Props {
  application: Target | null
  onClose: () => void
  onChanged: (updated: Application) => void
  onStale?: () => void
}

/** HR / admin only (the server enforces it). Sends a rejected or withdrawn application back into the pipeline. */
export function ReopenDialog({ application, onClose, onChanged, onStale }: Props) {
  return (
    <Modal open={application !== null} onClose={onClose} title="Reopen application?">
      {application && (
        <Form key={application.id} application={application} onClose={onClose} onChanged={onChanged} onStale={onStale} />
      )}
    </Modal>
  )
}

function Form({ application, onClose, onChanged, onStale }: Props & { application: Target }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = `${application.candidate.first_name} ${application.candidate.last_name}`

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await applicationsApi.reopen(application.id, note.trim() || undefined)
      toast.success(`${name}'s application was reopened.`)
      onChanged(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen the application.')
      if (err instanceof ApiError && err.status === 409) onStale?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p>
        <strong className="text-navy-900">{name}</strong>'s application is{' '}
        {stageLabels[application.stage].toLowerCase()}. Reopening puts it back at the stage it was
        {application.stage === 'rejected' ? ' rejected' : ' withdrawn'} from.
      </p>
      <div className="mt-4">
        <Textarea
          label="Note (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          hint="Internal. Recorded in the application history."
          className="!min-h-20"
        />
      </div>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Reopen application
        </Button>
      </div>
    </form>
  )
}
