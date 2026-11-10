// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeJob } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import type { Job } from '../../../types/job'
import { JobDetailPage } from './JobDetailPage'

const get = vi.fn()
const changeStatus = vi.fn()
const remove = vi.fn()
vi.mock('../../../api/jobs', () => ({
  jobsApi: {
    get: (...a: unknown[]) => get(...a),
    changeStatus: (...a: unknown[]) => changeStatus(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}))

beforeEach(() => {
  get.mockReset()
  changeStatus.mockReset()
  remove.mockReset()
})

function render(job: Job, role: UserRole = 'admin') {
  get.mockResolvedValue(job)
  const view = renderAs(<JobDetailPage />, {
    path: '/recruitment/jobs/:id',
    url: `/recruitment/jobs/${job.id}`,
    role,
  })
  return { ...view, user: userEvent.setup() }
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name })
const link = (name: string | RegExp) => screen.queryByRole('link', { name })

describe('content', () => {
  it('shows a loading state, then the job', async () => {
    get.mockReturnValue(new Promise(() => {}))
    renderAs(<JobDetailPage />, { path: '/recruitment/jobs/:id', url: '/recruitment/jobs/job-1' })
    expect(screen.getByText('Loading job…')).toBeTruthy()
  })

  it('shows the header, requirements, details and timeline', async () => {
    render(
      makeJob({
        status: 'open',
        opened_at: '2026-11-03T10:00:00Z',
        hiring_manager_id: 'e1',
        hiring_manager: { id: 'e1', first_name: 'Ayesha', last_name: 'Khan', job_title: 'CTO' },
      }),
    )
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Senior Backend Engineer')
    expect(screen.getByText('Engineering · Lahore, Pakistan')).toBeTruthy()
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
    expect(screen.getByText('Build and maintain our HR platform.')).toBeTruthy()
    expect(screen.getByText('Python')).toBeTruthy()
    expect(screen.getByText('SQL')).toBeTruthy()
    expect(screen.getByText('React')).toBeTruthy()
    expect(screen.getByText('3 years')).toBeTruthy()
    expect(screen.getByText('PKR 200,000 – 350,000')).toBeTruthy()
    expect(screen.getByText('3 Nov 2026')).toBeTruthy() // published
  })

  it('links the hiring manager to their employee record for staff', async () => {
    render(makeJob({ hiring_manager_id: 'e1', hiring_manager: { id: 'e1', first_name: 'Ayesha', last_name: 'Khan', job_title: 'CTO' } }))
    const manager = await screen.findByRole('link', { name: 'Ayesha Khan' })
    expect(manager.getAttribute('href')).toBe('/employees/e1')
  })

  it('handles a job with nothing optional filled in', async () => {
    render(
      makeJob({
        description: '',
        required_skills: [],
        nice_to_have_skills: [],
        min_experience_years: null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
      }),
    )
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/no description yet/i)).toBeTruthy()
    expect(screen.getAllByText('None listed')).toHaveLength(2)
    expect(screen.getByText('Not specified')).toBeTruthy()
    expect(screen.getByText('Not set')).toBeTruthy()
    expect(screen.getByText('Not assigned')).toBeTruthy()
    expect(screen.getByText('Not yet')).toBeTruthy() // not published
  })

  it('shows the closed date for closed jobs', async () => {
    render(makeJob({ status: 'closed', opened_at: '2026-10-01T00:00:00Z', closed_at: '2026-11-05T00:00:00Z' }))
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText('Closed', { selector: 'dt' })).toBeTruthy()
    expect(screen.getByText('5 Nov 2026')).toBeTruthy()
  })

  it('renders user-written text as plain text, never as HTML', async () => {
    const { container } = render(
      makeJob({
        title: '<img src=x onerror=alert(1)>Engineer',
        description: '<script>alert(1)</script><b>bold</b>',
        required_skills: ['<i>Python</i>'],
      }),
    )
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('<img src=x onerror=alert(1)>Engineer')
    expect(screen.getByText('<script>alert(1)</script><b>bold</b>')).toBeTruthy()
    expect(container.querySelector('script, b, i, img')).toBeNull()
  })
})

describe('what each role can do', () => {
  it('admin sees Edit and Delete on a draft', async () => {
    render(makeJob({ status: 'draft' }), 'admin')
    await screen.findByRole('heading', { level: 1 })
    expect(link('Edit')).toBeTruthy()
    expect(button('Delete')).toBeTruthy()
    expect(button('Publish job')).toBeTruthy()
  })

  it.each(['hr_manager', 'recruiter'] as const)('%s can edit and publish but not delete', async (role) => {
    render(makeJob({ status: 'draft' }), role)
    await screen.findByRole('heading', { level: 1 })
    expect(link('Edit')).toBeTruthy()
    expect(button('Publish job')).toBeTruthy()
    expect(button('Delete')).toBeNull()
  })

  it.each(['open', 'on_hold', 'closed'] as const)('not even admin can delete a %s job', async (status) => {
    render(makeJob({ status }), 'admin')
    await screen.findByRole('heading', { level: 1 })
    expect(button('Delete')).toBeNull()
  })

  it('closed jobs show only Reopen (no Edit)', async () => {
    render(makeJob({ status: 'closed' }), 'recruiter')
    await screen.findByRole('heading', { level: 1 })
    expect(link('Edit')).toBeNull()
    expect(button('Reopen job')).toBeTruthy()
    expect(button('Close job')).toBeNull()
  })

  it('open jobs show Edit, Put on hold and Close', async () => {
    render(makeJob({ status: 'open' }), 'recruiter')
    await screen.findByRole('heading', { level: 1 })
    expect(link('Edit')).toBeTruthy()
    expect(button('Put on hold')).toBeTruthy()
    expect(button('Close job')).toBeTruthy()
  })

  it('the edit link points at the edit page', async () => {
    render(makeJob({ id: 'abc' }), 'recruiter')
    expect((await screen.findByRole('link', { name: 'Edit' })).getAttribute('href')).toBe('/recruitment/jobs/abc/edit')
  })
})

describe('changing status', () => {
  it('updates the badge and the actions immediately, without reloading', async () => {
    const { user } = render(makeJob({ status: 'draft' }), 'recruiter')
    await screen.findByRole('heading', { level: 1 })
    changeStatus.mockResolvedValue(makeJob({ status: 'open', opened_at: '2026-11-10T00:00:00Z' }))
    await user.click(screen.getByRole('button', { name: 'Publish job' }))
    await waitFor(() => expect(button('Put on hold')).toBeTruthy())
    expect(button('Publish job')).toBeNull()
    expect(screen.getByText('10 Nov 2026')).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(1) // no extra fetch
  })

  it('shows the server reason when publishing is refused', async () => {
    const { user } = render(makeJob({ status: 'draft', description: '' }), 'recruiter')
    await screen.findByRole('heading', { level: 1 })
    changeStatus.mockRejectedValue(new ApiError('Add a description before opening this job', 422))
    await user.click(screen.getByRole('button', { name: 'Publish job' }))
    expect(await screen.findByText('Add a description before opening this job')).toBeTruthy()
    expect(button('Publish job')).toBeTruthy() // still a draft
  })
})

describe('deleting a draft (admin)', () => {
  it('asks first, then deletes and returns to the list', async () => {
    remove.mockResolvedValue(undefined)
    const { user } = render(makeJob({ id: 'job-77', status: 'draft' }), 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete draft job?')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    expect(remove).toHaveBeenCalledWith('job-77')
    expect((await screen.findByTestId('location')).textContent).toBe('/recruitment/jobs')
    expect(await screen.findByText('Draft job deleted.')).toBeTruthy()
  })

  it('cancelling deletes nothing', async () => {
    const { user } = render(makeJob({ status: 'draft' }), 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })

  it('shows the error inside the dialog if the server refuses', async () => {
    remove.mockRejectedValue(new ApiError('Only draft jobs can be deleted. Close the job instead.', 409))
    const { user } = render(makeJob({ status: 'draft' }), 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete draft' }))
    expect(await within(screen.getByRole('dialog')).findByText(/only draft jobs can be deleted/i)).toBeTruthy()
    expect(screen.queryByTestId('location')).toBeNull() // stayed on the page
  })
})

describe('errors', () => {
  it('shows "Job not found" for a missing job', async () => {
    get.mockRejectedValue(new ApiError('Job not found', 404))
    renderAs(<JobDetailPage />, { path: '/recruitment/jobs/:id', url: '/recruitment/jobs/nope' })
    expect(await screen.findByText('Job not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows a retry for other errors and recovers', async () => {
    get.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0))
    get.mockResolvedValue(makeJob())
    const user = userEvent.setup()
    renderAs(<JobDetailPage />, { path: '/recruitment/jobs/:id', url: '/recruitment/jobs/job-1' })
    expect(await screen.findByText("Couldn't load the job")).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Senior Backend Engineer')
  })

  it('has a back link to the list', async () => {
    render(makeJob())
    expect((await screen.findByRole('link', { name: /all jobs/i })).getAttribute('href')).toBe('/recruitment/jobs')
  })
})

describe('applications links', () => {
  it('links to this job\'s applications (an id in the URL, no personal data)', async () => {
    render(makeJob({ id: 'job-5', status: 'open' }))
    await screen.findByRole('heading', { level: 1 })
    expect(link('Applications')!.getAttribute('href')).toBe('/recruitment/applications?job=job-5')
  })

  it('offers "Add application" only while the job is open', async () => {
    const open = render(makeJob({ id: 'job-5', status: 'open' }))
    await screen.findByRole('heading', { level: 1 })
    expect(link('Add application')!.getAttribute('href')).toBe('/recruitment/applications/new?job=job-5')
    open.unmount()
    for (const status of ['draft', 'on_hold', 'closed'] as const) {
      const view = render(makeJob({ id: 'job-5', status }))
      await screen.findByRole('heading', { level: 1 })
      expect(link('Add application')).toBeNull()
      view.unmount()
    }
  })
})
