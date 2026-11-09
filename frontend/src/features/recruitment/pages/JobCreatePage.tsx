import { useNavigate } from 'react-router-dom'
import { jobsApi } from '../../../api/jobs'
import { PageHeader } from '../../../components/layout/PageHeader'
import { useToast } from '../../../components/ui/Toast'
import { JobForm } from '../components/JobForm'
import { buildJobCreatePayload, emptyJobValues } from '../lib/jobFormValues'

export function JobCreatePage() {
  const navigate = useNavigate()
  const toast = useToast()

  return (
    <>
      <PageHeader
        title="New job"
        description="Jobs start as drafts. Publish them when the details are ready."
      />
      <JobForm
        initialValues={emptyJobValues}
        submitLabel="Save as draft"
        cancelTo="/recruitment/jobs"
        onSubmit={async (values) => {
          const created = await jobsApi.create(buildJobCreatePayload(values))
          toast.success('Job saved as a draft.')
          navigate(`/recruitment/jobs/${created.id}`)
        }}
      />
    </>
  )
}
