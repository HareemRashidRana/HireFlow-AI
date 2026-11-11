import { useState } from 'react'
import { usersApi } from '../../../api/users'
import { roleLabels } from '../../../auth/permissions'
import { Button } from '../../../components/ui/Button'
import { Input, Select } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import type { UserRole } from '../../../types/auth'
import { roles, validateNewUser } from '../lib/roles'
import type { ManagedUser, UserUpdate } from '../../../types/user'
import { EmployeePicker } from '../../workforce/components/EmployeePicker'
import type { PickedEmployee } from '../../workforce/components/EmployeePicker'

/** A new account. The person must replace the temporary password the first time they sign in. */
export function CreateUserDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New user">
      {open && <CreateForm onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function CreateForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [v, setV] = useState({ email: '', password: '', role: 'employee' as UserRole, mustChange: true })
  const [who, setWho] = useState<PickedEmployee | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const found = validateNewUser(v)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setError(null)
    try {
      await usersApi.create({ email: v.email.trim().toLowerCase(), password: v.password, role: v.role, employee_id: who?.id ?? null, must_change_password: v.mustChange })
      toast.success('User created.')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the user.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate className="space-y-4">
      <Input label="Email" type="email" required autoComplete="off" value={v.email} error={errors.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <Select label="Role" required value={v.role} error={errors.role} onChange={(e) => setV({ ...v, role: e.target.value as UserRole })}>
        {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
      </Select>
      <Input label="Temporary password" type="password" required autoComplete="new-password" value={v.password} error={errors.password} hint="At least 12 characters. Share it securely." onChange={(e) => setV({ ...v, password: e.target.value })} />
      <EmployeePicker label="Employee record (optional)" value={who} onChange={setWho} />
      <label className="flex items-center gap-2 text-sm text-navy-900">
        <input type="checkbox" className="size-4 rounded border-slate-300" checked={v.mustChange} onChange={(e) => setV({ ...v, mustChange: e.target.checked })} />
        They must choose a new password when they first sign in
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy}>Create user</Button>
      </div>
    </form>
  )
}

/** Change a role, switch an account on or off, link an employee record, unlock, or reset the password. */
export function ManageUserDialog({ user, isSelf, onClose, onDone }: { user: ManagedUser | null; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={user !== null} onClose={onClose} title="Manage account">
      {user && <ManageForm key={user.id} user={user} isSelf={isSelf} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function ManageForm({ user, isSelf, onClose, onDone }: { user: ManagedUser; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [role, setRole] = useState<UserRole>(user.role)
  const [active, setActive] = useState(user.is_active)
  const [who, setWho] = useState<PickedEmployee | null>(user.employee_id ? { id: user.employee_id, name: 'Linked employee record' } : null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, work: () => Promise<unknown>, done: string, close: boolean) => {
    setBusy(key)
    setError(null)
    try {
      await work()
      toast.success(done)
      onDone()
      if (close) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const changes: UserUpdate = {}
  if (role !== user.role) changes.role = role
  if (active !== user.is_active) changes.is_active = active
  if ((who?.id ?? null) !== user.employee_id) changes.employee_id = who?.id ?? null
  const dirty = Object.keys(changes).length > 0
  const passwordProblem = password !== '' && password.length < 12 ? 'Use at least 12 characters.' : null

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600"><span className="font-medium text-navy-900">{user.email}</span></p>
      {isSelf && <p role="note" className="rounded-xl bg-lavender-50 px-3 py-2 text-xs text-navy-800">This is your own account, so its role and status cannot be changed here.</p>}
      <Select label="Role" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as UserRole)}>
        {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
      </Select>
      <label className="flex items-center gap-2 text-sm text-navy-900">
        <input type="checkbox" className="size-4 rounded border-slate-300" checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} />
        Account is active (turning it off signs the person out everywhere)
      </label>
      <EmployeePicker label="Employee record" allowAll value={who} onChange={setWho} />
      <div className="flex justify-end">
        <Button loading={busy === 'save'} disabled={!dirty} onClick={() => void run('save', () => usersApi.update(user.id, changes), 'Account updated.', true)}>Save changes</Button>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-navy-900">Sign-in help</h3>
        <Button variant="secondary" size="sm" loading={busy === 'unlock'} onClick={() => void run('unlock', () => usersApi.unlock(user.id), 'Account unlocked.', false)}>Unlock after failed attempts</Button>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input label="New temporary password" type="password" autoComplete="new-password" value={password} error={passwordProblem ?? undefined} hint="At least 12 characters" onChange={(e) => setPassword(e.target.value)} />
          <Button variant="secondary" loading={busy === 'reset'} disabled={password === '' || passwordProblem !== null} onClick={() => void run('reset', async () => { await usersApi.resetPassword(user.id, password); setPassword('') }, 'Password reset. They will be asked to replace it.', false)}>Reset password</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </div>
  )
}
