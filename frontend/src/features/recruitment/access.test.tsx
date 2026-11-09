// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RequirePermission } from '../../auth/guards'
import { Sidebar } from '../../components/layout/Sidebar'
import { renderAs } from '../../test/render'
import type { UserRole } from '../../types/auth'

// The sidebar polls the API health endpoint; keep that out of these tests.
vi.mock('../../hooks/useApiHealth', () => ({ useApiHealth: () => 'online' }))

const Secret = () => <div>secret recruitment page</div>

describe('route guard for recruitment pages', () => {
  it.each(['admin', 'hr_manager', 'recruiter'] as const)('lets %s in', (role) => {
    renderAs(
      <RequirePermission permission="recruitment:read">
        <Secret />
      </RequirePermission>,
      { role },
    )
    expect(screen.getByText('secret recruitment page')).toBeTruthy()
  })

  it('blocks the employee role with a clear message and never renders the page', () => {
    renderAs(
      <RequirePermission permission="recruitment:read">
        <Secret />
      </RequirePermission>,
      { role: 'employee' },
    )
    expect(screen.queryByText('secret recruitment page')).toBeNull()
    expect(screen.getByText("You don't have access to this page")).toBeTruthy()
  })

  it('blocks writing for the employee role too', () => {
    renderAs(
      <RequirePermission permission="recruitment:write">
        <Secret />
      </RequirePermission>,
      { role: 'employee' },
    )
    expect(screen.queryByText('secret recruitment page')).toBeNull()
  })
})

describe('sidebar navigation by role', () => {
  const navLabels = () =>
    [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.textContent?.trim())

  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s sees Employees and Jobs', (role: UserRole) => {
    renderAs(<Sidebar />, { role })
    expect(navLabels()).toContain('Employees')
    expect(navLabels()).toContain('Jobs')
  })

  it('the Jobs link goes to the jobs list', () => {
    renderAs(<Sidebar />, { role: 'recruiter' })
    const jobs = screen.getByRole('link', { name: 'Jobs' })
    expect(jobs.getAttribute('href')).toBe('/recruitment/jobs')
  })

  it('employees do not see Jobs (or Employees); they only get their own profile', () => {
    renderAs(<Sidebar />, { role: 'employee' })
    expect(navLabels()).toEqual(['My profile'])
  })
})
