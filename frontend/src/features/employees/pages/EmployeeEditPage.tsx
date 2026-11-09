import { Link, useNavigate, useParams } from 'react-router-dom'
import { employeesApi } from '../../../api/employees'
import { PageHeader } from '../../../components/layout/PageHeader'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { fullName } from '../../../lib/format'
import { EmployeeForm } from '../components/EmployeeForm'
import { buildPatchPayload, toFormValues } from '../lib/formValues'

export function EmployeeEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: employee, error, loading, reload } = useQuery((s) => employeesApi.get(id, s), id)

  if (loading && !employee)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )

  if (error && !employee) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <ErrorState
        title={notFound ? 'Employee not found' : "Couldn't load employee"}
        message={notFound ? 'This employee may have been deleted.' : error.message}
        onRetry={notFound ? undefined : reload}
      />
    )
  }
  if (!employee) return null

  return (
    <>
      <PageHeader
        title={`Edit ${fullName(employee)}`}
        description={`Employee ${employee.employee_id}`}
        actions={
          <Link to={`/employees/${employee.id}`} className={buttonClasses('ghost')}>
            Back to profile
          </Link>
        }
      />
      <EmployeeForm
        initialValues={toFormValues(employee)}
        submitLabel="Save changes"
        cancelTo={`/employees/${employee.id}`}
        editingId={employee.id}
        onSubmit={async (values) => {
          const patch = buildPatchPayload(values, employee)
          if (Object.keys(patch).length === 0) {
            toast.info('No changes to save.')
            navigate(`/employees/${employee.id}`)
            return
          }
          const updated = await employeesApi.update(employee.id, patch)
          toast.success(`${fullName(updated)} was updated.`)
          navigate(`/employees/${employee.id}`)
        }}
      />
    </>
  )
}
