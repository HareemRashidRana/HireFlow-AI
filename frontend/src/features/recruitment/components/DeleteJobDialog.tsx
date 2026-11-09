import { useState } from 'react'
import { jobsApi } from '../../../api/jobs'
import { ApiError } from '../../../api/errors'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import type { Job } from '../../../types/job'

interface Props {
  job: Job | null
  onClose: () => void
  /** Called after the job was deleted successfully. */
  onDeleted: (job: Job) => void
}

export function DeleteJobDialog({ job, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (deleting) return
    setError(null)
    onClose()
  }

  const confirm = async () => {
    if (!job) return
    setDeleting(true)
    setError(null)
    try {
      await jobsApi.remove(job.id)
      onDeleted(job)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete this job.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      open={job !== null}
      onClose={close}
      title="Delete draft job?"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={deleting}>
            Delete draft
          </Button>
        </>
      }
    >
      {job && (
        <div className="space-y-3">
          <p>
            You are about to permanently delete the draft <strong className="text-navy-900">{job.title}</strong>.
            This cannot be undone. Jobs that were published can only be closed.
          </p>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  )
}
