import { useState } from 'react'
import { ApiError } from '../../../api/errors'
import { resumesApi } from '../../../api/resumes'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import type { Resume } from '../../../types/resume'

interface Props {
  resume: Resume | null
  onClose: () => void
  onDeleted: (resume: Resume) => void
}

/** Deleting removes the stored file and what was read from it. It cannot be undone. */
export function DeleteResumeDialog({ resume, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (deleting) return
    setError(null)
    onClose()
  }

  const confirm = async () => {
    if (!resume) return
    setDeleting(true)
    setError(null)
    try {
      await resumesApi.remove(resume.id)
      onDeleted(resume)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete this resume.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={resume !== null}
      onClose={close}
      title="Delete this resume?"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={deleting}>
            Delete resume
          </Button>
        </>
      }
    >
      {resume && (
        <div className="space-y-3">
          <p>
            You are about to permanently delete version {resume.version_number}
            {resume.is_active ? ' (the active resume)' : ''}:{' '}
            <strong className="text-navy-900 [overflow-wrap:anywhere]">{resume.original_filename}</strong>. The file and
            everything read from it are removed. This cannot be undone.
          </p>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  )
}
