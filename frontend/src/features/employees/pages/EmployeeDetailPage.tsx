import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { employeesApi } from '../../../api/employees'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { ArrowLeftIcon, PencilIcon, TrashIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { fullName } from '../../../lib/format'
import { DeleteEmployeeDialog } from '../components/DeleteEmployeeDialog'
import { EmployeeProfile } from '../components/EmployeeProfile'

export function EmployeeDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)

  // What the UI offers. The server enforces the same rules on every request.
  const canBrowse = can('employees:read')
  const canEdit = can('employees:write')
  const canDelete = can('employees:delete')

  const { data: employee, error, loading, reload } = useQuery((s) => employeesApi.get(id, s), id)

  // The API only returns manager_id, so look the manager up to show their name. Roles that cannot
  // browse the directory are not allowed to read other records, so they skip this request.
  const managerId = employee?.manager_id ?? ''
  const manager = useQuery(
    (s) => employeesApi.get(managerId, s),
    `manager:${managerId}`,
    !!managerId && canBrowse,
  )

  if (loading && !employee)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading employee…
      </div>
    )

  if (error && !employee) {
    const notFound = error.status === 404 || error.status === 422
    const forbidden = error.status === 403
    return (
      <>
        {canBrowse && <BackLink />}
        <Card>
          <ErrorState
            title={
              forbidden ? 'You can only view your own record' : notFound ? 'Employee not found' : "Couldn't load employee"
            }
            message={
              forbidden
                ? 'Your role does not allow viewing other employees.'
                : notFound
                  ? 'This employee may have been deleted, or the link is incorrect.'
                  : error.message
            }
            onRetry={notFound || forbidden ? undefined : reload}
          />
        </Card>
      </>
    )
  }
  if (!employee) return null

  const actions =
    canEdit || canDelete ? (
      <>
        {canEdit && (
          <Link to={`/employees/${employee.id}/edit`} className={buttonClasses('secondary')}>
            <PencilIcon className="size-4" /> Edit
          </Link>
        )}
        {canDelete && (
          <Button variant="secondary" className="text-rose-600 hover:!bg-rose-50" onClick={() => setConfirmDelete(true)}>
            <TrashIcon className="size-4" /> Delete
          </Button>
        )}
      </>
    ) : undefined

  return (
    <>
      {canBrowse && <BackLink />}

      <EmployeeProfile
        employee={employee}
        actions={actions}
        manager={
          !employee.manager_id ? (
            <span className="text-slate-400">No manager</span>
          ) : !canBrowse ? (
            <span className="text-slate-400">Not shown</span>
          ) : manager.loading ? (
            <span className="text-slate-400">Loading…</span>
          ) : manager.data ? (
            <Link to={`/employees/${manager.data.id}`} className="font-medium text-lavender-600 hover:underline">
              {fullName(manager.data)}
            </Link>
          ) : (
            <span className="text-slate-400">Unavailable</span>
          )
        }
      />

      {canDelete && (
        <DeleteEmployeeDialog
          employee={confirmDelete ? employee : null}
          onClose={() => setConfirmDelete(false)}
          onDeleted={(e) => {
            toast.success(`${fullName(e)} was deleted.`)
            navigate('/employees')
          }}
        />
      )}
    </>
  )
}

function BackLink() {
  return (
    <Link
      to="/employees"
      className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-navy-900"
    >
      <ArrowLeftIcon className="size-4" /> All employees
    </Link>
  )
}
