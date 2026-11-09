import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../../../components/ui/Avatar'
import { PencilIcon, TrashIcon } from '../../../components/ui/icons'
import { employmentTypeLabels, formatDate, fullName, initials } from '../../../lib/format'
import type { Employee } from '../../../types/employee'
import { StatusBadge, TypeBadge } from './StatusBadge'

interface Props {
  employees: Employee[]
  onDelete: (employee: Employee) => void
}

const iconBtn =
  'rounded-lg p-2 text-slate-400 transition-colors hover:bg-lavender-100 hover:text-navy-900'

function RowActions({ employee, onDelete }: { employee: Employee; onDelete: (e: Employee) => void }) {
  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Link to={`/employees/${employee.id}/edit`} aria-label={`Edit ${fullName(employee)}`} className={iconBtn}>
        <PencilIcon className="size-[18px]" />
      </Link>
      <button
        type="button"
        onClick={() => onDelete(employee)}
        aria-label={`Delete ${fullName(employee)}`}
        className={`${iconBtn} hover:!bg-rose-50 hover:!text-rose-600`}
      >
        <TrashIcon className="size-[18px]" />
      </button>
    </div>
  )
}

export function EmployeeTable({ employees, onDelete }: Props) {
  const navigate = useNavigate()

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
              <th className="px-6 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 font-medium max-xl:hidden">ID</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium max-xl:hidden">Joined</th>
              <th className="px-6 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((e) => (
              <tr
                key={e.id}
                onClick={() => navigate(`/employees/${e.id}`)}
                className="cursor-pointer transition-colors hover:bg-lavender-50/60"
              >
                <td className="px-6 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar initials={initials(e)} />
                    <div className="min-w-0">
                      <Link
                        to={`/employees/${e.id}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="block truncate font-medium text-navy-900 hover:text-lavender-600"
                      >
                        {fullName(e)}
                      </Link>
                      <span className="block truncate text-xs text-slate-500">{e.work_email}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-600 max-xl:hidden">{e.employee_id}</td>
                <td className="px-4 py-3.5">
                  <span className="block text-navy-900">{e.job_title}</span>
                  <span className="block text-xs text-slate-500">{e.department}</span>
                </td>
                <td className="px-4 py-3.5">
                  <TypeBadge label={employmentTypeLabels[e.employment_type]} />
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={e.employment_status} />
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-slate-600 max-xl:hidden">
                  {formatDate(e.date_of_joining)}
                </td>
                <td className="px-6 py-3.5">
                  <RowActions employee={e} onDelete={onDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {employees.map((e) => (
          <li key={e.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <Link to={`/employees/${e.id}`} className="flex min-w-0 items-center gap-3">
                <Avatar initials={initials(e)} />
                <div className="min-w-0">
                  <span className="block truncate font-medium text-navy-900">{fullName(e)}</span>
                  <span className="block truncate text-xs text-slate-500">{e.job_title}</span>
                </div>
              </Link>
              <RowActions employee={e} onDelete={onDelete} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={e.employment_status} />
              <TypeBadge label={employmentTypeLabels[e.employment_type]} />
              <span className="text-xs text-slate-500">
                {e.department} · {e.employee_id}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
