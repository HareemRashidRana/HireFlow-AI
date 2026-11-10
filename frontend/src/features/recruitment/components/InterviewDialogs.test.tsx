// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeInterview } from '../../../test/interviewFixtures'
import { renderAs } from '../../../test/render'
import { CancelInterviewDialog } from './CancelInterviewDialog'
import { RescheduleDialog } from './RescheduleDialog'

const api = { reschedule: vi.fn(), cancel: vi.fn() }
vi.mock('../../../api/interviews', () => ({
  interviewsApi: { reschedule: (...a: unknown[]) => api.reschedule(...a), cancel: (...a: unknown[]) => api.cancel(...a) },
}))

const onClose = vi.fn()
const done = vi.fn()
beforeEach(() => {
  for (const m of [api.reschedule, api.cancel, onClose, done]) m.mockReset()
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

describe('RescheduleDialog', () => {
  const open = () => {
    renderAs(<RescheduleDialog interview={makeInterview()} onClose={onClose} onRescheduled={done} />)
    return userEvent.setup()
  }
  const date = () => screen.getByLabelText(/^New date/) as HTMLInputElement

  it('starts from the current time and explains that the original is kept', () => {
    open()
    expect(date().value).toBe('2026-11-20')
    expect((screen.getByLabelText(/^Starts/) as HTMLInputElement).value).toBe('10:00')
    expect((screen.getByLabelText('Time zone') as HTMLSelectElement).value).toBe('Asia/Karachi')
    expect(screen.getByText(/The original stays on record, marked rescheduled/)).toBeTruthy()
    expect(screen.getByText(/Fri, 20 Nov 2026, 10:00-11:00 \(UTC\+05:00\)/)).toBeTruthy()
  })

  it('sends the new local time and zone and hands back the NEW interview', async () => {
    const next = makeInterview({ id: 'int-2', rescheduled_from_id: 'int-1' })
    api.reschedule.mockResolvedValue(next)
    const user = open()
    fireEvent.change(date(), { target: { value: '2026-11-25' } })
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '15:00' } })
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '16:00' } })
    await user.type(screen.getByLabelText('Reason (optional)'), '  Candidate asked  ')
    await user.click(screen.getByRole('button', { name: 'Reschedule' }))
    await waitFor(() => expect(api.reschedule).toHaveBeenCalledWith('int-1', {
      starts_at: '2026-11-25T15:00', ends_at: '2026-11-25T16:00', timezone: 'Asia/Karachi', reason: 'Candidate asked',
    }))
    await waitFor(() => expect(done).toHaveBeenCalledWith(next))
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText(/The original is kept in the history/)).toBeTruthy()
  })

  it('sends null when no reason is given', async () => {
    api.reschedule.mockResolvedValue(makeInterview({ id: 'int-2' }))
    const user = open()
    fireEvent.change(date(), { target: { value: '2026-11-25' } })
    await user.click(screen.getByRole('button', { name: 'Reschedule' }))
    await waitFor(() => expect(api.reschedule.mock.calls[0][1].reason).toBeNull())
  })

  it('refuses an end that is not after the start without calling the server', async () => {
    const user = open()
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '09:00' } })
    await user.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The end time must be after the start time.')
    expect(api.reschedule).not.toHaveBeenCalled()
  })

  it('shows a conflict from the server and stays open', async () => {
    api.reschedule.mockRejectedValue(new ApiError('Scheduling conflict: recruiter@example.com is already booked for "Busy", 14:00-15:00 on 25 Nov 2026 (Asia/Karachi).', 409))
    const user = open()
    fireEvent.change(date(), { target: { value: '2026-11-25' } })
    await user.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect((await screen.findByRole('alert')).textContent).toContain('already booked for "Busy"')
    expect(done).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('can be dismissed without changing anything', async () => {
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Keep the current time' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.reschedule).not.toHaveBeenCalled()
  })

  it('renders nothing when there is no interview', () => {
    renderAs(<RescheduleDialog interview={null} onClose={onClose} onRescheduled={done} />)
    expect(screen.queryByText('Reschedule interview')).toBeNull()
  })
})

describe('CancelInterviewDialog', () => {
  const open = () => {
    renderAs(<CancelInterviewDialog interview={makeInterview()} onClose={onClose} onCancelled={done} />)
    return userEvent.setup()
  }

  it('names the interview and says the application stage is not changed', () => {
    open()
    expect(screen.getByText(/Technical interview/)).toBeTruthy()
    expect(screen.getByText(/application's stage is not changed/)).toBeTruthy()
  })

  it('needs a reason and cancels nothing without one', async () => {
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Cancel interview' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Say why it is being cancelled.')
    expect(api.cancel).not.toHaveBeenCalled()
  })

  it('cancels with a trimmed reason and reports back', async () => {
    api.cancel.mockResolvedValue(makeInterview({ status: 'cancelled' }))
    const user = open()
    await user.type(screen.getByLabelText(/^Reason/), '  Panel unavailable  ')
    await user.click(screen.getByRole('button', { name: 'Cancel interview' }))
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('int-1', 'Panel unavailable'))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(await screen.findByText('Interview cancelled.')).toBeTruthy()
  })

  it('shows a server refusal and keeps the dialog open', async () => {
    api.cancel.mockRejectedValue(new ApiError('A completed interview cannot be cancelled.', 409))
    const user = open()
    await user.type(screen.getByLabelText(/^Reason/), 'x')
    await user.click(screen.getByRole('button', { name: 'Cancel interview' }))
    expect((await screen.findByRole('alert')).textContent).toContain('A completed interview cannot be cancelled.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Keep the interview" closes without cancelling', async () => {
    const user = open()
    await user.click(screen.getByRole('button', { name: 'Keep the interview' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.cancel).not.toHaveBeenCalled()
  })
})
