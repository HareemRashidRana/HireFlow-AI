import { Link } from 'react-router-dom'
import { analyticsApi } from '../../../api/analytics'
import { usersApi } from '../../../api/users'
import { workforceAnalyticsApi } from '../../../api/workforce'
import { roleLabels } from '../../../auth/permissions'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useApiHealth } from '../../../hooks/useApiHealth'
import { useQuery } from '../../../hooks/useQuery'
import type { UserRole } from '../../../types/auth'
import { browserZone } from '../../dashboard/lib/dashboard'
import { PageHeader, Stat } from '../../workforce/components/Shared'
import { roles } from '../lib/roles'

const healthText = { checking: 'Checking…', online: 'Connected', degraded: 'Database unreachable', offline: 'Offline' }

function Loading({ what }: { what: string }) {
  return <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading {what}…</p>
}

function RoleStat({ role }: { role: UserRole }) {
  const q = useQuery((s) => usersApi.list({ role, page_size: 1 }, s), `admin-users-${role}`)
  return <Stat label={roleLabels[role]} value={q.data ? q.data.total : '…'} />
}

function Accounts() {
  const total = useQuery((s) => usersApi.list({ page_size: 1 }, s), 'admin-users-total')
  const inactive = useQuery((s) => usersApi.list({ is_active: false, page_size: 1 }, s), 'admin-users-inactive')
  const failed = total.error ?? inactive.error
  if (failed && !total.data) return <Card><ErrorState title="Couldn't load accounts" message={failed.message} onRetry={() => { total.reload(); inactive.reload() }} /></Card>
  if (!total.data || !inactive.data) return <Loading what="accounts" />
  return (
    <dl aria-label="Accounts" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Stat label="Accounts" value={total.data.total} hint={`${total.data.total - inactive.data.total} active`} />
      <Stat label="Inactive" value={inactive.data.total} hint="Cannot sign in" />
      {roles.map((r) => (
        <RoleStat key={r} role={r} />
      ))}
    </dl>
  )
}

function Organisation() {
  const o = useQuery((s) => analyticsApi.overview({ timezone: browserZone() }, s), 'admin-org')
  const w = useQuery((s) => workforceAnalyticsApi.overview(s), 'admin-workforce')
  return (
    <div className="space-y-4">
      {o.error && !o.data ? (
        <Card><ErrorState title="Couldn't load company figures" message={o.error.message} onRetry={o.reload} /></Card>
      ) : !o.data ? (
        <Loading what="company figures" />
      ) : (
        <dl aria-label="Company" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Employees" value={o.data.kpis.total_employees} hint={`${o.data.kpis.active_employees} active`} />
          <Stat label="Candidates" value={o.data.kpis.total_candidates} />
          <Stat label="Open jobs" value={o.data.kpis.open_jobs} hint={`${o.data.kpis.closed_jobs} closed`} />
          <Stat label="Upcoming interviews" value={o.data.kpis.upcoming_interviews} />
        </dl>
      )}
      {w.error && !w.data ? (
        <Card><ErrorState title="Couldn't load today's attendance" message={w.error.message} onRetry={w.reload} /></Card>
      ) : w.data ? (
        <dl aria-label="Today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Present today" value={w.data.present} hint={w.data.is_working_day ? `of ${w.data.expected} expected` : 'Not a working day'} />
          <Stat label="On approved leave" value={w.data.on_leave} />
          <Stat label="Pending leave requests" value={w.data.pending_leave_requests} />
          <Stat label="Late today" value={w.data.late} />
        </dl>
      ) : (
        <Loading what="today" />
      )}
    </div>
  )
}

const shortcuts = [
  { to: '/admin/users', title: 'Users & accounts', text: 'Create accounts, set roles, switch access off.' },
  { to: '/admin/roles', title: 'Roles & permissions', text: 'See exactly what each role can do.' },
  { to: '/admin/settings', title: 'Company settings', text: 'Time zone, working week, holidays, leave types.' },
  { to: '/dashboard', title: 'System reports', text: 'Recruitment analytics and workforce figures.' },
  { to: '/recruitment/privacy', title: 'Data privacy', text: 'Retention, export and anonymisation of candidate data.' },
]

/** Administrator's landing page: accounts, the company at a glance, and where the system is configured. */
export function AdminOverviewPage() {
  const health = useApiHealth()
  return (
    <>
      <PageHeader title="System overview" subtitle="Accounts, the company at a glance, and the settings that apply to everyone." />
      <div className="space-y-8">
        <section aria-label="System status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-5 py-3 text-sm shadow-card">
          <span className={`size-2.5 rounded-full ${health === 'online' ? 'bg-emerald-500' : health === 'checking' ? 'bg-slate-400' : 'bg-rose-500'}`} aria-hidden="true" />
          <span className="font-medium text-navy-900">System status:</span>
          <span className="text-slate-600">{healthText[health]}</span>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Accounts</h2>
          <Accounts />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Company</h2>
          <Organisation />
        </section>
        <section aria-label="Administration shortcuts">
          <Card>
            <CardHeader title="Administration" />
            <ul className="divide-y divide-slate-100">
              {shortcuts.map((s) => (
                <li key={s.to}>
                  <Link to={s.to} className="flex flex-wrap items-center justify-between gap-1 px-5 py-3 hover:bg-lavender-50/60 sm:px-6">
                    <span className="text-sm font-medium text-navy-900">{s.title}</span>
                    <span className="text-xs text-slate-500">{s.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </>
  )
}
