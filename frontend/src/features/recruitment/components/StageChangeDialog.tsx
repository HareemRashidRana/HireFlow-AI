import { useState } from 'react'
import { applicationsApi } from '../../../api/applications'
import { ApiError } from '../../../api/errors'
import { Alert } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Textarea } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import type { Application, ApplicationListItem, ApplicationStage } from '../../../types/application'
import { defaultTarget, stageLabels, stageShortHelp } from '../lib/applicationStages'

type Target = Pick<ApplicationListItem, 'id' | 'stage' | 'allowed_stages' | 'candidate'>

interface Props {
  application: Target | null // null = closed
  onClose: () => void
  /** The server accepted the move. */
  onChanged: (updated: Application) => void
  /** The server refused with 409: the data on screen is probably out of date. */
  onStale?: () => void
}

const confirmLabel = (target: ApplicationStage): string =>
  target === 'rejected'
    ? 'Reject application'
    : target === 'withdrawn'
      ? 'Withdraw application'
      : target === 'hired'
        ? 'Mark as hired'
        : `Move to ${stageLabels[target]}`

/**
 * Pick the next stage for an application. The choices are exactly what the server said is allowed
 * (`allowed_stages`); the server still checks the move again when it is submitted.
 */
export function StageChangeDialog({ application, onClose, onChanged, onStale }: Props) {
  // Re-mounted for each application, so the form always starts fresh.
  return (
    <Modal open={application !== null} onClose={onClose} title="Change stage">
      {application && (
        <Form key={application.id} application={application} onClose={onClose} onChanged={onChanged} onStale={onStale} />
      )}
    </Modal>
  )
}

function Form({ application, onClose, onChanged, onStale }: Props & { application: Target }) {
  const toast = useToast()
  const allowed = application.allowed_stages
  const [target, setTarget] = useState<ApplicationStage | null>(defaultTarget(application.stage, allowed))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)

  const name = `${application.candidate.first_name} ${application.candidate.last_name}`

  const submit = async () => {
    if (!target) return
    const trimmed = note.trim()
    if (target === 'rejected' && !trimmed) {
      setNoteError('Give a reason for rejecting this application.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await applicationsApi.changeStage(application.id, target, trimmed || undefined)
      toast.success(
        target === 'hired' ? `${name} marked as hired.` : `${name} is now ${stageLabels[target].toLowerCase()}.`,
      )
      onChanged(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the stage.')
      if (err instanceof ApiError && err.status === 409) onStale?.()
    } finally {
      setBusy(false)
    }
  }

  if (allowed.length === 0) {
    return (
      <>
        <p>No further moves are available for this application.</p>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    )
  }

  return (
    <form
      noValidate // our own check (below) shows a clearer message than the browser's bubble
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p>
        <strong className="text-navy-900">{name}</strong> is in{' '}
        <strong className="text-navy-900">{stageLabels[application.stage]}</strong>. Where should the
        application go next?
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">New stage</legend>
        {allowed.map((stage) => (
          <label
            key={stage}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${
              target === stage
                ? 'border-lavender-400 bg-lavender-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="stage"
              value={stage}
              checked={target === stage}
              onChange={() => {
                setTarget(stage)
                setNoteError(null)
              }}
              className="mt-1 accent-lavender-600"
            />
            <span>
              <span className="block font-medium text-navy-900">{stageLabels[stage]}</span>
              <span className="block text-xs text-slate-500">{stageShortHelp[stage]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {target === 'hired' && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          This records a hiring decision made by you. It cannot be undone.
        </p>
      )}

      <div className="mt-4">
        <Textarea
          label={target === 'rejected' ? 'Reason for rejecting' : 'Note (optional)'}
          required={target === 'rejected'}
          value={note}
          maxLength={500}
          onChange={(e) => {
            setNote(e.target.value)
            setNoteError(null)
          }}
          error={noteError ?? undefined}
          hint="Internal. Visible to recruiting staff in the application history."
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
        <Button
          type="submit"
          variant={target === 'rejected' || target === 'withdrawn' ? 'danger' : 'primary'}
          loading={busy}
          disabled={!target}
        >
          {target ? confirmLabel(target) : 'Choose a stage'}
        </Button>
      </div>
    </form>
  )
}
