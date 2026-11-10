// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeApplication, makeApplicationItem } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { ApplicationListItem } from '../../../types/application'
import { StageChangeDialog } from './StageChangeDialog'

const changeStage = vi.fn()
vi.mock('../../../api/applications', () => ({
  applicationsApi: { changeStage: (...a: unknown[]) => changeStage(...a) },
}))

// jsdom has no <dialog> behaviour: give it the two methods the Modal uses.
beforeEach(() => {
  changeStage.mockReset()
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function open(application: Partial<ApplicationListItem> = {}) {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  const onStale = vi.fn()
  const item = makeApplicationItem({
    stage: 'screening',
    allowed_stages: ['applied', 'shortlisted', 'rejected', 'withdrawn'],
    ...application,
  })
  renderAs(<StageChangeDialog application={item} onClose={onClose} onChanged={onChanged} onStale={onStale} />)
  return { onClose, onChanged, onStale, user: userEvent.setup() }
}

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement
const submit = (name: string | RegExp) => screen.getByRole('button', { name })

describe('choices', () => {
  it('offers exactly the stages the server allowed, nothing else', () => {
    open()
    const labels = screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent)
    expect(labels).toHaveLength(4)
    expect(labels.join('|')).toMatch(/Applied.*Shortlisted.*Rejected.*Withdrawn/)
    expect(screen.queryByRole('radio', { name: /Interview/ })).toBeNull() // skipping ahead is not offered
    expect(screen.queryByRole('radio', { name: /Hired/ })).toBeNull()
  })

  it('pre-selects the next stage forward, not a step back', () => {
    open()
    expect(radio('Shortlisted').checked).toBe(true)
    expect(submit('Move to Shortlisted')).toBeTruthy()
  })

  it('says so when no move is available', () => {
    open({ allowed_stages: [] })
    expect(screen.getByText('No further moves are available for this application.')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('shows a hiring warning only when hiring is chosen', async () => {
    const { user } = open({ stage: 'offer', allowed_stages: ['interview', 'hired', 'rejected', 'withdrawn'] })
    expect(radio('Hired').checked).toBe(true)
    expect(screen.getByText(/records a hiring decision made by you/)).toBeTruthy()
    await user.click(radio('Interview'))
    expect(screen.queryByText(/records a hiring decision/)).toBeNull()
  })
})

describe('submitting', () => {
  it('moves the application, then reports and closes', async () => {
    const updated = makeApplication({ stage: 'shortlisted' })
    changeStage.mockResolvedValue(updated)
    const { user, onChanged, onClose } = open()
    await user.click(submit('Move to Shortlisted'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated))
    expect(changeStage).toHaveBeenCalledWith('app-1', 'shortlisted', undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('sends the note when one is written (trimmed)', async () => {
    changeStage.mockResolvedValue(makeApplication())
    const { user } = open()
    await user.type(screen.getByLabelText(/Note/), '  Strong on SQL  ')
    await user.click(submit('Move to Shortlisted'))
    await waitFor(() => expect(changeStage).toHaveBeenCalledWith('app-1', 'shortlisted', 'Strong on SQL'))
  })

  it('will not reject without a reason, and does not even call the server', async () => {
    const { user } = open()
    await user.click(radio('Rejected'))
    await user.click(submit('Reject application'))
    expect(screen.getByText('Give a reason for rejecting this application.')).toBeTruthy()
    expect(changeStage).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only reason as no reason', async () => {
    const { user } = open()
    await user.click(radio('Rejected'))
    await user.type(screen.getByLabelText(/Reason for rejecting/), '    ')
    await user.click(submit('Reject application'))
    expect(changeStage).not.toHaveBeenCalled()
  })

  it('rejects with the reason', async () => {
    changeStage.mockResolvedValue(makeApplication({ stage: 'rejected' }))
    const { user, onChanged } = open()
    await user.click(radio('Rejected'))
    await user.type(screen.getByLabelText(/Reason for rejecting/), 'Missing required skills')
    await user.click(submit('Reject application'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(changeStage).toHaveBeenCalledWith('app-1', 'rejected', 'Missing required skills')
  })

  it('withdrawing needs no reason', async () => {
    changeStage.mockResolvedValue(makeApplication({ stage: 'withdrawn' }))
    const { user } = open()
    await user.click(radio('Withdrawn'))
    await user.click(submit('Withdraw application'))
    await waitFor(() => expect(changeStage).toHaveBeenCalledWith('app-1', 'withdrawn', undefined))
  })
})

describe('server refusals', () => {
  it('shows the server message, stays open, and does not report success', async () => {
    changeStage.mockRejectedValue(new ApiError('Only HR managers and admins can mark an application as hired.', 403))
    const { user, onChanged, onClose } = open({ stage: 'offer', allowed_stages: ['interview', 'hired', 'rejected'] })
    await user.click(submit('Mark as hired'))
    expect((await screen.findByRole('alert')).textContent).toContain('Only HR managers and admins')
    expect(onChanged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks the page to refresh when the server says the data was stale (409)', async () => {
    changeStage.mockRejectedValue(new ApiError('This application was just changed by someone else. Refresh and retry.', 409))
    const { user, onStale } = open()
    await user.click(submit('Move to Shortlisted'))
    await screen.findByRole('alert')
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it('does not ask for a refresh on other errors', async () => {
    changeStage.mockRejectedValue(new ApiError('Server exploded', 500))
    const { user, onStale } = open()
    await user.click(submit('Move to Shortlisted'))
    await screen.findByRole('alert')
    expect(onStale).not.toHaveBeenCalled()
  })

  it('lets the user try again after an error', async () => {
    changeStage.mockRejectedValueOnce(new ApiError('Temporary problem', 500)).mockResolvedValueOnce(makeApplication())
    const { user, onChanged } = open()
    await user.click(submit('Move to Shortlisted'))
    await screen.findByRole('alert')
    await user.click(submit('Move to Shortlisted'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(changeStage).toHaveBeenCalledTimes(2)
  })
})
