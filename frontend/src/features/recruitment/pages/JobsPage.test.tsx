// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeJob, makeJobList } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import { JobsPage } from './JobsPage'

const list = vi.fn()
const departments = vi.fn()
vi.mock('../../../api/jobs', () => ({
  jobsApi: { list: (...a: unknown[]) => list(...a), departments: (...a: unknown[]) => departments(...a) },
}))

const jobs = [
  makeJob({ id: 'j1', title: 'Backend Engineer', status: 'open', opened_at: '2026-11-03T10:00:00Z' }),
  makeJob({ id: 'j2', title: 'Sales Executive', department: 'Sales', status: 'draft', employment_type: 'contract' }),
  makeJob({
    id: 'j3',
    title: 'Product Designer',
    status: 'on_hold',
    hiring_manager: { id: 'e1', first_name: 'Ayesha', last_name: 'Khan', job_title: 'CTO' },
  }),
]

beforeEach(() => {
  list.mockReset()
  departments.mockReset()
  list.mockResolvedValue(makeJobList(jobs))
  departments.mockResolvedValue(['Engineering', 'Sales'])
})

const lastListParams = () => list.mock.calls.at(-1)![0]
const render = (url = '/recruitment/jobs', role: 'admin' | 'hr_manager' | 'recruiter' = 'recruiter') =>
  renderAs(<JobsPage />, { path: '/recruitment/jobs', url, role })

describe('JobsPage listing', () => {
  it('shows the jobs with their status, type and hiring manager', async () => {
    render()
    expect(await screen.findAllByText('Backend Engineer')).not.toHaveLength(0)
    expect(screen.getAllByText('Sales Executive').length).toBeGreaterThan(0)
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Product Designer'))!
    expect(within(row).getByText('On hold')).toBeTruthy()
    expect(within(row).getByText('Ayesha Khan')).toBeTruthy()
    expect(screen.getAllByRole('row').find((r) => r.textContent?.includes('Sales Executive'))!.textContent).toMatch(/Contract/)
  })

  it('links each job to its detail page', async () => {
    render()
    const link = (await screen.findAllByRole('link', { name: 'Backend Engineer' }))[0]
    expect(link.getAttribute('href')).toBe('/recruitment/jobs/j1')
  })

  it('first request uses the default page size and no filters', async () => {
    render()
    await screen.findAllByText('Backend Engineer')
    expect(lastListParams()).toMatchObject({ q: '', status: '', department: '', page: 1, page_size: 10 })
  })

  it('shows "Not published" for jobs that were never opened', async () => {
    render()
    await screen.findAllByText('Backend Engineer')
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Sales Executive'))!
    expect(within(row).getByText('Not published')).toBeTruthy()
  })
})

describe('status tabs', () => {
  it('show counts for each status and the total', async () => {
    render()
    const group = await screen.findByRole('group', { name: 'Filter by status' })
    const text = (name: string) => within(group).getByRole('button', { name: new RegExp(`^${name}`) }).textContent
    expect(text('All')).toBe('All3')
    expect(text('Open')).toBe('Open1')
    expect(text('Draft')).toBe('Draft1')
    expect(text('On hold')).toBe('On hold1')
    expect(text('Closed')).toBe('Closed0')
  })

  it('filter by status and mark the active tab', async () => {
    const user = userEvent.setup()
    render()
    const group = await screen.findByRole('group', { name: 'Filter by status' })
    await user.click(within(group).getByRole('button', { name: /^Open/ }))
    await waitFor(() => expect(lastListParams()).toMatchObject({ status: 'open', page: 1 }))
    expect(within(group).getByRole('button', { name: /^Open/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(group).getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('start from the status in the URL', async () => {
    render('/recruitment/jobs?status=closed')
    await screen.findByRole('group', { name: 'Filter by status' })
    expect(lastListParams()).toMatchObject({ status: 'closed' })
  })

  it('ignore an invalid status in the URL', async () => {
    render('/recruitment/jobs?status=archived')
    await screen.findByRole('group', { name: 'Filter by status' })
    expect(lastListParams().status).toBe('')
  })
})

describe('search and filters', () => {
  it('searches after a short pause and resets to the first page', async () => {
    const user = userEvent.setup()
    render('/recruitment/jobs?page=2')
    await screen.findAllByText('Backend Engineer')
    await user.type(screen.getByLabelText('Search jobs'), 'engineer')
    await waitFor(() => expect(lastListParams()).toMatchObject({ q: 'engineer', page: 1 }), { timeout: 2000 })
  })

  it('filters by employment type and department', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByText('Backend Engineer')
    await user.selectOptions(screen.getByLabelText('Filter by employment type'), 'contract')
    await waitFor(() => expect(lastListParams()).toMatchObject({ employment_type: 'contract' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Sales' })).toBeTruthy())
    await user.selectOptions(screen.getByLabelText('Filter by department'), 'Sales')
    await waitFor(() => expect(lastListParams()).toMatchObject({ department: 'Sales', employment_type: 'contract' }))
  })

  it('lists known departments in the department filter', async () => {
    render()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Engineering' })).toBeTruthy())
    expect(screen.getByRole('option', { name: 'All departments' })).toBeTruthy()
  })

  it('"Clear" resets every filter', async () => {
    const user = userEvent.setup()
    render('/recruitment/jobs?status=open&type=contract&q=abc')
    await screen.findAllByText('Backend Engineer')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(lastListParams()).toMatchObject({ q: '', status: '', department: '', employment_type: '' }))
    expect((screen.getByLabelText('Search jobs') as HTMLInputElement).value).toBe('')
  })
})

describe('pagination', () => {
  it('shows the range and goes to the next page', async () => {
    const many = Array.from({ length: 10 }, (_, i) => makeJob({ id: `p${i}`, title: `Job ${i}` }))
    list.mockResolvedValue(makeJobList(many, { total: 25 }))
    const user = userEvent.setup()
    render()
    expect(await screen.findByText('Showing 1–10 of 25')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: /previous/i }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(lastListParams()).toMatchObject({ page: 2 }))
  })

  it('disables Next on the last page', async () => {
    list.mockResolvedValue(makeJobList([makeJob({ id: 'x' })], { total: 11, page: 2 }))
    render('/recruitment/jobs?page=2')
    await screen.findByText('Showing 11–11 of 11')
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('states', () => {
  it('shows a loading indicator first', () => {
    list.mockReturnValue(new Promise(() => {}))
    render()
    expect(screen.getByText('Loading jobs…')).toBeTruthy()
  })

  it('shows an empty state with a create button when there are no jobs', async () => {
    list.mockResolvedValue(makeJobList([]))
    render()
    expect(await screen.findByText('No jobs yet')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /new job/i }).length).toBeGreaterThan(0)
  })

  it('shows a "no matches" state when filters hide everything', async () => {
    list.mockResolvedValue(makeJobList([]))
    render('/recruitment/jobs?q=zzz')
    expect(await screen.findByText('No jobs match your filters')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('shows an error with a working retry', async () => {
    list.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0))
    const user = userEvent.setup()
    render()
    expect(await screen.findByText("Couldn't load jobs")).toBeTruthy()
    expect(screen.getByText('Cannot reach the server.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByText('Backend Engineer')).length).toBeGreaterThan(0)
  })
})

describe('permissions', () => {
  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s sees the New job button', async (role) => {
    render('/recruitment/jobs', role)
    await screen.findAllByText('Backend Engineer')
    expect(screen.getAllByRole('link', { name: /new job/i })[0].getAttribute('href')).toBe('/recruitment/jobs/new')
  })
})
