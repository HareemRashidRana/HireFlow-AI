// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { hr, list, makeFeedback, makeInterview, overview, rec, scale, stats } from '../../../test/interviewFixtures'
import { renderAs } from '../../../test/render'
import { ApplicationInterviewsCard } from '../components/ApplicationInterviewsCard'
import { InterviewDetailPage } from './InterviewDetailPage'
import { InterviewsPage } from './InterviewsPage'

const api = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    list: fn(), get: fn(), forApplication: fn(), stats: fn(), feedback: fn(), ratingScale: fn(), history: fn(), interviewers: fn(),
    confirm: fn(), complete: fn(), cancel: fn(), reschedule: fn(), create: fn(),
  }
})
vi.mock('../../../api/interviews', () => ({ interviewsApi: api }))
vi.mock('../../../api/applications', () => ({ applicationsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, stage_counts: {} }) } }))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.stats.mockResolvedValue(stats)
  api.ratingScale.mockResolvedValue(scale)
  api.history.mockResolvedValue([])
  api.interviewers.mockResolvedValue([rec, hr])
  api.feedback.mockResolvedValue(overview([]))
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

describe('InterviewsPage', () => {
  const render = (role: 'recruiter' | 'hr_manager' = 'recruiter') => renderAs(<InterviewsPage />, { role })

  it('shows the heading, the real stats and the upcoming list, and never mentions the stage changing', async () => {
    api.list.mockResolvedValue(list([makeInterview({ title: 'Technical interview' })]))
    render()
    expect(screen.getByRole('heading', { name: 'Interviews' })).toBeTruthy()
    expect(await screen.findByText('Feedback pending')).toBeTruthy()
    expect(await screen.findByText(/Technical interview: Sana Iqbal/)).toBeTruthy()
    expect(screen.getByText(/Scheduling never changes an application's stage/)).toBeTruthy()
  })

  it('has an empty upcoming state', async () => {
    api.list.mockResolvedValue(list([]))
    render()
    expect(await screen.findByText(/Nothing coming up/)).toBeTruthy()
  })

  it('opens on the calendar and asks the server for a bounded week', async () => {
    api.list.mockResolvedValue(list([]))
    render()
    expect(screen.getByRole('tab', { name: 'Calendar' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(api.list.mock.calls.some(([p]) => p?.page_size === 100 && p.starts_from && p.starts_to)).toBe(true))
  })

  it('shows an error with a retry when the calendar cannot load', async () => {
    api.list.mockImplementation((p: { page_size?: number }) => (p.page_size === 100 ? Promise.reject(new ApiError('boom', 500)) : Promise.resolve(list([]))))
    render()
    expect(await screen.findByText("Couldn't load the calendar")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('the list view pages, filters and never sends a sort or rating parameter', async () => {
    api.list.mockResolvedValue(list([makeInterview(), makeInterview({ id: 'int-2', title: 'Second' })], { total: 25, page_size: 10 }))
    render()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'All interviews' }))
    expect(await screen.findByText('25 interviews, in start-time order')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(api.list.mock.calls.some(([p]) => p?.page === 2)).toBe(true))
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled')
    await waitFor(() => expect(api.list.mock.calls.some(([p]) => p?.status === 'cancelled' && p.page === 1)).toBe(true))
    for (const [p] of api.list.mock.calls) expect(Object.keys(p ?? {}).join(' ')).not.toMatch(/sort|order|rating|score|rank/)
  })

  it('"mine" asks for the signed-in interviewer only', async () => {
    api.list.mockResolvedValue(list([makeInterview()]))
    render()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'All interviews' }))
    await user.click(await screen.findByLabelText('Only interviews I am on'))
    await waitFor(() => expect(api.list.mock.calls.some(([p]) => p?.interviewer_id === 'me')).toBe(true))
  })

  it('says when filters match nothing, and clears them', async () => {
    api.list.mockResolvedValue(list([], { total: 0 }))
    render()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'All interviews' }))
    expect(await screen.findByText('No interviews yet')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Type'), 'panel')
    expect(await screen.findByText('No interviews match')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('No interviews yet')).toBeTruthy()
  })

  it('the Schedule button opens the scheduling dialog', async () => {
    api.list.mockResolvedValue(list([]))
    render()
    await userEvent.setup().click(screen.getAllByRole('button', { name: /Schedule interview/ })[0])
    expect(await screen.findByLabelText('Search applications')).toBeTruthy()
  })
})

describe('InterviewDetailPage', () => {
  const at = (role: 'recruiter' | 'hr_manager' = 'recruiter') =>
    renderAs(<InterviewDetailPage />, { path: '/recruitment/interviews/:id', url: '/recruitment/interviews/int-1', role })
  const all = ['view_history', 'confirm', 'reschedule', 'cancel', 'manage_interviewers', 'save_feedback_draft']

  it('shows the interview, its zone and where it is, with the meeting link opening safely', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: all, meeting_url: 'https://meet.example.com/abc', my_feedback_status: null }))
    at()
    expect(await screen.findByRole('heading', { name: 'Technical interview' })).toBeTruthy()
    expect(screen.getByText('Fri, 20 Nov 2026, 10:00-11:00 (UTC+05:00)')).toBeTruthy()
    expect(screen.getByText(/Time zone Asia\/Karachi/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open the meeting' })
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('link', { name: 'Sana Iqbal' }).getAttribute('href')).toBe('/recruitment/candidates/cand-1')
  })

  it('offers exactly the actions the server allows', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['view_history', 'confirm', 'cancel'], my_feedback_status: null }))
    at()
    await screen.findByRole('heading', { name: 'Technical interview' })
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull()
  })

  it('confirms and reloads', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['confirm'], my_feedback_status: null }))
    api.confirm.mockResolvedValue(makeInterview({ status: 'confirmed' }))
    at()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith('int-1'))
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(1))
    expect(await screen.findByText('Interview confirmed.')).toBeTruthy()
  })

  it('shows a refusal from the server as a message', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['complete'], my_feedback_status: null }))
    api.complete.mockRejectedValue(new ApiError('The interview has not started yet.', 422))
    at()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Mark completed' }))
    expect(await screen.findByText('The interview has not started yet.')).toBeTruthy()
  })

  it('opens the cancel dialog, which needs a reason', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['cancel'], my_feedback_status: null }))
    at()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByLabelText(/^Reason/)).toBeTruthy()
  })

  it('a cancelled interview shows why and takes no feedback', async () => {
    api.get.mockResolvedValue(makeInterview({ status: 'cancelled', cancellation_reason: 'Panel unavailable', cancelled_at: '2026-11-18T08:00:00Z', allowed_actions: ['view_history'], my_feedback_status: 'none' }))
    at()
    expect(await screen.findByText(/Reason: Panel unavailable/)).toBeTruthy()
    expect(await screen.findByText('A cancelled interview takes no feedback.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit feedback' })).toBeNull()
  })

  it('a rescheduled interview points to the new one', async () => {
    api.get.mockResolvedValue(makeInterview({ status: 'rescheduled', rescheduled_to_id: 'int-2', allowed_actions: ['view_history'], my_feedback_status: null }))
    at()
    const link = await screen.findByRole('link', { name: 'See the new interview' })
    expect(link.getAttribute('href')).toBe('/recruitment/interviews/int-2')
  })

  it('an interview made by rescheduling links back to the original', async () => {
    api.get.mockResolvedValue(makeInterview({ rescheduled_from_id: 'int-0', allowed_actions: ['view_history'], my_feedback_status: null }))
    at()
    expect((await screen.findByRole('link', { name: 'See the original' })).getAttribute('href')).toBe('/recruitment/interviews/int-0')
  })

  it('says plainly when the candidate was anonymized', async () => {
    api.get.mockResolvedValue(makeInterview({ scrubbed: true, allowed_actions: ['view_history'], my_feedback_status: 'submitted' }))
    at()
    expect(await screen.findByText(/This candidate was anonymized/)).toBeTruthy()
    expect(await screen.findByText('Feedback can no longer be changed.')).toBeTruthy()
  })

  it('an interviewer sees their feedback form, and only an interviewer', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['view_history', 'save_feedback_draft'], my_feedback_status: 'none' }))
    at()
    expect(await screen.findByRole('heading', { name: 'Your feedback' })).toBeTruthy()
    expect(await screen.findByRole('radiogroup', { name: 'Overall rating' })).toBeTruthy()
  })

  it('a non-interviewer has no feedback form but can still read the summary', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['view_history'], my_feedback_status: null }))
    api.feedback.mockResolvedValue(overview([makeFeedback({ interviewer: hr })]))
    at('hr_manager')
    expect(await screen.findByText('hr@example.com')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your feedback' })).toBeNull()
  })

  it('shows not found for an unknown interview, without a retry', async () => {
    api.get.mockRejectedValue(new ApiError('Interview not found', 404))
    at()
    expect(await screen.findByText('Interview not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('link', { name: /All interviews/ })).toBeTruthy()
  })

  it('shows a retryable error for other failures', async () => {
    api.get.mockRejectedValueOnce(new ApiError('Server down', 500)).mockResolvedValueOnce(makeInterview({ allowed_actions: [], my_feedback_status: null }))
    at()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Technical interview' })).toBeTruthy()
  })

  it('lists the interviewers in the sidebar and history', async () => {
    api.get.mockResolvedValue(makeInterview({ allowed_actions: ['view_history'], my_feedback_status: null }))
    at()
    const card = (await screen.findByRole('heading', { name: 'Interviewers' })).closest('div') as HTMLElement
    expect(within(card.parentElement as HTMLElement).getAllByText(/recruiter@example.com/).length).toBeGreaterThan(0)
    await waitFor(() => expect(api.history).toHaveBeenCalledWith('int-1', expect.anything()))
  })
})

describe('ApplicationInterviewsCard', () => {
  const card = (role: 'recruiter' | 'hr_manager' | 'employee' = 'recruiter', closed = false) =>
    renderAs(<ApplicationInterviewsCard applicationId="app-1" label="Sana Iqbal, Backend Engineer" closed={closed} />, { role })

  it('lists this application’s interviews with links', async () => {
    api.forApplication.mockResolvedValue(list([makeInterview()]))
    card()
    const link = await screen.findByRole('link', { name: /Technical interview/ })
    expect(link.getAttribute('href')).toBe('/recruitment/interviews/int-1')
    expect(api.forApplication).toHaveBeenCalledWith('app-1', expect.anything())
  })

  it('has an empty state and opens the dialog for this application', async () => {
    api.forApplication.mockResolvedValue(list([]))
    card()
    expect(await screen.findByText('No interviews scheduled yet.')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule interview' }))
    expect(await screen.findByText('Sana Iqbal, Backend Engineer')).toBeTruthy()
    expect(screen.queryByLabelText('Search applications')).toBeNull()
  })

  it('a closed application cannot take new interviews and says why', async () => {
    api.forApplication.mockResolvedValue(list([]))
    card('recruiter', true)
    expect(await screen.findByText(/This application is closed, so no new interviews/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Schedule interview' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is absent for a role without interview access, and asks the server for nothing', () => {
    const { container } = card('employee')
    expect(container.textContent).toBe('')
    expect(api.forApplication).not.toHaveBeenCalled()
  })

  it('shows an error with a retry', async () => {
    api.forApplication.mockRejectedValueOnce(new ApiError('x', 500)).mockResolvedValueOnce(list([]))
    card()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No interviews scheduled yet.')).toBeTruthy()
  })
})
