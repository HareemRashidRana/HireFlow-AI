import { useState } from 'react'
import { ApiError } from '../../../api/errors'
import { candidatesApi } from '../../../api/candidates'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import type { Candidate } from '../../../types/candidate'

interface Props {
  candidate: Candidate | null
  onClose: () => void
  /** Called after the candidate was deleted successfully. */
  onDeleted: (candidate: Candidate) => void
}

export function DeleteCandidateDialog({ candidate, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (deleting) return
    setError(null)
    onClose()
  }

  const confirm = async () => {
    if (!candidate) return
    setDeleting(true)
    setError(null)
    try {
      await candidatesApi.remove(candidate.id)
      onDeleted(candidate)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete this candidate.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={candidate !== null}
      onClose={close}
      title="Delete candidate?"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={deleting}>
            Delete candidate
          </Button>
        </>
      }
    >
      {candidate && (
        <div className="space-y-3">
          <p>
            You are about to permanently delete{' '}
            <strong className="text-navy-900">
              {candidate.first_name} {candidate.last_name}
            </strong>
            . This cannot be undone. Use this for records created by mistake.
          </p>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  )
}
