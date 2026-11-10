import { useState } from 'react'
import { privacyApi } from '../../../api/privacy'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'

const fieldLabels: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email address',
  phone: 'Phone number',
  location: 'Location',
  current_title: 'Current job title',
  current_company: 'Current company',
  consent_basis_note: 'Basis explanation',
  source: 'Source',
  consent_basis: 'Consent / legal basis',
  consent_date: 'Basis date',
  last_activity_at: 'Last activity',
  retain_until: 'Retention date',
  created_at: 'Date added',
}
const label = (f: string) => fieldLabels[f] ?? f

export interface AnonymizeTarget {
  id: string
  first_name: string
  last_name: string
}

interface Props {
  candidate: AnonymizeTarget | null
  onClose: () => void
  onDone: () => void
}

/** Preview, then an explicit confirmation. Anonymizing cannot be undone: nothing is kept to restore. */
export function AnonymizeDialog({ candidate, onClose, onDone }: Props) {
  return (
    <Modal open={candidate !== null} onClose={onClose} title="Anonymize this candidate?">
      {candidate && <Body key={candidate.id} candidate={candidate} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function Body({ candidate, onClose, onDone }: { candidate: AnonymizeTarget } & Omit<Props, 'candidate'>) {
  const toast = useToast()
  const preview = useQuery((s) => privacyApi.anonymizationPreview(candidate.id, s), candidate.id)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await privacyApi.anonymize(candidate.id)
      toast.success(result.changed ? 'Candidate anonymized.' : 'This candidate was already anonymized.')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not anonymize the candidate.')
    } finally {
      setBusy(false)
    }
  }

  if (preview.loading && !preview.data)
    return (
      <p className="flex items-center gap-3 py-6 text-sm text-slate-500">
        <Spinner /> Checking what would change…
      </p>
    )
  if (preview.error && !preview.data)
    return (
      <>
        <Alert>{preview.error.message}</Alert>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={preview.reload}>Try again</Button>
        </div>
      </>
    )
  const p = preview.data
  if (!p) return null

  if (p.already_anonymized)
    return (
      <>
        <p>This candidate has already been anonymized. There is nothing more to do.</p>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    )

  return (
    <>
      <p>
        You are about to anonymize{' '}
        <strong className="text-navy-900">
          {candidate.first_name} {candidate.last_name}
        </strong>
        . This is a deliberate, permanent step.
      </p>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-navy-900">Replaced with placeholders</dt>
          <dd className="text-slate-600">{p.fields_replaced.map(label).join(', ')}</dd>
        </div>
        <div>
          <dt className="font-medium text-navy-900">Removed</dt>
          <dd className="text-slate-600">{p.fields_cleared.map(label).join(', ')}</dd>
        </div>
        <div>
          <dt className="font-medium text-navy-900">Kept (not identifying)</dt>
          <dd className="text-slate-600">{p.fields_kept.map(label).join(', ')}</dd>
        </div>
        <div>
          <dt className="font-medium text-navy-900">Applications and history</dt>
          <dd className="text-slate-600">
            {p.application_count === 0
              ? 'This candidate has no applications.'
              : `${p.application_count} application${p.application_count === 1 ? '' : 's'} and every stage change are kept. Staff notes are cleared: ${p.application_notes_cleared} on applications, ${p.history_notes_cleared} in the history.`}
          </dd>
        </div>
        {p.assessments_scrubbed > 0 && (
          <div>
            <dt className="font-medium text-navy-900">Requirements Coverage</dt>
            <dd className="text-slate-600">
              {p.assessments_scrubbed === 1
                ? '1 assessment loses its resume-derived details, reviewer notes and adjustments. Its numbers are kept.'
                : `${p.assessments_scrubbed} assessments lose their resume-derived details, reviewer notes and adjustments. Their numbers are kept.`}
            </dd>
          </div>
        )}
        {p.resumes_removed > 0 && (
          <div>
            <dt className="font-medium text-navy-900">Resumes</dt>
            <dd className="text-slate-600">
              {p.resumes_removed === 1
                ? '1 resume file is permanently deleted, along with what was read from it.'
                : `${p.resumes_removed} resume files are permanently deleted, along with what was read from them.`}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        The original details are not stored anywhere else and cannot be restored. The action is recorded in the audit
        log.
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-navy-900">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          className="mt-0.5 size-4 accent-lavender-600"
        />
        I understand this cannot be undone.
      </label>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => void run()} loading={busy} disabled={!understood}>
          Anonymize candidate
        </Button>
      </div>
    </>
  )
}
