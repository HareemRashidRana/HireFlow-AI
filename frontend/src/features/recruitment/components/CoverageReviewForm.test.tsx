// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeAssessment } from '../../../test/screeningFixtures'
import { renderAs } from '../../../test/render'
import { CoverageReviewForm } from './CoverageReviewForm'

const review = vi.fn()
vi.mock('../../../api/screening', () => ({ screeningApi: { review: (...a: unknown[]) => review(...a) } }))

const onSaved = vi.fn()
beforeEach(() => {
  review.mockReset()
  onSaved.mockReset()
})

function render(assessment = makeAssessment()) {
  renderAs(<CoverageReviewForm assessment={assessment} onSaved={onSaved} />)
  return userEvent.setup()
}
const save = () => screen.getByRole('button', { name: 'Save my review' })

describe('the judgement', () => {
  it('offers exactly agree, disagree and unsure, none pre-selected', () => {
    render()
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.checked)).toEqual([false, false, false])
    expect(screen.getByLabelText('I agree with this comparison')).toBeTruthy()
    expect(screen.getByLabelText('I disagree with this comparison')).toBeTruthy()
    expect(screen.getByLabelText("I'm not sure")).toBeTruthy()
  })

  it('refuses to save without a choice and sends nothing', async () => {
    const user = render()
    await user.click(save())
    expect(await screen.findByText('Choose one of the options.')).toBeTruthy()
    expect(review).not.toHaveBeenCalled()
  })

  it('sends just the judgement when nothing else is filled in, then resets and refreshes', async () => {
    review.mockResolvedValue(makeAssessment())
    const user = render()
    await user.click(screen.getByLabelText('I agree with this comparison'))
    await user.click(save())
    await waitFor(() => expect(review).toHaveBeenCalledWith('asm-1', { judgement: 'agree', adjustments: [], adjustment_reason: null, note: null }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect((screen.getByLabelText('I agree with this comparison') as HTMLInputElement).checked).toBe(false)
    expect(await screen.findByText('Your review was saved.')).toBeTruthy()
  })
})

describe('adjustments', () => {
  it('lists only requirements that were not listed, and says the original never changes', () => {
    render()
    expect(screen.getByLabelText('Docker')).toBeTruthy()
    expect(screen.getByLabelText('Go')).toBeTruthy()
    expect(screen.queryByLabelText('JavaScript')).toBeNull() // already listed
    expect(screen.getByText(/The original result never changes/)).toBeTruthy()
  })

  it('has no adjustment section when there is nothing to adjust', () => {
    render(makeAssessment({ unlisted_requirements: [] }))
    expect(screen.queryByText(/requirements you can see are covered/)).toBeNull()
  })

  it('a chosen adjustment needs a reason before it can be saved', async () => {
    const user = render()
    await user.click(screen.getByLabelText('I disagree with this comparison'))
    await user.click(screen.getByLabelText('Docker'))
    await user.click(save())
    expect(await screen.findByText('Choose a reason for the adjustment.')).toBeTruthy()
    expect(review).not.toHaveBeenCalled()
  })

  it('sends adjustments with their reason', async () => {
    review.mockResolvedValue(makeAssessment())
    const user = render()
    await user.click(screen.getByLabelText('I disagree with this comparison'))
    await user.click(screen.getByLabelText('Docker'))
    await user.selectOptions(screen.getByLabelText('Reason'), 'evidenced_elsewhere')
    await user.click(save())
    await waitFor(() => expect(review).toHaveBeenCalledWith('asm-1', { judgement: 'disagree', adjustments: ['Docker'], adjustment_reason: 'evidenced_elsewhere', note: null }))
  })

  it('un-ticking the last adjustment removes the reason requirement', async () => {
    review.mockResolvedValue(makeAssessment())
    const user = render()
    await user.click(screen.getByLabelText('I agree with this comparison'))
    await user.click(screen.getByLabelText('Docker'))
    await user.click(screen.getByLabelText('Docker'))
    expect(screen.queryByLabelText('Reason')).toBeNull()
    await user.click(save())
    await waitFor(() => expect(review).toHaveBeenCalledTimes(1))
  })
})

describe('the note', () => {
  it('counts characters and warns about sensitive details and anonymization', async () => {
    const user = render()
    await user.type(screen.getByLabelText('Note (optional)'), 'abc')
    expect(screen.getByText(/3\/1000/)).toBeTruthy()
    expect(screen.getByText(/removed if the candidate is anonymized/)).toBeTruthy()
    expect(screen.getByText(/Do not add sensitive personal details/)).toBeTruthy()
  })

  it('refuses a note over 1000 characters', async () => {
    const user = render()
    await user.click(screen.getByLabelText('I agree with this comparison'))
    const box = screen.getByLabelText('Note (optional)')
    await user.click(box)
    await user.paste('x'.repeat(1001))
    await user.click(save())
    expect(await screen.findByText('Keep the note under 1000 characters.')).toBeTruthy()
    expect(review).not.toHaveBeenCalled()
  })

  it('sends a trimmed note', async () => {
    review.mockResolvedValue(makeAssessment())
    const user = render()
    await user.click(screen.getByLabelText("I'm not sure"))
    await user.type(screen.getByLabelText('Note (optional)'), '  needs a second look  ')
    await user.click(save())
    await waitFor(() => expect(review).toHaveBeenCalledWith('asm-1', expect.objectContaining({ judgement: 'unsure', note: 'needs a second look' })))
  })
})

describe('failures', () => {
  it('shows the server message, keeps what was typed, and does not refresh', async () => {
    review.mockRejectedValue(new ApiError('This assessment\'s resume details were removed, so it cannot be reviewed', 409))
    const user = render()
    await user.click(screen.getByLabelText('I agree with this comparison'))
    await user.type(screen.getByLabelText('Note (optional)'), 'keep me')
    await user.click(save())
    expect(await screen.findByText(/cannot be reviewed/)).toBeTruthy()
    expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).value).toBe('keep me')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
