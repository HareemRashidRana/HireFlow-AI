// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RequirePermission } from '../../auth/guards'
import { Sidebar } from '../../components/layout/Sidebar'
import { renderAs } from '../../test/render'

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

  it('the recruiter panel lists the hiring work, and nothing from HR or administration', () => {
    renderAs(<Sidebar />, { role: 'recruiter' })
    expect(navLabels()).toEqual(['Recruitment dashboard', 'Job postings', 'Candidates & resumes', 'Applications', 'Hiring pipeline', 'Interviews', 'Recruitment analytics'])
  })

  it('the recruitment links go to their pages', () => {
    renderAs(<Sidebar />, { role: 'recruiter' })
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
    expect(href('Job postings')).toBe('/recruitment/jobs')
    expect(href('Candidates & resumes')).toBe('/recruitment/candidates')
    expect(href('Applications')).toBe('/recruitment/applications')
    expect(href('Hiring pipeline')).toBe('/recruitment/pipeline')
    expect(href('Interviews')).toBe('/recruitment/interviews')
  })

  it('the admin panel has a Recruitment group with every recruitment page', () => {
    renderAs(<Sidebar />, { role: 'admin' })
    expect(navLabels()).toEqual(expect.arrayContaining(['Job postings', 'Candidates & resumes', 'Applications', 'Hiring pipeline', 'Interviews']))
  })

  it('the HR panel has jobs, candidates, hiring decisions and interviews, and keeps its own work first', () => {
    renderAs(<Sidebar />, { role: 'hr_manager' })
    expect(navLabels()).toEqual(expect.arrayContaining(['Job postings', 'Candidates & resumes', 'Hiring decisions', 'Interviews']))
    expect(navLabels()[0]).toBe('HR dashboard')
  })

  it('each recruitment link goes to the right page for admin and HR', () => {
    for (const role of ['admin', 'hr_manager'] as const) {
      const { unmount } = renderAs(<Sidebar />, { role })
      const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
      expect(href('Job postings')).toBe('/recruitment/jobs')
      expect(href('Candidates & resumes')).toBe('/recruitment/candidates')
      expect(href('Interviews')).toBe('/recruitment/interviews')
      unmount()
    }
  })

  it('employees see none of the recruitment links; only their own portal', () => {
    renderAs(<Sidebar />, { role: 'employee' })
    expect(navLabels()).toEqual(['Home', 'Attendance', 'Leave', 'My profile'])
  })
})
