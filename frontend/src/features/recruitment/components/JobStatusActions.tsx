import { useState } from 'react'
import { jobsApi } from '../../../api/jobs'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import type { Job } from '../../../types/job'
import { statusActions } from '../lib/jobStatus'
import type { StatusAction } from '../lib/jobStatus'

interface Props {
  job: Job
  /** Called with the updated job after a successful change. */
  onChanged: (job: Job) => void
}

/** The buttons for the moves allowed from the job's current status. Closing asks first. */
export function JobStatusActions({ job, onChanged }: Props) {
  const toast = useToast()
  const [pending, setPending] = useState<StatusAction | null>(null) // the action being confirmed
  const [busy, setBusy] = useState<string | null>(null) // the target status currently saving

  const run = async (action: StatusAction) => {
    setBusy(action.to)
    try {
      const updated = await jobsApi.changeStatus(job.id, action.to)
      toast.success(action.success)
      setPending(null)
      onChanged(updated)
    } catch (err) {
      // e.g. "Add a description before opening this job" (422) or a 409 if someone else moved it
      toast.error(err instanceof Error ? err.message : 'Could not change the job status.')
      setPending(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {statusActions(job.status).map((action) => (
        <Button
          key={action.to}
          variant={action.primary ? 'primary' : 'secondary'}
          loading={busy === action.to && !action.confirm}
          disabled={busy !== null}
          onClick={() => (action.confirm ? setPending(action) : run(action))}
        >
          {action.label}
        </Button>
      ))}

      <Modal
        open={pending !== null}
        onClose={() => busy === null && setPending(null)}
        title="Close this job?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy !== null}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={busy === 'closed'}
              onClick={() => pending && run(pending)}
            >
              Close job
            </Button>
          </>
        }
      >
        <p>
          <strong className="text-navy-900">{job.title}</strong> will stop accepting new candidates and
          become read-only. You can reopen it at any time.
        </p>
      </Modal>
    </>
  )
}
