import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { employeesApi } from '../../../api/employees'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { ArrowLeftIcon, MailIcon, PencilIcon, PhoneIcon, TrashIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import {
  employmentTypeLabels,
  formatDate,
  formatDateTime,
  fullName,
  initials,
} from '../../../lib/format'
import { DeleteEmployeeDialog } from '../components/DeleteEmployeeDialog'
import { StatusBadge, TypeBadge } from '../components/StatusBadge'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  )
}

export function EmployeeDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: employee, error, loading, reload } = useQuery((s) => employeesApi.get(id, s), id)

  // The API only returns manager_id, so look the manager up to show their name.
  const managerId = employee?.manager_id ?? ''
  const manager = useQuery((s) => employeesApi.get(managerId, s), `manager:${managerId}`, !!managerId)

  if (loading && !employee)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading employee…
      </div>
    )

  if (error && !employee) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState
            title={notFound ? 'Employee not found' : "Couldn't load employee"}
            message={notFound ? 'This employee may have been deleted, or the link is incorrect.' : error.message}
            onRetry={notFound ? undefined : reload}
          />
        </Card>
      </>
    )
  }
  if (!employee) return null

  return (
    <>
      <BackLink />

      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar initials={initials(employee)} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-navy-900">{fullName(employee)}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {employee.job_title} · {employee.department}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <StatusBadge status={employee.employment_status} />
                <TypeBadge label={employmentTypeLabels[employee.employment_type]} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to={`/employees/${employee.id}/edit`} className={buttonClasses('secondary')}>
              <PencilIcon className="size-4" /> Edit
            </Link>
            <Button variant="secondary" className="text-rose-600 hover:!bg-rose-50" onClick={() => setConfirmDelete(true)}>
              <TrashIcon className="size-4" /> Delete
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader title="Employment details" />
          <dl className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
            <Detail label="Employee ID">
              <span className="font-mono">{employee.employee_id}</span>
            </Detail>
            <Detail label="Job title">{employee.job_title}</Detail>
            <Detail label="Department">{employee.department}</Detail>
            <Detail label="Employment type">{employmentTypeLabels[employee.employment_type]}</Detail>
            <Detail label="Date of joining">{formatDate(employee.date_of_joining)}</Detail>
            <Detail label="Manager">
              {!employee.manager_id ? (
                <span className="text-slate-400">No manager</span>
              ) : manager.loading ? (
                <span className="text-slate-400">Loading…</span>
              ) : manager.data ? (
                <Link to={`/employees/${manager.data.id}`} className="font-medium text-lavender-600 hover:underline">
                  {fullName(manager.data)}
                </Link>
              ) : (
                <span className="text-slate-400">Unavailable</span>
              )}
            </Detail>
          </dl>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Contact" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Work email">
                <a href={`mailto:${employee.work_email}`} className="inline-flex items-center gap-2 [overflow-wrap:anywhere] hover:text-lavender-600">
                  <MailIcon className="size-4 shrink-0 text-slate-400" />
                  {employee.work_email}
                </a>
              </Detail>
              <Detail label="Phone">
                {employee.phone_number ? (
                  <a href={`tel:${employee.phone_number}`} className="inline-flex items-center gap-2 hover:text-lavender-600">
                    <PhoneIcon className="size-4 text-slate-400" />
                    {employee.phone_number}
                  </a>
                ) : (
                  <span className="text-slate-400">Not provided</span>
                )}
              </Detail>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Record" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Created">{formatDateTime(employee.created_at)}</Detail>
              <Detail label="Last updated">{formatDateTime(employee.updated_at)}</Detail>
            </dl>
          </Card>
        </div>
      </div>

      <DeleteEmployeeDialog
        employee={confirmDelete ? employee : null}
        onClose={() => setConfirmDelete(false)}
        onDeleted={(e) => {
          toast.success(`${fullName(e)} was deleted.`)
          navigate('/employees')
        }}
      />
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
