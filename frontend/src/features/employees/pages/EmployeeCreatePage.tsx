import { useNavigate } from 'react-router-dom'
import { employeesApi } from '../../../api/employees'
import { PageHeader } from '../../../components/layout/PageHeader'
import { useToast } from '../../../components/ui/Toast'
import { fullName } from '../../../lib/format'
import { EmployeeForm } from '../components/EmployeeForm'
import { buildCreatePayload, emptyValues } from '../lib/formValues'

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const toast = useToast()

  return (
    <>
      <PageHeader title="Add employee" description="Create a new employee record." />
      <EmployeeForm
        initialValues={emptyValues}
        submitLabel="Create employee"
        cancelTo="/employees"
        onSubmit={async (values) => {
          const created = await employeesApi.create(buildCreatePayload(values))
          toast.success(`${fullName(created)} was added.`)
          navigate(`/employees/${created.id}`)
        }}
      />
    </>
  )
}
