import { employeesApi } from '../../../api/employees'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { UserIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { EmployeeProfile } from '../components/EmployeeProfile'

/** The signed-in user's own employee record (read-only). Works for every role with a linked record. */
export function ProfilePage() {
  const { data: employee, error, loading, reload } = useQuery((s) => employeesApi.getMine(s), 'me')

  if (loading && !employee)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading your profile…
      </div>
    )

  if (error && !employee) {
    if (error.status === 404) {
      return (
        <>
          <PageHeader title="My profile" />
          <Card>
            <EmptyState
              icon={<UserIcon className="size-7" />}
              title="No employee record is linked to your account"
              description="Ask HR or an administrator to link your account to your employee record."
            />
          </Card>
        </>
      )
    }
    return (
      <Card>
        <ErrorState title="Couldn't load your profile" message={error.message} onRetry={reload} />
      </Card>
    )
  }
  if (!employee) return null

  return (
    <EmployeeProfile
      employee={employee}
      manager={<span className="text-slate-400">{employee.manager_id ? 'Assigned' : 'No manager'}</span>}
    />
  )
}
