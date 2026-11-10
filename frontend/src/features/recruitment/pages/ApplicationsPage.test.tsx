// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import {
  emptyStageCounts,
  makeApplicationItem,
  makeApplicationList,
  makeJob,
  makeJobList,
  makeStaff,
} from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { renderAs } from '../../../test/render'
import { ApplicationsPage } from './ApplicationsPage'

const list = vi.fn()
const summary = vi.fn()
const recruiters = vi.fn()
const jobsList = vi.fn()
vi.mock('../../../api/applications', () => ({
  applicationsApi: {
    list: (...a: unknown[]) => list(...a),
    summary: (...a: unknown[]) => summary(...a),
    recruiters: (...a: unknown[]) => recruiters(...a),
  },
}))
vi.mock('../../../api/jobs', () => ({ jobsApi: { list: (...a: unknown[]) => jobsList(...a) } }))

const rana = makeStaff({ id: 'staff-1', email: 'rana@example.com' })
const apps = [
  makeApplicationItem({ id: 'a1', stage: 'applied' }),
  makeApplicationItem({
    id: 'a2', stage: 'interview', source: 'referral', assigned_recruiter: rana,
    candidate: { id: 'c2', first_name: 'Bilal', last_name: 'Ahmed', email: 'bilal@corp.io' },
    job: { id: 'job-2', title: 'Product Designer', department: 'Design', status: 'open' },
  }),
  makeApplicationItem({
    id: 'a3', stage: 'rejected',
    candidate: { id: 'c3', first_name: 'Omar', last_name: 'Farooq', email: 'omar@example.com' },
  }),
]

beforeEach(() => {
  list.mockReset()
  summary.mockReset()
  recruiters.mockReset()
  jobsList.mockReset()
  list.mockResolvedValue(makeApplicationList(apps))
  summary.mockResolvedValue({
    total: 3, by_stage: { ...emptyStageCounts(), applied: 1, interview: 1, rejected: 1 }, hired: 0,
    open_jobs_with_applications: 2, recent: [],
  })
  recruiters.mockResolvedValue([rana])
  jobsList.mockResolvedValue(makeJobList([makeJob({ id: 'job-1', title: 'Senior Backend Engineer' }), makeJob({ id: 'job-2', title: 'Product Designer' })]))
})

const lastParams = () => list.mock.calls.at(-1)![0]
const render = (url = '/recruitment/applications', role: 'admin' | 'hr_manager' | 'recruiter' = 'recruiter') =>
  renderAs(
    <>
      <ApplicationsPage />
      <LocationProbe />
    </>,
    { path: '/recruitment/applications', url, role },
  )
const urlNow = () => screen.getByTestId('location').textContent ?? ''
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

describe('listing', () => {
  it('shows a loading state, then each application with job, stage and recruiter', async () => {
    render()
    expect(screen.getByText('Loading applications…')).toBeTruthy()
    const rows = await screen.findAllByRole('row')
    const bilal = rows.find((r) => r.textContent?.includes('Bilal Ahmed'))!
    expect(within(bilal).getByText('bilal@corp.io')).toBeTruthy()
    expect(within(bilal).getByText('Product Designer')).toBeTruthy()
    expect(within(bilal).getByText('Interview')).toBeTruthy()
    expect(within(bilal).getByText('rana@example.com')).toBeTruthy()
    expect(within(bilal).getByText('Referral')).toBeTruthy()
  })

  it('shows a dash for an unassigned application', async () => {
    render()
    const sana = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Sana Iqbal'))!
    expect(within(sana).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('links each application to its page', async () => {
    render()
    expect((await screen.findAllByRole('link', { name: 'Bilal Ahmed' }))[0].getAttribute('href')).toBe('/recruitment/applications/a2')
  })

  it('renders both a table (md+) and cards (small screens), so it works on a phone', async () => {
    render()
    await screen.findAllByRole('row')
    const table = document.querySelector('table')!
    expect(table.parentElement!.className).toContain('hidden')
    expect(table.parentElement!.className).toContain('md:block')
    const cards = document.querySelector('ul.md\\:hidden')!
    expect(within(cards as HTMLElement).getAllByRole('link')).toHaveLength(3)
  })

  it('asks for the first page with no filters', async () => {
    render()
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ q: '', stage: '', job_id: '', recruiter_id: '', source: '', page: 1, page_size: 10 })
  })
})

describe('overview', () => {
  it('shows real totals from the server, not made-up numbers', async () => {
    render()
    const overview = await screen.findByRole('region', { name: 'Recruitment overview' })
    expect(within(overview).getByText('Total applications').nextSibling!.textContent).toBe('3')
    expect(within(overview).getByText('In the pipeline').nextSibling!.textContent).toBe('2')
    expect(within(overview).getByText('Hired').nextSibling!.textContent).toBe('0')
    expect(within(overview).getByText('Open jobs with applicants').nextSibling!.textContent).toBe('2')
  })

  it('still lists applications if the overview cannot load', async () => {
    summary.mockRejectedValue(new ApiError('boom', 500))
    render()
    expect((await screen.findAllByRole('row')).length).toBeGreaterThan(1)
    expect(screen.queryByRole('region', { name: 'Recruitment overview' })).toBeNull()
  })
})

describe('stage tabs', () => {
  it('shows the count for every stage from the server', async () => {
    list.mockResolvedValue(makeApplicationList(apps, { stage_counts: { ...emptyStageCounts(), applied: 5, interview: 2, hired: 1 } }))
    render()
    await screen.findAllByRole('row')
    expect(screen.getByRole('tab', { name: /^All 8/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^Applied 5/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^Hired 1/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^Rejected 0/ })).toBeTruthy()
  })

  it('filters by the chosen stage and puts it in the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.click(screen.getByRole('tab', { name: /^Interview/ }))
    await waitFor(() => expect(lastParams()).toMatchObject({ stage: 'interview', page: 1 }))
    expect(urlNow()).toContain('stage=interview')
    expect(screen.getByRole('tab', { name: /^Interview/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('ignores an invalid stage in the URL', async () => {
    render('/recruitment/applications?stage=promoted')
    await screen.findAllByRole('row')
    expect(lastParams().stage).toBe('')
  })
})

describe('search keeps personal data out of the address bar', () => {
  it('searches after a pause but never writes the search text to the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.type(screen.getByLabelText('Search applications'), 'bilal@corp.io')
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'bilal@corp.io' }), { timeout: 2000 })
    await settle()
    expect(urlNow()).not.toMatch(/bilal|corp|q=/)
  })

  it('does not search on every keystroke', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    const before = list.mock.calls.length
    await user.type(screen.getByLabelText('Search applications'), 'abcdef')
    expect(list.mock.calls.length).toBe(before)
  })
})

describe('filters', () => {
  it('filters by job, recruiter and source through the server', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await waitFor(() => expect(within(screen.getByLabelText('Filter by job')).getAllByRole('option').length).toBe(3))
    await user.selectOptions(screen.getByLabelText('Filter by job'), 'job-2')
    await waitFor(() => expect(lastParams()).toMatchObject({ job_id: 'job-2' }))
    await user.selectOptions(screen.getByLabelText('Filter by recruiter'), 'staff-1')
    await waitFor(() => expect(lastParams()).toMatchObject({ job_id: 'job-2', recruiter_id: 'staff-1' }))
    await user.selectOptions(screen.getByLabelText('Filter by source'), 'referral')
    await waitFor(() => expect(lastParams()).toMatchObject({ source: 'referral' }))
    expect(urlNow()).toContain('job=job-2')
    expect(urlNow()).toContain('recruiter=staff-1')
  })

  it('filters by date', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.type(screen.getByLabelText('Applied from'), '2026-11-01')
    await waitFor(() => expect(lastParams()).toMatchObject({ applied_from: '2026-11-01' }))
    await user.type(screen.getByLabelText('Applied to'), '2026-11-30')
    await waitFor(() => expect(lastParams()).toMatchObject({ applied_from: '2026-11-01', applied_to: '2026-11-30' }))
  })

  it('reads filters from the URL (deep links and reload keep working)', async () => {
    render('/recruitment/applications?job=job-2&stage=offer&from=2026-01-01&page=2')
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ job_id: 'job-2', stage: 'offer', applied_from: '2026-01-01', page: 2 })
  })

  it('ignores malformed dates and unknown sources in the URL', async () => {
    render('/recruitment/applications?from=yesterday&source=carrier-pigeon')
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ applied_from: '', source: '' })
  })

  it('clears everything at once', async () => {
    const user = userEvent.setup()
    render('/recruitment/applications?job=job-2&stage=offer')
    await screen.findAllByRole('row')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ job_id: '', stage: '' }))
    expect(urlNow()).toBe('/recruitment/applications')
  })

  it('still works if the job and recruiter lists cannot load', async () => {
    jobsList.mockRejectedValue(new ApiError('nope', 500))
    recruiters.mockRejectedValue(new ApiError('nope', 500))
    render()
    expect((await screen.findAllByRole('row')).length).toBeGreaterThan(1)
  })
})

describe('pagination', () => {
  const many = Array.from({ length: 10 }, (_, i) => makeApplicationItem({ id: `p${i}` }))

  it('shows the range and moves between pages', async () => {
    list.mockResolvedValue(makeApplicationList(many, { total: 25 }))
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    expect(screen.getByText('Showing 1–10 of 25')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(lastParams().page).toBe(2))
    expect(urlNow()).toContain('page=2')
  })

  it('disables Next on the last page', async () => {
    list.mockResolvedValue(makeApplicationList(many.slice(0, 5), { total: 25, page: 3 }))
    render('/recruitment/applications?page=3')
    await screen.findAllByRole('row')
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Showing 21–25 of 25')).toBeTruthy()
  })

  it('goes back to page 1 when a filter changes', async () => {
    list.mockResolvedValue(makeApplicationList(many, { total: 25 }))
    const user = userEvent.setup()
    render('/recruitment/applications?page=3')
    await screen.findAllByRole('row')
    await user.click(screen.getByRole('tab', { name: /^Interview/ }))
    await waitFor(() => expect(lastParams()).toMatchObject({ stage: 'interview', page: 1 }))
  })
})

describe('empty and error states', () => {
  it('invites the first application, with a link to create one', async () => {
    list.mockResolvedValue(makeApplicationList([]))
    render()
    expect(await screen.findByText('No applications yet')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /New application/ })[0].getAttribute('href')).toBe('/recruitment/applications/new')
  })

  it('tells filtered-out users to widen the filters', async () => {
    list.mockResolvedValue(makeApplicationList([]))
    render('/recruitment/applications?stage=hired')
    expect(await screen.findByText('No applications match your filters')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('shows an error with retry, and retry works', async () => {
    list.mockRejectedValueOnce(new ApiError('Server is down', 500))
    const user = userEvent.setup()
    render()
    expect(await screen.findByText('Server is down')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByRole('row')).length).toBeGreaterThan(1)
  })

  it('keeps the old list and offers a retry when a later request fails', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    list.mockRejectedValueOnce(new ApiError('Lost connection', 0))
    await user.click(screen.getByRole('tab', { name: /^Interview/ }))
    expect(await screen.findByText('Lost connection')).toBeTruthy()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })
})

describe('permissions', () => {
  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s sees the New application button', async (role) => {
    render('/recruitment/applications', role)
    await screen.findAllByRole('row')
    expect(screen.getAllByRole('link', { name: /New application/ }).length).toBeGreaterThan(0)
  })

  it('links to the pipeline board', async () => {
    render()
    await screen.findAllByRole('row')
    expect(screen.getByRole('link', { name: /Pipeline board/ }).getAttribute('href')).toBe('/recruitment/pipeline')
  })
})
