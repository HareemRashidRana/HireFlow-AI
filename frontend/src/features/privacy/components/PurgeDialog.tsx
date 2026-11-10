import { useState } from 'react'
import { privacyApi } from '../../../api/privacy'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { PurgeResult } from '../../../types/privacy'

const CONFIRM_WORD = 'PURGE'

interface Props {
  open: boolean
  onClose: () => void
  /** A real deletion happened: refresh the lists behind the dialog. */
  onDone: () => void
}

/**
 * Review what a retention purge would delete (a dry run: nothing changes). Deleting for real is
 * for administrators only, only when the deployment has switched it on, and needs the typed word.
 * Candidates who have applications are never deleted: the dialog says so and points to anonymizing.
 */
export function PurgeDialog({ open, onClose, onDone }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Review expired candidates">
      {open && <Body onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function Body({ onClose, onDone }: Omit<Props, 'open'>) {
  const { can } = useAuth()
  const toast = useToast()
  const preview = useQuery(() => privacyApi.purgePreview(), 'purge-preview')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PurgeResult | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await privacyApi.purge(typed)
      setResult(r)
      toast.success(`${r.deleted} candidate${r.deleted === 1 ? '' : 's'} permanently deleted.`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The deletion did not run.')
    } finally {
      setBusy(false)
    }
  }

  if (result)
    return (
      <>
        <p>
          <strong className="text-navy-900">{result.deleted}</strong> candidate{result.deleted === 1 ? ' was' : 's were'}{' '}
          permanently deleted. {result.remaining_eligible > 0 ? `${result.remaining_eligible} more are still eligible: run it again to continue.` : 'No more are eligible.'}
        </p>
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </>
    )

  if (preview.loading && !preview.data)
    return (
      <p className="flex items-center gap-3 py-6 text-sm text-slate-500">
        <Spinner /> Checking who is eligible…
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

  const canDelete = can('privacy:purge') && p.purge_enabled && p.eligible_total > 0

  return (
    <>
      <p>
        <strong className="text-navy-900">{p.eligible_total}</strong> candidate{p.eligible_total === 1 ? '' : 's'} are
        past their retention date and hold no applications, so {p.eligible_total === 1 ? 'it' : 'they'} could be
        permanently deleted{p.eligible_total > p.batch_size ? ` (${p.batch_size} at a time)` : ''}.
      </p>

      {p.expired_with_applications > 0 && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          {p.expired_with_applications} expired candidate{p.expired_with_applications === 1 ? ' has' : 's have'} hiring
          history. They are never deleted: anonymize them from the list instead.
        </p>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Reviewing changes nothing. Deleting is permanent and is recorded in the audit log without any personal data.
        Whether and when to delete is a decision for your organisation; this tool does not make it legally compliant by
        itself.
      </p>

      {!p.purge_enabled && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          Permanent deletion is switched off for this deployment (it is off by default). It can only be enabled by
          whoever runs the server.
        </p>
      )}
      {p.purge_enabled && !can('privacy:purge') && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          Only administrators can permanently delete candidates.
        </p>
      )}

      {canDelete && (
        <div className="mt-4">
          <label htmlFor="purge-confirm" className="mb-1.5 block text-sm font-medium text-navy-800">
            Type {CONFIRM_WORD} to confirm
          </label>
          <input
            id="purge-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm shadow-sm focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none"
          />
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Close
        </Button>
        {canDelete && (
          <Button
            variant="danger"
            loading={busy}
            disabled={typed !== CONFIRM_WORD}
            onClick={() => void run()}
          >
            Permanently delete {Math.min(p.eligible_total, p.batch_size)}
          </Button>
        )}
      </div>
    </>
  )
}
