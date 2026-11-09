// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeJob } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { JobStatus } from '../../../types/job'
import { JobStatusActions } from './JobStatusActions'

const changeStatus = vi.fn()
vi.mock('../../../api/jobs', () => ({ jobsApi: { changeStatus: (...a: unknown[]) => changeStatus(...a) } }))

beforeEach(() => {
  changeStatus.mockReset()
})

function setup(status: JobStatus) {
  const job = makeJob({ id: 'job-9', title: 'Platform Engineer', status })
  const onChanged = vi.fn()
  renderAs(<JobStatusActions job={job} onChanged={onChanged} />)
  return { job, onChanged, user: userEvent.setup() }
}

const buttons = () => screen.getAllByRole('button').map((b) => b.textContent)

describe('which buttons are shown', () => {
  it.each([
    ['draft', ['Publish job', 'Close job']],
    ['open', ['Put on hold', 'Close job']],
    ['on_hold', ['Reopen job', 'Close job']],
    ['closed', ['Reopen job']],
  ] as const)('%s jobs offer %j', (status, expected) => {
    setup(status)
    expect(buttons()).toEqual(expected)
  })
})

describe('changing status', () => {
  it('publishes a draft, announces it and reports the updated job', async () => {
    const updated = makeJob({ id: 'job-9', status: 'open' })
    changeStatus.mockResolvedValue(updated)
    const { user, onChanged } = setup('draft')
    await user.click(screen.getByRole('button', { name: 'Publish job' }))
    expect(changeStatus).toHaveBeenCalledWith('job-9', 'open')
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated))
    expect(await screen.findByText('Job published.')).toBeTruthy()
  })

  it('puts an open job on hold without asking for confirmation', async () => {
    changeStatus.mockResolvedValue(makeJob({ status: 'on_hold' }))
    const { user } = setup('open')
    await user.click(screen.getByRole('button', { name: 'Put on hold' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(changeStatus).toHaveBeenCalledWith('job-9', 'on_hold')
  })

  it('reopens a closed job', async () => {
    changeStatus.mockResolvedValue(makeJob({ status: 'open' }))
    const { user } = setup('closed')
    await user.click(screen.getByRole('button', { name: 'Reopen job' }))
    expect(changeStatus).toHaveBeenCalledWith('job-9', 'open')
    expect(await screen.findByText('Job reopened.')).toBeTruthy()
  })

  it('shows the server message and reports nothing when the change is refused', async () => {
    changeStatus.mockImplementation(async () => {
      throw new ApiError('Add a description before opening this job', 422)
    })
    const { user, onChanged } = setup('draft')
    await user.click(screen.getByRole('button', { name: 'Publish job' }))
    expect(await screen.findByText('Add a description before opening this job')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('disables the other buttons while a change is in flight', async () => {
    let finish!: (job: ReturnType<typeof makeJob>) => void
    changeStatus.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { user } = setup('draft')
    await user.click(screen.getByRole('button', { name: 'Publish job' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close job' }) as HTMLButtonElement).disabled).toBe(true))
    finish(makeJob({ status: 'open' }))
  })
})

describe('closing needs confirmation', () => {
  it('asks first, naming the job, and does nothing until confirmed', async () => {
    const { user } = setup('open')
    await user.click(screen.getByRole('button', { name: 'Close job' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Close this job?')).toBeTruthy()
    expect(within(dialog).getByText('Platform Engineer')).toBeTruthy()
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('closes the job after confirming', async () => {
    const updated = makeJob({ id: 'job-9', status: 'closed' })
    changeStatus.mockResolvedValue(updated)
    const { user, onChanged } = setup('open')
    await user.click(screen.getByRole('button', { name: 'Close job' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close job' }))
    expect(changeStatus).toHaveBeenCalledWith('job-9', 'closed')
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated))
    expect(await screen.findByText('Job closed.')).toBeTruthy()
  })

  it('"Keep it" cancels without calling the API', async () => {
    const { user, onChanged } = setup('open')
    await user.click(screen.getByRole('button', { name: 'Close job' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }))
    expect(changeStatus).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('also asks before closing a draft', async () => {
    const { user } = setup('draft')
    await user.click(screen.getByRole('button', { name: 'Close job' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(changeStatus).not.toHaveBeenCalled()
  })
})
