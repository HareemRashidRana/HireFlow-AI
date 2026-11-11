import { useState } from 'react'
import { usersApi } from '../../../api/users'
import { useAuth } from '../../../auth/useAuth'
import { roleLabels } from '../../../auth/permissions'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { Input, Select } from '../../../components/ui/Field'
import { PlusIcon, UsersIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { UserRole } from '../../../types/auth'
import type { ManagedUser } from '../../../types/user'
import { Flag, PageHeader, Pager } from '../../workforce/components/Shared'
import { roles } from '../lib/roles'
import { CreateUserDialog, ManageUserDialog } from './UserDialogs'

const PAGE_SIZE = 15

/** Administrator: every account, with its role and status. */
export function UsersPage() {
  const { user: me } = useAuth()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<ManagedUser | null>(null)

  const params = { q: q.trim() || undefined, role: role || undefined, is_active: status === '' ? undefined : status === 'active' }
  const list = useQuery((s) => usersApi.list({ ...params, page, page_size: PAGE_SIZE }, s), `users-${JSON.stringify(params)}-${page}-${refresh}`)
  const filtered = q.trim() !== '' || role !== '' || status !== ''

  return (
    <>
      <PageHeader
        title="Users & accounts"
        subtitle="Create accounts, set roles and switch access on or off. Passwords are never shown."
        action={<Button onClick={() => setCreating(true)}><PlusIcon className="size-4" /> New user</Button>}
      />
      <div className="space-y-6">
        <form role="search" aria-label="Filter users" onSubmit={(e) => e.preventDefault()} className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:grid-cols-[1fr_12rem_12rem]">
          <Input label="Search by email" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          <Select label="Role" value={role} onChange={(e) => { setRole(e.target.value as UserRole | ''); setPage(1) }}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
          </Select>
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as '' | 'active' | 'inactive'); setPage(1) }}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </form>

        <Card>
          {list.loading && !list.data ? (
            <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading users…</p>
          ) : list.error && !list.data ? (
            <ErrorState title="Couldn't load users" message={list.error.message} onRetry={list.reload} />
          ) : list.data && list.data.items.length === 0 ? (
            <EmptyState icon={<UsersIcon className="size-7" />} title={filtered ? 'No users match' : 'No users yet'} description={filtered ? 'Try clearing a filter.' : 'Create the first account with New user.'} />
          ) : list.data ? (
            <>
              <ul aria-label="Users" className="divide-y divide-slate-100">
                {list.data.items.map((u) => (
                  <li key={u.id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[1.6fr_1fr_1fr_1.2fr_auto] lg:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-navy-900">{u.email}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}</span>
                      <span className="block text-xs text-slate-500">{u.employee_id ? 'Linked to an employee record' : 'No employee record'}</span>
                    </span>
                    <span><Flag tone="lavender">{roleLabels[u.role]}</Flag></span>
                    <span className="flex flex-wrap gap-1.5">
                      <Flag tone={u.is_active ? 'emerald' : 'slate'}>{u.is_active ? 'Active' : 'Inactive'}</Flag>
                      {u.must_change_password && <Flag tone="amber">Must change password</Flag>}
                    </span>
                    <span className="text-xs text-slate-500">{u.last_login_at ? `Signed in ${formatDateTime(u.last_login_at)}` : 'Never signed in'}</span>
                    <Button variant="secondary" size="sm" aria-label={`Manage ${u.email}`} onClick={() => setManaging(u)}>Manage</Button>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={list.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          ) : null}
        </Card>
      </div>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onDone={() => { setPage(1); setRefresh((n) => n + 1) }} />
      <ManageUserDialog user={managing} isSelf={managing?.id === me?.id} onClose={() => setManaging(null)} onDone={() => setRefresh((n) => n + 1)} />
    </>
  )
}
