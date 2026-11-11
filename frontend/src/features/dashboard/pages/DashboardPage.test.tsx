// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { RequirePermission } from '../../../auth/guards'
import { homePath } from '../../../auth/permissions'
import { Sidebar } from '../../../components/layout/Sidebar'
import { emptyOverview, makeJobs, makeOverview, makeWorkforce, options } from '../../../test/analyticsFixtures'
import { makeUser } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import { daysInRange, dayKey } from '../lib/dashboard'
import { DashboardPage } from './DashboardPage'

const api = vi.hoisted(() => ({ overview: vi.fn(), jobs: vi.fn(), filterOptions: vi.fn(), workforce: vi.fn() }))
vi.mock('../../../api/analytics', () => ({ analyticsApi: api }))
vi.mock('../../../api/workforce', () => ({ workforceAnalyticsApi: { overview: api.workforce } }))
vi.mock('../../../hooks/useApiHealth', () => ({ useApiHealth: () => 'online' }))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.overview.mockResolvedValue(makeOverview())
  api.jobs.mockResolvedValue(makeJobs())
  api.filterOptions.mockResolvedValue(options)
  api.workforce.mockResolvedValue(makeWorkforce())
})

const render = (role: UserRole = 'hr_manager') => {
  renderAs(<DashboardPage />, { role })
  return userEvent.setup()
}
const lastParams = () => api.overview.mock.calls.at(-1)?.[0]

describe('rendering real data', () => {
  it('greets, shows the KPIs, funnel, trend, interviews, sources, time to hire, jobs and activity', async () => {
    render()
    expect(await screen.findByLabelText('Key figures')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Good (morning|afternoon|evening)/)
    expect(screen.getByText(/HR Manager \(hr_manager@example.com\)/)).toBeTruthy()
    for (const heading of ['Recruitment funnel', 'Applications, interviews and hires', 'Interviews', 'Where applications come from', 'Time to hire', 'Job performance', 'Recent recruitment activity'])
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    expect(within(screen.getByLabelText('Key figures')).getByText('42')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Applications by current stage' })).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Applications:')
    expect(screen.getByText('12.5 days')).toBeTruthy()
    expect(await screen.findAllByRole('link', { name: 'Backend Engineer' })).toBeTruthy()
    expect(screen.getByText(/Moved to Screening/)).toBeTruthy()
    expect(screen.getByText(/Showing 1 Mar 2026 to 7 Mar 2026 \(Asia\/Karachi\)/)).toBeTruthy()
  })

  it('asks for the last 30 days in the browser time zone, with no job or department', async () => {
    render()
    await screen.findByLabelText('Key figures')
    const p = lastParams()
    expect(p.end).toBe(dayKey(new Date()))
    expect(daysInRange(p.start, p.end)).toBe(30)
    expect(p.timezone).toMatch(/\S/)
    expect(p.job_id).toBeUndefined()
    expect(p.department).toBeUndefined()
  })

  it('has no inert controls: the only buttons are table paging', async () => {
    render()
    await screen.findAllByRole('link', { name: 'Backend Engineer' })
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.every((n) => /page/i.test(n ?? ''))).toBe(true)
  })
})

describe('states', () => {
  it('shows a loading state first', async () => {
    api.overview.mockReturnValue(new Promise(() => {}))
    render()
    expect(screen.getByLabelText('Loading key figures').getAttribute('aria-busy')).toBe('true')
    expect(screen.getAllByRole('status').some((e) => /Loading the dashboard/.test(e.textContent ?? ''))).toBe(true)
  })

  it('shows the server message with a retry that works', async () => {
    api.overview.mockRejectedValueOnce(new ApiError('The database is busy.', 503)).mockResolvedValueOnce(makeOverview())
    const user = render()
    expect(await screen.findByText("Couldn't load the dashboard")).toBeTruthy()
    expect(screen.getByText('The database is busy.')).toBeTruthy()
    expect(screen.queryByLabelText('Key figures')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Key figures')).toBeTruthy()
  })

  it('every section has an empty state when there is nothing yet', async () => {
    api.overview.mockResolvedValue(emptyOverview())
    api.jobs.mockResolvedValue(makeJobs({ items: [], total: 0 }))
    render()
    expect(await screen.findByText('No applications were received in this period.')).toBeTruthy()
    expect(screen.getByText(/Nothing happened in this period yet/)).toBeTruthy()
    expect(screen.getByText('No interviews were scheduled in this period.')).toBeTruthy()
    expect(screen.getByText(/no sources to show/)).toBeTruthy()
    expect(screen.getByText(/nothing to average/)).toBeTruthy()
    expect(screen.getByText('No recruitment activity yet.')).toBeTruthy()
    expect(await screen.findByText('No jobs match these filters.')).toBeTruthy()
    expect(within(screen.getByLabelText('Key figures')).getAllByText('0').length).toBeGreaterThanOrEqual(6)
  })

  it('keeps the old figures and says so when a refresh fails', async () => {
    const user = render()
    await screen.findByLabelText('Key figures')
    api.overview.mockRejectedValueOnce(new ApiError('Network down', 0))
    await user.selectOptions(screen.getByLabelText('Period'), '7d')
    expect(await screen.findByText(/Couldn't refresh these figures, so the previous ones are still shown/)).toBeTruthy()
    expect(screen.getByLabelText('Key figures')).toBeTruthy()
  })

  it('a job table failure does not take the dashboard down', async () => {
    api.jobs.mockRejectedValue(new ApiError('jobs failed', 500))
    render()
    expect(await screen.findByText("Couldn't load job performance")).toBeTruthy()
    expect(screen.getByLabelText('Key figures')).toBeTruthy()
  })
})

describe('filters change what is shown', () => {
  it('a different period requests that period', async () => {
    const user = render()
    await screen.findByLabelText('Key figures')
    await user.selectOptions(screen.getByLabelText('Period'), '7d')
    await waitFor(() => expect(daysInRange(lastParams().start, lastParams().end)).toBe(7))
    await user.selectOptions(screen.getByLabelText('Period'), '12m')
    await waitFor(() => expect(daysInRange(lastParams().start, lastParams().end)).toBe(365))
  })

  it('a department and a job are sent to both the overview and the job table', async () => {
    const user = render()
    await screen.findByLabelText('Key figures')
    await user.selectOptions(await screen.findByLabelText('Department'), 'Engineering')
    await waitFor(() => expect(lastParams().department).toBe('Engineering'))
    await user.selectOptions(screen.getByLabelText('Job'), 'job-1')
    await waitFor(() => expect(lastParams().job_id).toBe('job-1'))
    await waitFor(() => expect(api.jobs.mock.calls.at(-1)?.[0]).toMatchObject({ department: 'Engineering', job_id: 'job-1', page: 1 }))
  })

  it('new data replaces the old when a filter changes', async () => {
    const user = render()
    await screen.findByLabelText('Key figures')
    api.overview.mockResolvedValue(makeOverview({ kpis: { ...makeOverview().kpis, total_employees: 7 } }))
    await user.selectOptions(await screen.findByLabelText('Department'), 'Sales')
    await waitFor(() => expect(within(screen.getByLabelText('Key figures')).getByText('7')).toBeTruthy())
  })

  it('a custom range sends the chosen dates; an invalid one sends nothing', async () => {
    const user = render()
    await screen.findByLabelText('Key figures')
    await user.selectOptions(screen.getByLabelText('Period'), 'custom')
    expect(await screen.findByRole('alert')).toBeTruthy() // blank dates
    const calls = api.overview.mock.calls.length
    await user.type(screen.getByLabelText('From'), '2026-03-10')
    await user.type(screen.getByLabelText('To'), '2026-03-01')
    expect(screen.getByRole('alert').textContent).toMatch(/must not be after/)
    expect(api.overview.mock.calls.length).toBe(calls)
    await user.clear(screen.getByLabelText('To'))
    await user.type(screen.getByLabelText('To'), '2026-03-31')
    await waitFor(() => expect(lastParams()).toMatchObject({ start: '2026-03-10', end: '2026-03-31' }))
  })

  it('Reset returns to the default view', async () => {
    const user = render()
    await screen.findByLabelText('Key figures')
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull()
    await user.selectOptions(screen.getByLabelText('Period'), '90d')
    await user.click(await screen.findByRole('button', { name: 'Reset filters' }))
    await waitFor(() => expect(daysInRange(lastParams().start, lastParams().end)).toBe(30))
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('30d')
  })

  it('a filter-option failure leaves the dashboard usable with empty choices', async () => {
    api.filterOptions.mockRejectedValue(new ApiError('nope', 500))
    render()
    expect(await screen.findByLabelText('Key figures')).toBeTruthy()
    expect(within(screen.getByLabelText('Job')).getAllByRole('option')).toHaveLength(1)
  })
})

describe('who can see it', () => {
  const Page = () => (
    <RequirePermission permission="analytics:read">
      <DashboardPage />
    </RequirePermission>
  )

  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s sees the dashboard', async (role) => {
    renderAs(<Page />, { role })
    expect(await screen.findByLabelText('Key figures')).toBeTruthy()
  })

  it('the employee role gets an access message and the page never asks for any analytics', () => {
    renderAs(<Page />, { role: 'employee' })
    expect(screen.getByText("You don't have access to this page")).toBeTruthy()
    expect(screen.queryByLabelText('Key figures')).toBeNull()
    expect(api.overview).not.toHaveBeenCalled()
    expect(api.filterOptions).not.toHaveBeenCalled()
  })

  it('the reports link is called System reports for the admin and Recruitment analytics for the recruiter', () => {
    const labels = () => [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.textContent?.trim())
    const { unmount } = renderAs(<Sidebar />, { role: 'admin' })
    expect(labels()).toContain('System reports')
    unmount()
    renderAs(<Sidebar />, { role: 'recruiter' })
    expect(labels()).toContain('Recruitment analytics')
  })

  it('the employee role has no link to it', () => {
    renderAs(<Sidebar />, { role: 'employee' })
    const links = [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')]
    expect(links.some((a) => a.getAttribute('href') === '/dashboard')).toBe(false)
  })

  it('signing in lands each role on its own panel', () => {
    expect(homePath(makeUser('admin'))).toBe('/admin')
    expect(homePath(makeUser('hr_manager'))).toBe('/hr')
    expect(homePath(makeUser('recruiter'))).toBe('/recruiter')
    expect(homePath(makeUser('employee'))).toBe('/employee')
  })
})

describe('responsive layout', () => {
  it('cards and panels reflow by screen width', async () => {
    const { container } = (() => {
      const r = renderAs(<DashboardPage />, { role: 'hr_manager' })
      return r
    })()
    await screen.findByLabelText('Key figures')
    const kpi = screen.getByLabelText('Key figures')
    expect(kpi.className).toContain('grid-cols-2')
    expect(kpi.className).toContain('xl:grid-cols-6')
    expect(container.querySelector('.lg\\:grid-cols-2')).toBeTruthy()
    expect(container.querySelector('.lg\\:grid-cols-3')).toBeTruthy()
    const filters = screen.getByRole('search', { name: 'Dashboard filters' })
    expect(filters.querySelector('.sm\\:grid-cols-2')).toBeTruthy()
  })
})
