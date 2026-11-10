// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RequirePermission } from '../../auth/guards'
import { Sidebar } from '../../components/layout/Sidebar'
import { renderAs } from '../../test/render'
import type { UserRole } from '../../types/auth'

vi.mock('../../hooks/useApiHealth', () => ({ useApiHealth: () => 'online' }))

const Secret = () => <div>privacy console</div>

describe('route guard for the privacy page', () => {
  it.each(['admin', 'hr_manager'] as const)('lets %s in', (role) => {
    renderAs(<RequirePermission permission="privacy:manage"><Secret /></RequirePermission>, { role })
    expect(screen.getByText('privacy console')).toBeTruthy()
  })

  it.each(['recruiter', 'employee'] as const)('blocks %s with a clear message and never renders the page', (role) => {
    renderAs(<RequirePermission permission="privacy:manage"><Secret /></RequirePermission>, { role })
    expect(screen.queryByText('privacy console')).toBeNull()
    expect(screen.getByText("You don't have access to this page")).toBeTruthy()
  })

  it('only administrators hold the purge permission', () => {
    renderAs(<RequirePermission permission="privacy:purge"><Secret /></RequirePermission>, { role: 'hr_manager' })
    expect(screen.queryByText('privacy console')).toBeNull()
    renderAs(<RequirePermission permission="privacy:purge"><Secret /></RequirePermission>, { role: 'admin' })
    expect(screen.getAllByText('privacy console')).toHaveLength(1)
  })
})

describe('sidebar', () => {
  const labels = () => [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.textContent?.trim())

  it.each(['admin', 'hr_manager'] as const)('%s sees Privacy, linking to the privacy page', (role: UserRole) => {
    renderAs(<Sidebar />, { role })
    expect(labels()).toContain('Privacy')
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/recruitment/privacy')
  })

  it.each(['recruiter', 'employee'] as const)('%s does not see Privacy', (role: UserRole) => {
    renderAs(<Sidebar />, { role })
    expect(labels()).not.toContain('Privacy')
  })
})
