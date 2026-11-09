import { Link, useNavigate, useParams } from 'react-router-dom'
import { jobsApi } from '../../../api/jobs'
import { PageHeader } from '../../../components/layout/PageHeader'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { JobForm } from '../components/JobForm'
import { buildJobPatchPayload, toJobFormValues } from '../lib/jobFormValues'
import { isEditable } from '../lib/jobStatus'

export function JobEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: job, error, loading, reload } = useQuery((s) => jobsApi.get(id, s), id)

  if (loading && !job)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )

  if (error && !job) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <Card>
        <ErrorState
          title={notFound ? 'Job not found' : "Couldn't load the job"}
          message={notFound ? 'This job may have been deleted, or the link is incorrect.' : error.message}
          onRetry={notFound ? undefined : reload}
        />
      </Card>
    )
  }
  if (!job) return null

  const backTo = `/recruitment/jobs/${job.id}`

  if (!isEditable(job)) {
    return (
      <Card>
        <ErrorState
          title="This job is closed"
          message="Closed jobs are read-only. Reopen the job to edit it."
        />
        <div className="flex justify-center pb-10">
          <Link to={backTo} className={buttonClasses('primary')}>
            Back to the job
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title={`Edit ${job.title}`}
        description="Changes apply immediately."
        actions={
          <Link to={backTo} className={buttonClasses('ghost')}>
            Back to job
          </Link>
        }
      />
      <JobForm
        initialValues={toJobFormValues(job)}
        submitLabel="Save changes"
        cancelTo={backTo}
        onSubmit={async (values) => {
          const patch = buildJobPatchPayload(values, job)
          if (Object.keys(patch).length === 0) {
            toast.info('No changes to save.')
            navigate(backTo)
            return
          }
          await jobsApi.update(job.id, patch)
          toast.success('Job updated.')
          navigate(backTo)
        }}
      />
    </>
  )
}
