// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { GRANTS } from '../../../auth/permissions'
import { makeOverview, makeWorkforce } from '../../../test/analyticsFixtures'
import { renderAs } from '../../../test/render'
import type { ManagedUser } from '../../../types/user'
import { permissionLabels, validateNewUser } from '../lib/roles'
import { AdminOverviewPage } from './AdminOverviewPage'
import { RolesPage } from './RolesPage'
import { UsersPage } from './UsersPage'

const users = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), unlock: vi.fn(), resetPassword: vi.fn() }))
const analytics = vi.hoisted(() => ({ overview: vi.fn() }))
const workforce = vi.hoisted(() => ({ overview: vi.fn() }))
const employees = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../../api/users', () => ({ usersApi: users }))
vi.mock('../../../api/analytics', () => ({ analyticsApi: analytics }))
vi.mock('../../../api/workforce', () => ({ workforceAnalyticsApi: workforce }))
vi.mock('../../../api/employees', () => ({ employeesApi: employees }))
vi.mock('../../../hooks/useApiHealth', () => ({ useApiHealth: () => 'online' }))

const user = (over: Partial<ManagedUser> = {}): ManagedUser => ({
  id: 'u-1', email: 'sana@example.com', role: 'employee', is_active: true, must_change_password: false, employee_id: 'emp-1',
  last_login_at: '2026-03-02T08:00:00Z', created_at: '2026-01-01T00:00:00Z', ...over,
})
const page = (items: ManagedUser[], total = items.length) => ({ items, total, page: 1, page_size: 15 })

beforeEach(() => {
  for (const m of [...Object.values(users), analytics.overview, workforce.overview, employees.list]) m.mockReset()
  users.list.mockImplementation((p: { role?: string; is_active?: boolean }) =>
    Promise.resolve(page([user()], p.is_active === false ? 1 : p.role === 'admin' ? 1 : p.role === 'hr_manager' ? 2 : p.role === 'recruiter' ? 3 : p.role === 'employee' ? 4 : 10)),
  )
  analytics.overview.mockResolvedValue(makeOverview())
  workforce.overview.mockResolvedValue(makeWorkforce())
  employees.list.mockResolvedValue({ items: [{ id: 'emp-9', first_name: 'Bilal', last_name: 'Ahmed' }], total: 1, page: 1, page_size: 20 })
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

describe('AdminOverviewPage', () => {
  it('shows accounts, the company and today, from real figures', async () => {
    renderAs(<AdminOverviewPage />, { role: 'admin' })
    const accounts = await screen.findByLabelText('Accounts')
    expect(within(accounts).getByText('Accounts').closest('div')?.textContent).toContain('10')
    expect(within(accounts).getByText('Inactive').closest('div')?.textContent).toContain('1')
    const tile = (name: string) => within(accounts).getByText(name).closest('div') as HTMLElement
    await waitFor(() => expect(tile('Administrator').textContent).toContain('1'))
    await waitFor(() => expect(tile('HR Manager').textContent).toContain('2'))
    await waitFor(() => expect(tile('Recruiter').textContent).toContain('3'))
    await waitFor(() => expect(tile('Employee').textContent).toContain('4'))
    const company = await screen.findByLabelText('Company')
    expect(within(company).getByText('Employees').closest('div')?.textContent).toContain('42')
    const today = await screen.findByLabelText('Today')
    expect(within(today).getByText('Present today').closest('div')?.textContent).toContain('of 12 expected')
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('links to the administration tools', async () => {
    renderAs(<AdminOverviewPage />, { role: 'admin' })
    const list = await screen.findByLabelText('Administration shortcuts')
    expect(within(list).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/admin/users', '/admin/roles', '/admin/settings', '/dashboard', '/recruitment/privacy'])
  })

  it('each section fails on its own, with a retry', async () => {
    analytics.overview.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeOverview())
    renderAs(<AdminOverviewPage />, { role: 'admin' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Company')).toBeTruthy()
    expect(screen.getByLabelText('Accounts')).toBeTruthy()
  })
})

describe('UsersPage', () => {
  it('lists accounts with role, status, last sign-in and whether an employee record is linked; marks you', async () => {
    users.list.mockResolvedValue(page([user({ id: 'me', email: 'admin@example.com', role: 'admin', employee_id: null }), user({ id: 'u-2', email: 'off@example.com', is_active: false, must_change_password: true, last_login_at: null })]))
    renderAs(<UsersPage />, { role: 'admin' })
    const rows = within(await screen.findByRole('list', { name: 'Users' })).getAllByRole('listitem')
    expect(rows[1].textContent).toContain('Inactive')
    expect(rows[1].textContent).toContain('Must change password')
    expect(rows[1].textContent).toContain('Never signed in')
    expect(rows[0].textContent).toContain('No employee record')
    expect(rows[1].textContent).toContain('Linked to an employee record')
  })

  it('sends the filters to the server and resets to page one', async () => {
    renderAs(<UsersPage />, { role: 'admin' })
    const u = userEvent.setup()
    await screen.findByRole('list', { name: 'Users' })
    await u.type(screen.getByLabelText('Search by email'), 'sana')
    await u.selectOptions(screen.getByLabelText('Role'), 'recruiter')
    await u.selectOptions(screen.getByLabelText('Status'), 'inactive')
    await waitFor(() => expect(users.list.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'sana', role: 'recruiter', is_active: false, page: 1 }))
  })

  it('pages, and has empty and error states', async () => {
    users.list.mockResolvedValue(page([user()], 40))
    const { unmount } = renderAs(<UsersPage />, { role: 'admin' })
    await screen.findByText('Page 1 of 3')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(users.list.mock.calls.at(-1)?.[0].page).toBe(2))
    unmount()
    users.list.mockResolvedValue(page([]))
    const again = renderAs(<UsersPage />, { role: 'admin' })
    expect(await screen.findByText('No users yet')).toBeTruthy()
    again.unmount()
    users.list.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(page([user()]))
    renderAs(<UsersPage />, { role: 'admin' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Users' })).toBeTruthy()
  })

  it('a new user needs a valid email and a long enough password, and sends nothing until it has them', async () => {
    renderAs(<UsersPage />, { role: 'admin' })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: /New user/ }))
    const dialog = await screen.findByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeTruthy()
    expect(within(dialog).getByText('Use at least 12 characters.')).toBeTruthy()
    expect(users.create).not.toHaveBeenCalled()
  })

  it('creates the user with the chosen role, link and "must change password", then refreshes', async () => {
    users.create.mockResolvedValue(user())
    renderAs(<UsersPage />, { role: 'admin' })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: /New user/ }))
    const dialog = await screen.findByRole('dialog')
    await u.type(within(dialog).getByLabelText(/^Email/), '  New.Hire@Example.com ')
    await u.selectOptions(within(dialog).getByLabelText(/^Role/), 'recruiter')
    await u.type(within(dialog).getByLabelText(/^Temporary password/), 'Temp-Passw0rd-123')
    await u.selectOptions(await within(dialog).findByRole('combobox', { name: /Employee record/ }), 'emp-9')
    await u.click(within(dialog).getByRole('button', { name: 'Create user' }))
    await waitFor(() => expect(users.create).toHaveBeenCalledWith({ email: 'new.hire@example.com', password: 'Temp-Passw0rd-123', role: 'recruiter', employee_id: 'emp-9', must_change_password: true }))
    expect(await screen.findByText('User created.')).toBeTruthy()
    await waitFor(() => expect(users.list.mock.calls.length).toBeGreaterThan(1))
  })

  it('shows a refusal from the server inside the dialog', async () => {
    users.create.mockRejectedValue(new ApiError('A user with that email already exists.', 409))
    renderAs(<UsersPage />, { role: 'admin' })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: /New user/ }))
    const dialog = await screen.findByRole('dialog')
    await u.type(within(dialog).getByLabelText(/^Email/), 'dup@example.com')
    await u.type(within(dialog).getByLabelText(/^Temporary password/), 'Temp-Passw0rd-123')
    await u.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('already exists')
  })

  it('changes a role and switches an account off, sending only what changed', async () => {
    users.update.mockResolvedValue(user({ role: 'recruiter', is_active: false }))
    renderAs(<UsersPage />, { role: 'admin' })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Manage sana@example.com' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    await u.selectOptions(within(dialog).getByLabelText('Role'), 'recruiter')
    await u.click(within(dialog).getByLabelText(/Account is active/))
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(users.update).toHaveBeenCalledWith('u-1', { role: 'recruiter', is_active: false }))
    expect(await screen.findByText('Account updated.')).toBeTruthy()
  })

  it('your own account cannot have its role or status changed here', async () => {
    users.list.mockResolvedValue(page([user({ id: 'user-admin', email: 'admin@example.com', role: 'admin' })]))
    renderAs(<UsersPage />, { role: 'admin' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Manage admin@example.com' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/your own account/)).toBeTruthy()
    expect((within(dialog).getByLabelText('Role') as HTMLSelectElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText(/Account is active/) as HTMLInputElement).disabled).toBe(true)
  })

  it('unlocks an account and resets a password (at least 12 characters, never displayed back)', async () => {
    users.unlock.mockResolvedValue(undefined)
    users.resetPassword.mockResolvedValue(undefined)
    renderAs(<UsersPage />, { role: 'admin' })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Manage sana@example.com' }))
    const dialog = await screen.findByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: /Unlock after failed attempts/ }))
    await waitFor(() => expect(users.unlock).toHaveBeenCalledWith('u-1'))
    const reset = within(dialog).getByRole('button', { name: 'Reset password' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    await u.type(within(dialog).getByLabelText('New temporary password'), 'short')
    expect(within(dialog).getByText('Use at least 12 characters.')).toBeTruthy()
    expect(reset.disabled).toBe(true)
    await u.clear(within(dialog).getByLabelText('New temporary password'))
    await u.type(within(dialog).getByLabelText('New temporary password'), 'A-much-longer-secret')
    await u.click(reset)
    await waitFor(() => expect(users.resetPassword).toHaveBeenCalledWith('u-1', 'A-much-longer-secret'))
    await waitFor(() => expect((within(dialog).getByLabelText('New temporary password') as HTMLInputElement).value).toBe(''))
  })
})

describe('validateNewUser', () => {
  const good = { email: 'new@example.com', password: 'A-long-enough-pass', role: 'employee' }

  it('accepts a good one', () => expect(validateNewUser(good)).toEqual({}))

  it.each([
    [{ email: '' }, 'email'], [{ email: 'nope' }, 'email'], [{ email: 'a@b' }, 'email'], [{ role: '' }, 'role'],
    [{ password: '' }, 'password'], [{ password: 'x'.repeat(11) }, 'password'], [{ password: 'x'.repeat(129) }, 'password'],
    [{ password: ' '.repeat(14) }, 'password'], [{ email: 'newhire@example.com', password: 'my-newhire-pass-1' }, 'password'],
  ])('refuses %j (%s)', (over, field) => {
    expect(validateNewUser({ ...good, ...over })[field as string]).toBeTruthy()
  })
})

describe('RolesPage', () => {
  it('describes the four roles, how many accounts each has, and where each lands', async () => {
    renderAs(<RolesPage />, { role: 'admin' })
    const roles = within(screen.getByLabelText('Roles'))
    for (const [name, panel] of [['Administrator', 'Admin Console'], ['HR Manager', 'HR Workspace'], ['Recruiter', 'Recruiting'], ['Employee', 'My Portal']]) {
      expect(roles.getByRole('heading', { name })).toBeTruthy()
      expect(roles.getByText(new RegExp(`Panel: ${panel}`))).toBeTruthy()
    }
    expect(await roles.findByLabelText('Administrator accounts')).toHaveProperty('textContent', '1 account')
    expect((await roles.findByLabelText('Employee accounts')).textContent).toBe('4 accounts')
  })

  it('the matrix is exactly the application\'s permission table, one row per permission', () => {
    renderAs(<RolesPage />, { role: 'admin' })
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(Object.keys(GRANTS).length)
    for (const [permission, allowed] of Object.entries(GRANTS)) {
      const row = rows.find((r) => within(r).queryByText(permissionLabels[permission as keyof typeof permissionLabels]))
      expect(row, permission).toBeTruthy()
      const cells = within(row as HTMLElement).getAllByRole('cell').map((c) => c.textContent)
      expect(cells).toEqual(['admin', 'hr_manager', 'recruiter', 'employee'].map((r) => (allowed.includes(r as never) ? 'Yes' : 'No')))
    }
  })

  it('says that roles are fixed and links to where they are assigned', () => {
    renderAs(<RolesPage />, { role: 'admin' })
    expect(screen.getByText(/Assign a role to a person on the Users page/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Users & accounts' }).getAttribute('href')).toBe('/admin/users')
    expect(screen.getByText(/nobody can decide their own leave request/)).toBeTruthy()
  })

  it('has an accessible table', () => {
    renderAs(<RolesPage />, { role: 'admin' })
    expect(screen.getByRole('table', { name: 'Which role holds which permission' })).toBeTruthy()
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
  })
})
