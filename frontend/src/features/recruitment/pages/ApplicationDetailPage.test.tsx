// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeApplication, makeStaff } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import type { Application } from '../../../types/application'
import { ApplicationDetailPage } from './ApplicationDetailPage'

const get = vi.fn()
const update = vi.fn()
const recruiters = vi.fn()
const changeStage = vi.fn()
const reopen = vi.fn()
vi.mock('../../../api/interviews', () => ({
  interviewsApi: {
    forApplication: async () => ({ items: [], total: 0, page: 1, page_size: 50 }),
    interviewers: async () => [],
  },
}))
vi.mock('../../../api/screening', () => ({
  screeningApi: {
    forApplication: async () => ({
      application_id: 'x',
      readiness: { can_assess: false, blocker: 'no_active_resume', blocker_text: 'This candidate has no active resume. Upload a resume first.' },
      job_requirements: { required: [], preferred: [] },
      items: [],
      total: 0,
    }),
    forJob: async () => ({ job_id: 'x', items: [], total: 0, page: 1, page_size: 10 }),
    get: async () => {
      throw new Error('unused')
    },
    create: async () => {
      throw new Error('unused')
    },
    review: async () => {
      throw new Error('unused')
    },
    methodology: async () => {
      throw new Error('unused')
    },
  },
}))
vi.mock('../../../api/applications', () => ({
  applicationsApi: {
    get: (...a: unknown[]) => get(...a),
    update: (...a: unknown[]) => update(...a),
    recruiters: (...a: unknown[]) => recruiters(...a),
    changeStage: (...a: unknown[]) => changeStage(...a),
    reopen: (...a: unknown[]) => reopen(...a),
  },
}))

const staff = [
  makeStaff({ id: 'user-admin', email: 'admin@example.com', role: 'admin' }),
  makeStaff({ id: 'user-recruiter', email: 'recruiter@example.com' }),
  makeStaff({ id: 'staff-9', email: 'colleague@example.com' }),
]

beforeEach(() => {
  for (const m of [get, update, recruiters, changeStage, reopen]) m.mockReset()
  recruiters.mockResolvedValue(staff)
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function render(app: Application, role: UserRole = 'recruiter') {
  get.mockResolvedValue(app)
  const view = renderAs(<ApplicationDetailPage />, {
    path: '/recruitment/applications/:id',
    url: `/recruitment/applications/${app.id}`,
    role,
  })
  return { ...view, user: userEvent.setup() }
}
const heading = () => screen.findByRole('heading', { level: 1 })
const button = (name: string | RegExp) => screen.queryByRole('button', { name })

describe('content', () => {
  it('shows a loading state first', () => {
    get.mockReturnValue(new Promise(() => {}))
    renderAs(<ApplicationDetailPage />, { path: '/recruitment/applications/:id', url: '/recruitment/applications/x' })
    expect(screen.getByText('Loading application…')).toBeTruthy()
  })

  it('shows the candidate, job, stage and dates', async () => {
    render(makeApplication({ stage: 'interview', allowed_stages: ['shortlisted', 'offer', 'rejected', 'withdrawn'] }))
    expect((await heading()).textContent).toBe('Sana Iqbal')
    expect(screen.getAllByText('Interview').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Senior Backend Engineer' })[0].getAttribute('href')).toBe('/recruitment/jobs/job-1')
    expect(screen.getByRole('link', { name: 'Sana Iqbal' }).getAttribute('href')).toBe('/recruitment/candidates/cand-1')
    expect(screen.getByRole('link', { name: 'sana.iqbal@example.com' }).getAttribute('href')).toBe('mailto:sana.iqbal@example.com')
    expect(screen.getByText('Backend Developer at Acme Ltd')).toBeTruthy()
    expect(screen.getByText('In this stage since')).toBeTruthy()
  })

  it('shows pipeline progress with the current stage marked', async () => {
    render(makeApplication({ stage: 'shortlisted' }))
    await heading()
    const steps = within(screen.getByRole('list', { name: 'Pipeline progress' })).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['Applied', 'Screening', 'Shortlisted', 'Interview', 'Offer', 'Hired'])
    expect(steps.filter((s) => s.getAttribute('aria-current') === 'step').map((s) => s.textContent)).toEqual(['Shortlisted'])
  })

  it('replaces the progress bar with a note for rejected applications', async () => {
    render(makeApplication({ stage: 'rejected', allowed_stages: [], can_reopen: true }), 'hr_manager')
    await heading()
    expect(screen.queryByRole('list', { name: 'Pipeline progress' })).toBeNull()
    expect(screen.getByText(/This application was rejected\. It can be reopened\./)).toBeTruthy()
  })

  it('shows the history timeline from the server', async () => {
    render(
      makeApplication({
        events: [
          { id: '1', event_type: 'created', from_value: null, to_value: 'applied', note: null, actor: staff[0], created_at: '2026-11-03T09:00:00Z' },
          { id: '2', event_type: 'stage_changed', from_value: 'applied', to_value: 'screening', note: 'Looks promising', actor: staff[1], created_at: '2026-11-04T09:00:00Z' },
        ],
      }),
    )
    await heading()
    const items = within(screen.getByRole('list', { name: 'Application history' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[1].textContent).toContain('Moved from Applied to Screening')
    expect(items[1].textContent).toContain('Looks promising')
    expect(items[1].textContent).toContain('recruiter@example.com')
  })

  it('warns that a closed job only allows rejecting or withdrawing', async () => {
    const app = makeApplication({ allowed_stages: ['rejected', 'withdrawn'] })
    render({ ...app, job: { ...app.job, status: 'closed' } })
    await heading()
    expect(screen.getAllByRole('status').some((el) => /job is closed/.test(el.textContent ?? ''))).toBe(true)
  })

  it('shows a not-found message for an unknown application', async () => {
    get.mockRejectedValue(new ApiError('Application not found', 404))
    renderAs(<ApplicationDetailPage />, { path: '/recruitment/applications/:id', url: '/recruitment/applications/x' })
    expect(await screen.findByText('Application not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows a retryable error for other failures', async () => {
    get.mockRejectedValueOnce(new ApiError('Server is down', 500))
    const user = userEvent.setup()
    renderAs(<ApplicationDetailPage />, { path: '/recruitment/applications/:id', url: '/recruitment/applications/x' })
    expect(await screen.findByText('Server is down')).toBeTruthy()
    get.mockResolvedValue(makeApplication())
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await heading()).textContent).toBe('Sana Iqbal')
  })

  it('renders internal notes as text, never HTML', async () => {
    const evil = '<img src=x onerror="window.__x=1"><b>hi</b>'
    render(makeApplication({ internal_notes: evil }), 'recruiter')
    await heading()
    expect((screen.getByLabelText(/Notes about this application/) as HTMLTextAreaElement).value).toBe(evil)
    expect(document.querySelector('main img, img[src="x"], b')).toBeNull()
  })
})

describe('actions follow what the server allowed', () => {
  it('shows Change stage when there is a move, and not for a final application', async () => {
    const { unmount } = render(makeApplication({ stage: 'applied' }))
    await heading()
    expect(button('Change stage')).toBeTruthy()
    unmount()
    render(makeApplication({ stage: 'hired', allowed_stages: [], can_reopen: false }), 'admin')
    await heading()
    expect(button('Change stage')).toBeNull()
    expect(button('Reopen')).toBeNull()
  })

  it('shows Reopen only when the server says it can be reopened', async () => {
    const { unmount } = render(makeApplication({ stage: 'rejected', allowed_stages: [], can_reopen: true }), 'hr_manager')
    await heading()
    expect(button('Reopen')).toBeTruthy()
    unmount()
    render(makeApplication({ stage: 'rejected', allowed_stages: [], can_reopen: false }), 'recruiter')
    await heading()
    expect(button('Reopen')).toBeNull()
  })

  it('offers hiring to HR when the server allows it, and never invents it for a recruiter', async () => {
    const hr = render(makeApplication({ stage: 'offer', allowed_stages: ['interview', 'hired', 'rejected', 'withdrawn'] }), 'hr_manager')
    await heading()
    await hr.user.click(button('Change stage')!)
    expect(screen.getByRole('radio', { name: /^Hired/ })).toBeTruthy()
    hr.unmount()
    const rec = render(makeApplication({ stage: 'offer', allowed_stages: ['interview', 'rejected', 'withdrawn'] }), 'recruiter')
    await heading()
    await rec.user.click(button('Change stage')!)
    expect(screen.queryByRole('radio', { name: /^Hired/ })).toBeNull()
  })

  it('changes the stage and reloads the application', async () => {
    changeStage.mockResolvedValue(makeApplication({ stage: 'screening' }))
    const { user } = render(makeApplication())
    await heading()
    await user.click(button('Change stage')!)
    await user.click(screen.getByRole('button', { name: 'Move to Screening' }))
    await waitFor(() => expect(changeStage).toHaveBeenCalledWith('app-1', 'screening', undefined))
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1))
  })

  it('reopens and reloads', async () => {
    reopen.mockResolvedValue(makeApplication())
    const { user } = render(makeApplication({ stage: 'withdrawn', allowed_stages: [], can_reopen: true }), 'admin')
    await heading()
    await user.click(button('Reopen')!)
    await user.click(screen.getByRole('button', { name: 'Reopen application' }))
    await waitFor(() => expect(reopen).toHaveBeenCalledWith('app-1', undefined))
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1))
  })
})

describe('assignment', () => {
  it('lets HR pick any active recruiter from a list', async () => {
    update.mockResolvedValue(makeApplication())
    const { user } = render(makeApplication(), 'hr_manager')
    await heading()
    const select = (await screen.findByLabelText('Assigned recruiter')) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBe(4))
    await user.selectOptions(select, 'staff-9')
    await waitFor(() => expect(update).toHaveBeenCalledWith('app-1', { assigned_recruiter_id: 'staff-9' }))
  })

  it('lets HR unassign', async () => {
    update.mockResolvedValue(makeApplication())
    const { user } = render(makeApplication({ assigned_recruiter: staff[2] }), 'admin')
    await heading()
    const select = (await screen.findByLabelText('Assigned recruiter')) as HTMLSelectElement
    expect(select.value).toBe('staff-9')
    await user.selectOptions(select, '')
    await waitFor(() => expect(update).toHaveBeenCalledWith('app-1', { assigned_recruiter_id: null }))
  })

  it('still shows an assignee who is no longer in the active list', async () => {
    render(makeApplication({ assigned_recruiter: makeStaff({ id: 'gone', email: 'gone@example.com' }) }), 'admin')
    await heading()
    const select = (await screen.findByLabelText('Assigned recruiter')) as HTMLSelectElement
    expect(select.value).toBe('gone')
  })

  it('gives a recruiter only "Assign to me", never a list of colleagues', async () => {
    update.mockResolvedValue(makeApplication())
    const { user } = render(makeApplication(), 'recruiter')
    await heading()
    expect(screen.queryByLabelText('Assigned recruiter')).toBeNull()
    expect(recruiters).not.toHaveBeenCalled() // the recruiter list is not even requested
    await user.click(button('Assign to me')!)
    await waitFor(() => expect(update).toHaveBeenCalledWith('app-1', { assigned_recruiter_id: 'user-recruiter' }))
  })

  it('lets a recruiter release their own claim, but only theirs', async () => {
    update.mockResolvedValue(makeApplication())
    const mine = render(makeApplication({ assigned_recruiter: staff[1] }), 'recruiter')
    await heading()
    await mine.user.click(button('Release')!)
    await waitFor(() => expect(update).toHaveBeenCalledWith('app-1', { assigned_recruiter_id: null }))
    mine.unmount()
    render(makeApplication({ assigned_recruiter: staff[2] }), 'recruiter')
    await heading()
    expect(button('Release')).toBeNull()
    expect(screen.getByText('colleague@example.com')).toBeTruthy()
  })

  it('reports a refusal from the server', async () => {
    update.mockRejectedValue(new ApiError('Recruiters can only assign applications to themselves. Ask an HR manager.', 403))
    const { user } = render(makeApplication(), 'recruiter')
    await heading()
    await user.click(button('Assign to me')!)
    expect(await screen.findByText(/Ask an HR manager/)).toBeTruthy()
  })
})

describe('internal notes', () => {
  it('saves trimmed notes, and only when they changed', async () => {
    update.mockResolvedValue(makeApplication())
    const { user } = render(makeApplication({ internal_notes: 'Old note' }))
    await heading()
    const save = button('Save notes') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const box = screen.getByLabelText(/Notes about this application/)
    await user.clear(box)
    await user.type(box, '  New note  ')
    expect(save.disabled).toBe(false)
    await user.click(save)
    await waitFor(() => expect(update).toHaveBeenCalledWith('app-1', { internal_notes: 'New note' }))
  })

  it('clears notes by sending null', async () => {
    update.mockResolvedValue(makeApplication())
    const { user } = render(makeApplication({ internal_notes: 'Old note' }))
    await heading()
    await user.clear(screen.getByLabelText(/Notes about this application/))
    await user.click(button('Save notes')!)
    await waitFor(() => expect(update).toHaveBeenCalledWith('app-1', { internal_notes: null }))
  })

  it('keeps what was typed when saving fails', async () => {
    update.mockRejectedValue(new ApiError('Could not save', 500))
    const { user } = render(makeApplication())
    await heading()
    await user.type(screen.getByLabelText(/Notes about this application/), 'Important')
    await user.click(button('Save notes')!)
    expect(await screen.findByText('Could not save')).toBeTruthy()
    expect((screen.getByLabelText(/Notes about this application/) as HTMLTextAreaElement).value).toBe('Important')
  })
})
