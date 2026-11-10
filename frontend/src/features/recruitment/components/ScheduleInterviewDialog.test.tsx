// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { hr, makeInterview, rec } from '../../../test/interviewFixtures'
import { renderAs } from '../../../test/render'
import { ScheduleInterviewDialog } from './ScheduleInterviewDialog'

const api = { interviewers: vi.fn(), create: vi.fn() }
const appList = vi.fn()
vi.mock('../../../api/interviews', () => ({
  interviewsApi: { interviewers: (...a: unknown[]) => api.interviewers(...a), create: (...a: unknown[]) => api.create(...a) },
}))
vi.mock('../../../api/applications', () => ({ applicationsApi: { list: (...a: unknown[]) => appList(...a) } }))

const onClose = vi.fn()
const onCreated = vi.fn()
beforeEach(() => {
  for (const m of [api.interviewers, api.create, appList, onClose, onCreated]) m.mockReset()
  api.interviewers.mockResolvedValue([rec, hr])
  appList.mockResolvedValue({
    items: [
      { id: 'app-9', candidate: { first_name: 'Bilal', last_name: 'Ahmed' }, job: { title: 'Data Engineer' } },
      { id: 'app-8', candidate: { first_name: 'Zara', last_name: 'Khan' }, job: { title: 'Designer' } },
    ],
    total: 2, page: 1, page_size: 8, stage_counts: {},
  })
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

function open(props: { applicationId?: string } = {}) {
  renderAs(
    <ScheduleInterviewDialog open onClose={onClose} onCreated={onCreated} applicationId={props.applicationId} applicationLabel="Sana Iqbal, Backend Engineer" />,
  )
  return userEvent.setup()
}
const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement
const submit = () => screen.getByRole('button', { name: 'Schedule interview' })
const fillBasics = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(field(/^Title/), 'Technical interview')
  fireEvent.change(field(/^Date/), { target: { value: '2035-11-20' } })
  await user.click(await screen.findByLabelText(rec.email))
}

describe('with a known application', () => {
  it('shows who it is for and does not show the picker', async () => {
    open({ applicationId: 'app-1' })
    expect(await screen.findByText('Sana Iqbal, Backend Engineer')).toBeTruthy()
    expect(screen.queryByLabelText('Search applications')).toBeNull()
    expect(appList).not.toHaveBeenCalled()
  })

  it('sends the local date, times and zone exactly as chosen', async () => {
    api.create.mockResolvedValue(makeInterview())
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    fireEvent.change(field(/^Starts/), { target: { value: '14:30' } })
    fireEvent.change(field(/^Ends/), { target: { value: '15:15' } })
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Europe/London')
    await user.type(screen.getByLabelText(/Meeting link/), 'https://meet.example.com/room/abc')
    await user.click(submit())
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    expect(api.create).toHaveBeenCalledWith({
      application_id: 'app-1', title: 'Technical interview', interview_type: 'technical', mode: 'online',
      starts_at: '2035-11-20T14:30', ends_at: '2035-11-20T15:15', timezone: 'Europe/London', location: null,
      meeting_url: 'https://meet.example.com/room/abc', interviewer_ids: [rec.id],
    })
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'int-1' })))
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText('Interview scheduled.')).toBeTruthy()
  })

  it('can pick several interviewers', async () => {
    api.create.mockResolvedValue(makeInterview())
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    await user.click(await screen.findByLabelText(hr.email))
    await user.click(submit())
    await waitFor(() => expect(api.create.mock.calls[0][0].interviewer_ids).toEqual([rec.id, hr.id]))
  })
})

describe('validation', () => {
  it('refuses an empty form, explains each problem and sends nothing', async () => {
    const user = open({ applicationId: 'app-1' })
    await screen.findByLabelText(rec.email)
    await user.click(submit())
    expect(await screen.findByText('Give the interview a title.')).toBeTruthy()
    expect(screen.getByText('Choose the date.')).toBeTruthy()
    expect(screen.getByText('Choose at least one interviewer.')).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('catches an end time that is not after the start', async () => {
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    fireEvent.change(field(/^Ends/), { target: { value: '09:00' } })
    await user.click(submit())
    expect(await screen.findByText('The end time must be after the start time.')).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('needs a location for an in-person interview and hides the meeting link', async () => {
    const user = open({ applicationId: 'app-1' })
    await user.selectOptions(screen.getByLabelText('Mode'), 'in_person')
    expect(screen.queryByLabelText(/Meeting link/)).toBeNull()
    await fillBasics(user)
    await user.click(submit())
    expect(await screen.findByText('Add the location for an in-person interview.')).toBeTruthy()
    await user.type(field(/^Location/), 'Head office, room 4')
    await user.click(submit())
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'in_person', location: 'Head office, room 4', meeting_url: null })))
  })

  it('refuses a meeting link that carries a password, before anything is sent', async () => {
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    await user.type(screen.getByLabelText(/Meeting link/), 'https://zoom.example.com/j/123?pwd=secret')
    await user.click(submit())
    expect(await screen.findByText(/contains a password or access token/)).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('clears a field error as soon as it is edited', async () => {
    const user = open({ applicationId: 'app-1' })
    await user.click(submit())
    expect(await screen.findByText('Give the interview a title.')).toBeTruthy()
    await user.type(field(/^Title/), 'x')
    expect(screen.queryByText('Give the interview a title.')).toBeNull()
  })
})

describe('when the server refuses', () => {
  it('shows a scheduling conflict clearly and keeps everything typed', async () => {
    api.create.mockRejectedValue(new ApiError('Scheduling conflict: recruiter@example.com is already booked for "Screening", 10:00-11:00 on 20 Nov 2035 (Asia/Karachi).', 409))
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Scheduling conflict: recruiter@example.com is already booked')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(field(/^Title/).value).toBe('Technical interview')
  })

  it('a time that does not exist on a clock-change day is shown as the server words it', async () => {
    api.create.mockRejectedValue(new ApiError('That local time does not exist in this time zone (clocks change that day).', 422))
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toMatch(/does not exist/)
  })

  it('editing a field clears the server message', async () => {
    api.create.mockRejectedValue(new ApiError('Scheduling conflict: x.', 409))
    const user = open({ applicationId: 'app-1' })
    await fillBasics(user)
    await user.click(submit())
    await screen.findByRole('alert')
    await user.type(field(/^Title/), '!')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('without a known application', () => {
  it('searches and picks one, and refuses to submit until one is chosen', async () => {
    api.create.mockResolvedValue(makeInterview())
    const user = open()
    await fillBasics(user)
    await user.click(submit())
    expect(await screen.findByText('Choose the application.')).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Search applications'), 'Bil')
    await waitFor(() => expect(appList).toHaveBeenCalledWith(expect.objectContaining({ q: 'Bil' }), expect.anything()))
    await user.click(await screen.findByLabelText(/Bilal Ahmed/))
    await user.click(submit())
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ application_id: 'app-9' })))
  })

  it('says so when nothing matches', async () => {
    appList.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 8, stage_counts: {} })
    open()
    expect(await screen.findByText('No matching applications.')).toBeTruthy()
  })

  it('shows an error with a retry when the application list cannot load', async () => {
    appList.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 8, stage_counts: {} })
    const user = open()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    await user.click(retry)
    expect(await screen.findByText('No matching applications.')).toBeTruthy()
  })
})

describe('the people list', () => {
  it('shows an error with a retry when it cannot load', async () => {
    api.interviewers.mockRejectedValueOnce(new ApiError('down', 500)).mockResolvedValueOnce([rec])
    const user = open({ applicationId: 'app-1' })
    const alert = await screen.findByText(/Couldn't load the people list/)
    await user.click(within(alert.closest('p') as HTMLElement).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText(rec.email)).toBeTruthy()
  })
})
