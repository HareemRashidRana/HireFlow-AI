import { useNavigate } from 'react-router-dom'
import { candidatesApi } from '../../../api/candidates'
import { PageHeader } from '../../../components/layout/PageHeader'
import { useToast } from '../../../components/ui/Toast'
import { CandidateForm } from '../components/CandidateForm'
import { buildCandidateCreatePayload, emptyCandidateValues } from '../lib/candidateFormValues'

export function CandidateCreatePage() {
  const navigate = useNavigate()
  const toast = useToast()

  return (
    <>
      <PageHeader
        title="Add candidate"
        description="Candidates are separate from employees. Someone becomes an employee only after being hired."
      />
      <CandidateForm
        initialValues={emptyCandidateValues()}
        submitLabel="Add candidate"
        cancelTo="/recruitment/candidates"
        onSubmit={async (values) => {
          const created = await candidatesApi.create(buildCandidateCreatePayload(values))
          toast.success('Candidate added.')
          navigate(`/recruitment/candidates/${created.id}`)
        }}
      />
    </>
  )
}
