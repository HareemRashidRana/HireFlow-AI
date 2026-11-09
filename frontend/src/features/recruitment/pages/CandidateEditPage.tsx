import { Link, useNavigate, useParams } from 'react-router-dom'
import { candidatesApi } from '../../../api/candidates'
import { PageHeader } from '../../../components/layout/PageHeader'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { CandidateForm } from '../components/CandidateForm'
import { buildCandidatePatchPayload, toCandidateFormValues } from '../lib/candidateFormValues'

export function CandidateEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: candidate, error, loading, reload } = useQuery((s) => candidatesApi.get(id, s), id)

  if (loading && !candidate)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )

  if (error && !candidate) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <Card>
        <ErrorState
          title={notFound ? 'Candidate not found' : "Couldn't load the candidate"}
          message={notFound ? 'This candidate may have been deleted, or the link is incorrect.' : error.message}
          onRetry={notFound ? undefined : reload}
        />
      </Card>
    )
  }
  if (!candidate) return null

  const backTo = `/recruitment/candidates/${candidate.id}`

  if (candidate.anonymized_at) {
    return (
      <Card>
        <ErrorState title="This candidate was anonymized" message="Their personal data was erased, so the record can no longer be edited." />
        <div className="flex justify-center pb-10">
          <Link to={backTo} className={buttonClasses('primary')}>
            Back to the candidate
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title={`Edit ${candidate.first_name} ${candidate.last_name}`}
        description="Changes apply immediately."
        actions={
          <Link to={backTo} className={buttonClasses('ghost')}>
            Back to profile
          </Link>
        }
      />
      <CandidateForm
        editing
        initialValues={toCandidateFormValues(candidate)}
        submitLabel="Save changes"
        cancelTo={backTo}
        onSubmit={async (values) => {
          const patch = buildCandidatePatchPayload(values, candidate)
          if (Object.keys(patch).length === 0) {
            toast.info('No changes to save.')
            navigate(backTo)
            return
          }
          await candidatesApi.update(candidate.id, patch)
          toast.success('Candidate updated.')
          navigate(backTo)
        }}
      />
    </>
  )
}
