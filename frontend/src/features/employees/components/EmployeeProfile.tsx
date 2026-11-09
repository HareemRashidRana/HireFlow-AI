import type { ReactNode } from 'react'
import { Avatar } from '../../../components/ui/Avatar'
import { Card, CardHeader } from '../../../components/ui/Card'
import { MailIcon, PhoneIcon } from '../../../components/ui/icons'
import {
  employmentTypeLabels,
  formatDate,
  formatDateTime,
  fullName,
  initials,
} from '../../../lib/format'
import type { Employee } from '../../../types/employee'
import { StatusBadge, TypeBadge } from './StatusBadge'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  )
}

interface Props {
  employee: Employee
  /** Buttons in the header card (Edit / Delete). Omit for a read-only view. */
  actions?: ReactNode
  /** How the manager is shown (a link, a placeholder...). Decided by the page. */
  manager: ReactNode
}

/** The employee "profile" layout, shared by the staff detail page and the employee's own page. */
export function EmployeeProfile({ employee, actions, manager }: Props) {
  return (
    <>
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
          {actions && <div className="flex gap-2">{actions}</div>}
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
            <Detail label="Manager">{manager}</Detail>
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
    </>
  )
}
