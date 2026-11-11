import { Link } from 'react-router-dom'
import { usersApi } from '../../../api/users'
import { GRANTS, roleHomes, roleLabels } from '../../../auth/permissions'
import type { Permission } from '../../../auth/permissions'
import { Card, CardHeader } from '../../../components/ui/Card'
import { useQuery } from '../../../hooks/useQuery'
import type { UserRole } from '../../../types/auth'
import { PageHeader } from '../../workforce/components/Shared'
import { permissionLabels, roles } from '../lib/roles'

const roleInfo: Record<UserRole, { who: string; panel: string }> = {
  admin: { who: 'Runs the system: accounts, roles, company settings and system-wide reports.', panel: 'Admin Console' },
  hr_manager: { who: 'Looks after people: employees, attendance, leave, balances and HR reports.', panel: 'HR Workspace' },
  recruiter: { who: 'Fills roles: job postings, candidates, applications, the pipeline and interviews.', panel: 'Recruiting' },
  employee: { who: 'Uses their own portal: check in and out, apply for leave, see their balance and profile.', panel: 'My Portal' },
}

const allPermissions = Object.keys(permissionLabels) as Permission[]

/**
 * Who can do what. Roles and their permissions are fixed by the application (so they can be reviewed
 * and tested), so this page explains them. To change what a person can do, change their role on the
 * Users page. The server enforces every one of these on every request.
 */
export function RolesPage() {
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Four fixed roles, each with its own panel. Assign a role to a person on the Users page." action={<Link to="/admin/users" className="text-sm font-medium text-lavender-700 underline">Go to Users & accounts</Link>} />
      <div className="space-y-6">
        <section aria-label="Roles" className="grid gap-4 sm:grid-cols-2">
          {roles.map((r) => (
            <RoleCard key={r} role={r} />
          ))}
        </section>

        <Card>
          <CardHeader title="Permission matrix" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Which role holds which permission</caption>
              <thead>
                <tr className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <th scope="col" className="px-5 pt-4 pb-2 sm:px-6">Permission</th>
                  {roles.map((r) => <th key={r} scope="col" className="px-3 pt-4 pb-2 text-center">{roleLabels[r]}</th>)}
                </tr>
              </thead>
              <tbody>
                {allPermissions.map((p) => (
                  <tr key={p} className="border-t border-slate-100">
                    <th scope="row" className="px-5 py-2.5 font-normal text-navy-900 sm:px-6">{permissionLabels[p]}</th>
                    {roles.map((r) => (
                      <td key={r} className="px-3 py-2.5 text-center">
                        {GRANTS[p].includes(r) ? <span aria-label="Allowed" className="font-semibold text-emerald-600">Yes</span> : <span aria-label="Not allowed" className="text-slate-300">No</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6">
            Everyone with a linked employee record can also use their own attendance and leave. Deciding leave and correcting attendance need the HR permission, and nobody can decide their own leave request.
          </p>
        </Card>
      </div>
    </>
  )
}

function RoleCard({ role }: { role: UserRole }) {
  const count = useQuery((s) => usersApi.list({ role, page_size: 1 }, s), `role-count-${role}`)
  const mine = allPermissions.filter((p) => GRANTS[p].includes(role))
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy-900">{roleLabels[role]}</h2>
          <p className="text-xs text-lavender-700">Panel: {roleInfo[role].panel}, home {roleHomes[role]}</p>
        </div>
        <span className="rounded-full bg-lavender-100 px-2.5 py-0.5 text-xs font-medium text-lavender-700" aria-label={`${roleLabels[role]} accounts`}>
          {count.data ? `${count.data.total} account${count.data.total === 1 ? '' : 's'}` : '…'}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{roleInfo[role].who}</p>
      <p className="mt-3 text-xs text-slate-500">{mine.length} of {allPermissions.length} permissions</p>
    </Card>
  )
}
