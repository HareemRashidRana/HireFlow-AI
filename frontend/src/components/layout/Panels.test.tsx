// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RequireRole } from '../../auth/guards'
import { GRANTS, canOpenPath, homePath, roleHomes } from '../../auth/permissions'
import { makeUser } from '../../test/fixtures'
import { renderAs } from '../../test/render'
import type { UserRole } from '../../types/auth'
import { AppShell } from './AppShell'
import { navFor, panels } from './navigation'
import { ProfileMenu } from './ProfileMenu'
import { Sidebar } from './Sidebar'

vi.mock('../../hooks/useApiHealth', () => ({ useApiHealth: () => 'online' }))

const roles: UserRole[] = ['admin', 'hr_manager', 'recruiter', 'employee']
const links = () => [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.textContent?.trim())

describe('the four panels', () => {
  it.each([
    [
      'admin',
      [
        'System overview', 'Users & accounts', 'Roles & permissions', 'Company settings', 'Data privacy',
        'Employees',
        'Today & month', 'Records & corrections', 'Leave approvals', 'Leave balances', 'Leave calendar',
        'Job postings', 'Candidates & resumes', 'Applications', 'Hiring pipeline', 'Interviews',
        'System reports',
      ],
    ],
    [
      'hr_manager',
      [
        'HR dashboard', 'Employees', 'Today & month', 'Records & corrections', 'Approvals', 'Balances', 'Leave calendar',
        'Work schedule & holidays', 'Data privacy',
        'Job postings', 'Candidates & resumes', 'Hiring decisions', 'Interviews',
        'HR reports', 'Recruitment analytics',
      ],
    ],
    ['recruiter', ['Recruitment dashboard', 'Job postings', 'Candidates & resumes', 'Applications', 'Hiring pipeline', 'Interviews', 'Recruitment analytics']],
    ['employee', ['Home', 'Attendance', 'Leave', 'My profile']],
  ] as const)('%s has exactly its own navigation', (role, expected) => {
    renderAs(<Sidebar />, { role })
    expect(links()).toEqual(expected)
  })

  // Every page a management role may open must be one click away. (A role's permissions never
  // changed; this guards against a menu that quietly hides a page the role is still allowed to use.)
  it.each(['admin', 'hr_manager'] as const)('%s can reach every management page it is allowed to open, by clicking', (role) => {
    renderAs(<Sidebar />, { role })
    const hrefs = new Set([...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.getAttribute('href')))
    const user = makeUser(role)
    const pages = [
      '/dashboard', '/employees', '/attendance/overview', '/attendance/manage', '/leave/approvals', '/leave/balances',
      '/leave/calendar', '/recruitment/jobs', '/recruitment/candidates', '/recruitment/pipeline', '/recruitment/interviews',
      '/recruitment/privacy', '/settings/work',
    ]
    // The administrator reaches the work-schedule page as "Company settings" (the same page).
    const alias: Record<string, string> = role === 'admin' ? { '/settings/work': '/admin/settings' } : {}
    for (const page of pages) {
      if (!canOpenPath(user, page)) continue
      expect(hrefs.has(alias[page] ?? page), `${role} has no link to ${page}`).toBe(true)
    }
  })

  it('only the administrator is offered the account and role pages', () => {
    for (const role of roles) {
      const { unmount } = renderAs(<Sidebar />, { role })
      const hrefs = [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.getAttribute('href'))
      expect(hrefs.includes('/admin/users'), role).toBe(role === 'admin')
      expect(hrefs.includes('/admin/roles'), role).toBe(role === 'admin')
      unmount()
    }
  })

  it('the longer menus are grouped under clear headings', () => {
    renderAs(<Sidebar />, { role: 'admin' })
    for (const heading of ['Administration', 'People', 'Attendance & leave', 'Recruitment', 'Reports']) expect(screen.getByText(heading)).toBeTruthy()
    const { unmount } = renderAs(<Sidebar />, { role: 'hr_manager' })
    for (const heading of ['People', 'Attendance', 'Leave', 'Configuration', 'Recruitment', 'Reports']) expect(screen.getAllByText(heading).length).toBeGreaterThan(0)
    unmount()
  })

  it.each(roles)('%s names its panel at the top of the sidebar', (role) => {
    const { container } = renderAs(<Sidebar />, { role })
    expect(container.querySelector(`[data-panel="${panels[role].id}"]`)).toBeTruthy()
    expect(screen.getByText(panels[role].title)).toBeTruthy()
    expect(screen.getByText(panels[role].tagline)).toBeTruthy()
  })

  it('linked staff also get their own attendance, leave and profile under "My work"; the employee does not need the group', () => {
    for (const role of ['admin', 'hr_manager', 'recruiter'] as const) {
      const { unmount } = renderAs(<Sidebar />, { role, employeeId: 'emp-1' })
      expect(links()).toEqual(expect.arrayContaining(['My attendance', 'My leave', 'My profile']))
      expect(screen.getByText('My work')).toBeTruthy()
      unmount()
    }
  })

  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s without an employee record gets no personal items', (role) => {
    renderAs(<Sidebar />, { role })
    for (const mine of ['My attendance', 'My leave', 'My profile']) expect(links()).not.toContain(mine)
  })

  it('no role is shown another role\'s landing page', () => {
    for (const role of roles) {
      const hrefs = navFor(makeUser(role, { employee_id: 'emp-1' }), (p) => GRANTS[p].includes(role)).groups.flatMap((g) => g.items.map((i) => i.to))
      for (const other of roles.filter((r) => r !== role)) expect(hrefs).not.toContain(roleHomes[other])
      expect(hrefs).toContain(roleHomes[role])
    }
  })

  it('every link a role is shown is one it is allowed to use', () => {
    for (const role of roles) {
      const { groups } = navFor(makeUser(role), (p) => GRANTS[p].includes(role))
      for (const item of groups.flatMap((g) => g.items)) if (item.requires) expect(GRANTS[item.requires]).toContain(role)
    }
  })

  it('the employee panel contains nothing administrative or recruiting', () => {
    const hrefs = panels.employee.groups.flatMap((g) => g.items.map((i) => i.to))
    expect(hrefs).toEqual(['/employee', '/attendance', '/leave', '/profile'])
  })

  it('each role lands on its own home', () => {
    for (const role of roles) expect(homePath(makeUser(role))).toBe(roleHomes[role])
    expect(roleHomes).toEqual({ admin: '/admin', hr_manager: '/hr', recruiter: '/recruiter', employee: '/employee' })
  })

  it('the navigation list scrolls by itself, so a long menu can never push anything off screen', () => {
    renderAs(<Sidebar />, { role: 'hr_manager', employeeId: 'emp-1' })
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.className).toContain('overflow-y-auto')
    expect(nav.className).toContain('min-h-0')
    expect(nav.className).toContain('flex-1')
  })

  it('the sidebar no longer carries the account controls (they live in the always-visible top bar)', () => {
    renderAs(<Sidebar />, { role: 'hr_manager' })
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
    expect(screen.queryByText('Change password')).toBeNull()
  })
})

describe('RequireRole', () => {
  it('opens a panel page for its own role only', () => {
    const ui = (
      <Routes>
        <Route path="/hr" element={<RequireRole roles={['hr_manager']}><p>HR page</p></RequireRole>} />
      </Routes>
    )
    const { unmount } = renderAs(ui, { role: 'hr_manager', url: '/hr' })
    expect(screen.getByText('HR page')).toBeTruthy()
    unmount()
    for (const role of ['admin', 'recruiter', 'employee'] as const) {
      const r = renderAs(ui, { role, url: '/hr' })
      expect(screen.queryByText('HR page')).toBeNull()
      expect(screen.getByText("You don't have access to this page")).toBeTruthy()
      r.unmount()
    }
  })
})

describe('the account menu and signing out', () => {
  const open = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    return { user, menu: screen.getByRole('menu', { name: 'Account' }) }
  }

  it.each(roles)('%s has an account menu with their email, role, Change password and Sign out', async (role) => {
    renderAs(<ProfileMenu />, { role, employeeId: role === 'admin' ? null : 'emp-1' })
    const { menu } = await open()
    expect(within(menu).getByText(`${role}@example.com`)).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Change password' }).getAttribute('href')).toBe('/change-password')
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
  })

  it('offers My profile to anyone with an employee record, and not to an unlinked administrator', async () => {
    const { unmount } = renderAs(<ProfileMenu />, { role: 'admin' })
    let { menu } = await open()
    expect(within(menu).queryByRole('menuitem', { name: 'My profile' })).toBeNull()
    unmount()
    renderAs(<ProfileMenu />, { role: 'hr_manager', employeeId: 'emp-1' })
    ;({ menu } = await open())
    expect(within(menu).getByRole('menuitem', { name: 'My profile' }).getAttribute('href')).toBe('/profile')
  })

  it.each(roles)('Sign out works for %s: the server is asked to end the session, once', async (role) => {
    const logout = vi.fn().mockResolvedValue(undefined)
    renderAs(<ProfileMenu />, { role, logout })
    const { user, menu } = await open()
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
  })

  it('shows "Signing out…" and cannot be clicked twice while it works', async () => {
    let finish: () => void = () => {}
    const logout = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    renderAs(<ProfileMenu />, { role: 'employee', logout })
    const { user, menu } = await open()
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    const busy = await screen.findByRole('menuitem', { name: /Signing out/ })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    await user.click(busy)
    expect(logout).toHaveBeenCalledTimes(1)
    finish()
  })

  it('if the server cannot be reached the person stays signed in and is told why', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('Could not reach the server.'))
    renderAs(<ProfileMenu />, { role: 'recruiter', logout })
    const { user, menu } = await open()
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
    expect((await screen.findByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(false) // can try again
  })

  it('closes with Escape, with a click elsewhere, and when a link is chosen', async () => {
    renderAs(<ProfileMenu />, { role: 'hr_manager', employeeId: 'emp-1' })
    const user = userEvent.setup()
    await open()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    await open()
    await user.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    await open()
    await user.click(screen.getByRole('menuitem', { name: 'Change password' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('exposes its state to assistive technology', async () => {
    renderAs(<ProfileMenu />, { role: 'employee' })
    const button = screen.getByRole('button', { name: 'Account menu' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    await userEvent.setup().click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('the shell', () => {
  it.each(roles)('the top bar with the account menu is on screen for %s, outside the sidebar', (role) => {
    const { container } = renderAs(<AppShell />, { role })
    const header = container.querySelector('header') as HTMLElement
    expect(header).toBeTruthy()
    expect(within(header).getByRole('button', { name: 'Account menu' })).toBeTruthy()
    const aside = container.querySelector('aside') as HTMLElement
    expect(within(aside).queryByRole('button', { name: 'Account menu' })).toBeNull()
  })

  it('the menu button opens the same panel navigation on small screens', async () => {
    renderAs(<AppShell />, { role: 'recruiter' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(2) // desktop and drawer copies
    expect(screen.getAllByText('Recruiting').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy()
  })
})
