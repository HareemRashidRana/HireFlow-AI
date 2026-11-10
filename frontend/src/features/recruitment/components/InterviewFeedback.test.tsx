// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { hr, makeFeedback, makeInterview, overview, rec, scale } from '../../../test/interviewFixtures'
import { renderAs } from '../../../test/render'
import { FeedbackForm } from './FeedbackForm'
import { FeedbackSummary } from './FeedbackSummary'
import { InterviewerManager } from './InterviewerManager'

const api = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    ratingScale: fn(), saveDraft: fn(), submitFeedback: fn(), editFeedback: fn(), revisions: fn(),
    interviewers: fn(), addInterviewer: fn(), removeInterviewer: fn(),
  }
})
vi.mock('../../../api/interviews', () => ({ interviewsApi: api }))

const onSaved = vi.fn()
beforeEach(() => {
  for (const m of [...Object.values(api), onSaved]) m.mockReset()
  api.ratingScale.mockResolvedValue(scale)
})

const started = makeInterview({ allowed_actions: ['view_history', 'submit_feedback', 'save_feedback_draft'], my_feedback_status: 'none' })
const notStarted = makeInterview({ allowed_actions: ['view_history', 'save_feedback_draft'], my_feedback_status: 'none' })

async function form(interview = started, mine = null as ReturnType<typeof makeFeedback> | null) {
  renderAs(<FeedbackForm interview={interview} mine={mine} onSaved={onSaved} />)
  await screen.findByRole('radiogroup', { name: 'Overall rating' })
  return userEvent.setup()
}
const rate = async (user: ReturnType<typeof userEvent.setup>, area: string, n: number) =>
  user.click(within(screen.getByRole('radiogroup', { name: `${area} rating` })).getByTitle(scale.scale[n - 1].label))

describe('FeedbackForm: writing feedback', () => {
  it('shows the rating scale with its descriptions and the four areas', async () => {
    await form()
    for (const a of ['Overall', 'Technical', 'Communication', 'Problem solving']) expect(screen.getByRole('radiogroup', { name: `${a} rating` })).toBeTruthy()
    expect(screen.getByText(/1\. Well below expectations/)).toBeTruthy()
    expect(screen.getByText(/5\. Well above expectations/)).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(20)
  })

  it('explains that it must be written by the interviewer and who can read what', async () => {
    await form()
    expect(screen.getByText(/Write this yourself/)).toBeTruthy()
    expect(screen.getByText(/A draft is only visible to you/)).toBeTruthy()
    expect(screen.getByText(/only you can ever see these/)).toBeTruthy()
  })

  it('saves a draft that may be incomplete', async () => {
    api.saveDraft.mockResolvedValue(makeFeedback({ status: 'draft' }))
    const user = await form()
    await user.type(screen.getByLabelText('Strengths'), 'Clear thinker')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith('int-1', expect.objectContaining({ strengths: 'Clear thinker', overall_rating: null, overall_feedback: null })))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(await screen.findByText('Draft saved.')).toBeTruthy()
  })

  it('refuses to submit without an overall rating and overall feedback, and sends nothing', async () => {
    const user = await form()
    await user.click(screen.getByRole('button', { name: 'Submit feedback' }))
    expect(await screen.findByText('Choose an overall rating before submitting.')).toBeTruthy()
    expect(screen.getByText('Write the overall feedback before submitting.')).toBeTruthy()
    expect(api.submitFeedback).not.toHaveBeenCalled()
  })

  it('submits what was written, trimmed, with private notes', async () => {
    api.submitFeedback.mockResolvedValue(makeFeedback({ is_mine: true }))
    const user = await form()
    await rate(user, 'Overall', 4)
    await rate(user, 'Communication', 5)
    await user.type(screen.getByLabelText(/^Overall feedback/), '  Solid conversation.  ')
    await user.type(screen.getByLabelText(/^Private notes/), 'for me only')
    await user.click(screen.getByRole('button', { name: 'Submit feedback' }))
    await waitFor(() => expect(api.submitFeedback).toHaveBeenCalledWith('int-1', expect.objectContaining({
      overall_rating: 4, communication_rating: 5, technical_rating: null, overall_feedback: 'Solid conversation.', private_notes: 'for me only',
    })))
    expect(await screen.findByText('Feedback submitted.')).toBeTruthy()
  })

  it('an optional rating can be cleared', async () => {
    const user = await form()
    await rate(user, 'Technical', 3)
    expect((within(screen.getByRole('radiogroup', { name: 'Technical rating' })).getByTitle('Meets expectations') as HTMLInputElement)).toBeTruthy()
    await user.click(within(screen.getByRole('radiogroup', { name: 'Technical rating' })).getByRole('button', { name: 'clear' }))
    expect(within(screen.getByRole('radiogroup', { name: 'Technical rating' })).queryByRole('button', { name: 'clear' })).toBeNull()
  })

  it('before the interview starts only a draft can be saved, and it says so', async () => {
    await form(notStarted)
    expect(screen.queryByRole('button', { name: 'Submit feedback' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy()
    expect(screen.getByText(/You can submit once the interview has started/)).toBeTruthy()
  })

  it('shows the server message and keeps the text when saving fails', async () => {
    api.submitFeedback.mockRejectedValue(new ApiError('This feedback was already submitted. Use the edit option to change it.', 409))
    const user = await form()
    await rate(user, 'Overall', 3)
    await user.type(screen.getByLabelText(/^Overall feedback/), 'keep this')
    await user.click(screen.getByRole('button', { name: 'Submit feedback' }))
    expect((await screen.findByRole('alert')).textContent).toContain('already submitted')
    expect((screen.getByLabelText(/^Overall feedback/) as HTMLTextAreaElement).value).toBe('keep this')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('refuses a rating-scale failure gracefully with a retry', async () => {
    api.ratingScale.mockReset()
    api.ratingScale.mockRejectedValueOnce(new ApiError('down', 500)).mockResolvedValueOnce(scale)
    renderAs(<FeedbackForm interview={started} mine={null} onSaved={onSaved} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('radiogroup', { name: 'Overall rating' })).toBeTruthy()
  })
})

describe('FeedbackForm: changing submitted feedback', () => {
  const submitted = makeFeedback({ is_mine: true, private_notes: 'my private words', version: 2 })

  it('starts from what was submitted and asks why it is being changed', async () => {
    await form(started, submitted)
    expect((screen.getByLabelText(/^Overall feedback/) as HTMLTextAreaElement).value).toBe('Solid conversation.')
    expect((screen.getByLabelText(/^Private notes/) as HTMLTextAreaElement).value).toBe('my private words')
    expect(screen.getByText(/version 2/)).toBeTruthy()
    expect(screen.getByLabelText(/^Why are you changing it/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
  })

  it('will not save a change without a reason', async () => {
    const user = await form(started, submitted)
    await user.type(screen.getByLabelText(/^Overall feedback/), ' more')
    await user.click(screen.getByRole('button', { name: 'Save the change' }))
    expect(await screen.findByText('Say why you are changing it.')).toBeTruthy()
    expect(api.editFeedback).not.toHaveBeenCalled()
  })

  it('saves the change with its reason, and says the earlier version is kept', async () => {
    api.editFeedback.mockResolvedValue(makeFeedback({ is_mine: true, version: 3 }))
    const user = await form(started, submitted)
    await user.type(screen.getByLabelText(/^Why are you changing it/), '  Reconsidered after the debrief ')
    await user.click(screen.getByRole('button', { name: 'Save the change' }))
    await waitFor(() => expect(api.editFeedback).toHaveBeenCalledWith('int-1', expect.objectContaining({ overall_rating: 4 }), 'Reconsidered after the debrief'))
    expect(await screen.findByText('Feedback updated. The earlier version is kept.')).toBeTruthy()
  })
})

describe('FeedbackSummary', () => {
  const mineSubmitted = makeFeedback({ id: 'fb-me', is_mine: true, interviewer: rec, private_notes: 'only mine', version: 2 })
  const others = makeFeedback({ id: 'fb-hr', interviewer: hr, overall_rating: 2, concerns: 'Wants to discuss scaling' })

  it('lists each submitted feedback with its ratings in words and its written parts', () => {
    renderAs(<FeedbackSummary overview={overview([others])} scale={scale} />)
    const item = screen.getByText('hr@example.com').closest('li') as HTMLElement
    expect(within(item).getByText('Submitted')).toBeTruthy()
    expect(within(item).getByText('2 · Below expectations')).toBeTruthy()
    expect(within(item).getByText('not rated')).toBeTruthy()
    expect(within(item).getByText('Wants to discuss scaling')).toBeTruthy()
    expect(within(item).getByText('Areas for further discussion')).toBeTruthy()
  })

  it('shows your private notes labelled as yours, and never anyone else’s', () => {
    renderAs(<FeedbackSummary overview={overview([mineSubmitted, others])} scale={scale} />)
    expect(screen.getByText('Your private notes: only you can see these')).toBeTruthy()
    expect(screen.getByText('only mine')).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
  })

  it('says how many have submitted and who is still to do so, with no average or ranking', () => {
    renderAs(<FeedbackSummary overview={overview([others], { pending_interviewers: [rec] })} scale={scale} />)
    expect(screen.getByText(/1 of 2 interviewers has submitted feedback/)).toBeTruthy()
    expect(screen.getByText('Still to submit: recruiter@example.com')).toBeTruthy()
    expect(screen.queryByText(/average|mean|rank|top|best/i)).toBeNull()
  })

  it('tells a recruiter they only see their own', () => {
    renderAs(<FeedbackSummary overview={overview([], { can_view_all: false, submitted_count: 1, pending_interviewers: [rec] })} scale={scale} />)
    expect(screen.getByText(/You can read your own feedback/)).toBeTruthy()
    expect(screen.getByText('You have not written any feedback yet.')).toBeTruthy()
  })

  it('has an empty state for HR', () => {
    renderAs(<FeedbackSummary overview={overview([])} scale={scale} />)
    expect(screen.getByText('No feedback has been submitted yet.')).toBeTruthy()
  })

  it('marks a draft as private to its author', () => {
    renderAs(<FeedbackSummary overview={overview([makeFeedback({ is_mine: true, status: 'draft', interviewer: rec })])} scale={scale} />)
    expect(screen.getByText('Draft (only you can see it)')).toBeTruthy()
  })

  it('says when written feedback was removed but keeps the ratings', () => {
    renderAs(<FeedbackSummary overview={overview([makeFeedback({ scrubbed: true, overall_feedback: null, strengths: null })])} scale={scale} />)
    expect(screen.getByText('The written feedback was removed. Only the ratings are kept.')).toBeTruthy()
    expect(screen.getAllByText('4 · Above expectations').length).toBeGreaterThan(0)
  })

  it('loads earlier versions on request, with the reason and no private notes', async () => {
    api.revisions.mockResolvedValue([{ version: 1, snapshot: { overall_rating: 3, overall_feedback: 'First view' }, edit_reason: 'Reconsidered', edited_by: rec, created_at: '2026-11-21T08:00:00Z' }])
    renderAs(<FeedbackSummary overview={overview([mineSubmitted])} scale={scale} />)
    expect(api.revisions).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show earlier versions' }))
    expect(await screen.findByText(/Version 1 \(replaced/)).toBeTruthy()
    expect(screen.getByText('Reason for the change: Reconsidered')).toBeTruthy()
    expect(screen.getByText(/First view/)).toBeTruthy()
    expect(api.revisions).toHaveBeenCalledWith('int-1', 'fb-me', expect.anything())
  })

  it('offers no history for feedback that was never edited', () => {
    renderAs(<FeedbackSummary overview={overview([makeFeedback({ version: 1 })])} scale={scale} />)
    expect(screen.queryByRole('button', { name: /earlier versions/ })).toBeNull()
  })
})

describe('InterviewerManager', () => {
  const two = makeInterview({
    interviewers: [{ ...rec, feedback_status: 'submitted' }, { ...hr, feedback_status: 'none' }],
  })
  const changed = vi.fn()
  beforeEach(() => {
    changed.mockReset()
    api.interviewers.mockResolvedValue([rec, hr, { id: 'u-3', email: 'third@example.com', role: 'recruiter' }])
  })

  it('shows each interviewer with their role and feedback status', () => {
    renderAs(<InterviewerManager interview={two} canManage={false} onChanged={changed} />)
    expect(screen.getByText('Recruiter · Feedback submitted')).toBeTruthy()
    expect(screen.getByText('HR Manager · No feedback yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByText('Add an interviewer')).toBeNull()
    expect(api.interviewers).not.toHaveBeenCalled()
  })

  it('offers only people who are not already on it, and adds one', async () => {
    api.addInterviewer.mockResolvedValue(makeInterview())
    renderAs(<InterviewerManager interview={two} canManage onChanged={changed} />)
    const select = (await screen.findByLabelText('Add an interviewer')) as HTMLSelectElement
    await waitFor(() => expect(within(select).queryByText('third@example.com')).toBeTruthy())
    expect(within(select).queryByText('recruiter@example.com')).toBeNull()
    const user = userEvent.setup()
    await user.selectOptions(select, 'u-3')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(api.addInterviewer).toHaveBeenCalledWith('int-1', 'u-3'))
    await waitFor(() => expect(changed).toHaveBeenCalled())
  })

  it('shows a clash from the server', async () => {
    api.addInterviewer.mockRejectedValue(new ApiError('Scheduling conflict: third@example.com is already booked.', 409))
    renderAs(<InterviewerManager interview={two} canManage onChanged={changed} />)
    const user = userEvent.setup()
    await waitFor(() => expect(api.interviewers).toHaveBeenCalled())
    const select = (await screen.findByLabelText('Add an interviewer')) as HTMLSelectElement
    await waitFor(() => expect(within(select).queryByText('third@example.com')).toBeTruthy())
    await user.selectOptions(select, 'u-3')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Scheduling conflict')
    expect(changed).not.toHaveBeenCalled()
  })

  it('removes one, but never offers to remove the last', async () => {
    api.removeInterviewer.mockResolvedValue(makeInterview())
    const { unmount } = renderAs(<InterviewerManager interview={two} canManage onChanged={changed} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove hr@example.com' }))
    await waitFor(() => expect(api.removeInterviewer).toHaveBeenCalledWith('int-1', 'u-hr'))
    unmount()
    renderAs(<InterviewerManager interview={makeInterview()} canManage onChanged={changed} />)
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it('the Add button stays off until someone is chosen', async () => {
    renderAs(<InterviewerManager interview={two} canManage onChanged={changed} />)
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
