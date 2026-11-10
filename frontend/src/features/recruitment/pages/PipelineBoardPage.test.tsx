// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import {
  makeApplication,
  makeApplicationItem,
  makeBoard,
  makeJob,
  makeJobList,
  makeStaff,
} from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { renderAs } from '../../../test/render'
import { PipelineBoardPage } from './PipelineBoardPage'

const board = vi.fn()
const recruiters = vi.fn()
const jobsList = vi.fn()
const changeStage = vi.fn()
const reopen = vi.fn()
vi.mock('../../../api/applications', () => ({
  applicationsApi: {
    board: (...a: unknown[]) => board(...a),
    recruiters: (...a: unknown[]) => recruiters(...a),
    changeStage: (...a: unknown[]) => changeStage(...a),
    reopen: (...a: unknown[]) => reopen(...a),
  },
}))
vi.mock('../../../api/jobs', () => ({ jobsApi: { list: (...a: unknown[]) => jobsList(...a) } }))

const named = (id: string, first: string, last: string, over = {}) =>
  makeApplicationItem({ id, candidate: { id: `c-${id}`, first_name: first, last_name: last, email: `${first.toLowerCase()}@example.com`, current_title: null }, ...over })

const items = [
  named('a1', 'Sana', 'Iqbal'),
  named('a2', 'Bilal', 'Ahmed', { stage: 'interview', allowed_stages: ['shortlisted', 'offer', 'rejected', 'withdrawn'], assigned_recruiter: makeStaff({ email: 'rana@example.com' }) }),
  named('a3', 'Omar', 'Farooq', { stage: 'rejected', allowed_stages: [], can_reopen: true }),
  named('a4', 'Hina', 'Shah', { stage: 'hired', allowed_stages: [], can_reopen: false }),
]

beforeEach(() => {
  for (const m of [board, recruiters, jobsList, changeStage, reopen]) m.mockReset()
  board.mockResolvedValue(makeBoard(items))
  recruiters.mockResolvedValue([])
  jobsList.mockResolvedValue(makeJobList([makeJob()]))
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const render = (url = '/recruitment/pipeline') =>
  renderAs(
    <>
      <PipelineBoardPage />
      <LocationProbe />
    </>,
    { path: '/recruitment/pipeline', url, role: 'hr_manager' },
  )
const column = (name: string) => screen.getByRole('region', { name: `${name} column` })

describe('the board', () => {
  it('shows a loading state, then one column per pipeline stage with its count', async () => {
    render()
    expect(screen.getByText('Loading the pipeline…')).toBeTruthy()
    await screen.findByRole('region', { name: 'Applied column' })
    for (const [stage, count] of [['Applied', 1], ['Screening', 0], ['Shortlisted', 0], ['Interview', 1], ['Offer', 0], ['Hired', 1]] as const) {
      expect(within(column(stage)).getByLabelText(`${count} application${count === 1 ? '' : 's'}`)).toBeTruthy()
    }
  })

  it('puts each application in its own stage with candidate, job and recruiter', async () => {
    render()
    const interview = await screen.findByRole('region', { name: 'Interview column' })
    expect(within(interview).getByRole('link', { name: 'Bilal Ahmed' }).getAttribute('href')).toBe('/recruitment/applications/a2')
    expect(within(interview).getByText('bilal@example.com')).toBeTruthy()
    expect(within(interview).getByText('Senior Backend Engineer')).toBeTruthy()
    expect(within(interview).getByText('rana')).toBeTruthy()
    expect(within(column('Applied')).queryByText('Bilal Ahmed')).toBeNull()
    expect(within(column('Applied')).getByText(/Unassigned/)).toBeTruthy()
  })

  it('marks empty columns clearly', async () => {
    render()
    await screen.findByRole('region', { name: 'Screening column' })
    expect(within(column('Screening')).getByText('No applications')).toBeTruthy()
  })

  it('shows all eight stages as columns, marking progress, success and ended stages differently', async () => {
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const names = [...document.querySelectorAll('section[aria-label$=" column"] h2')].map((h) => h.textContent)
    expect(names).toHaveLength(8)
    expect(within(column('Applied')).getByText('In progress')).toBeTruthy()
    expect(within(column('Hired')).getByText('Successful')).toBeTruthy()
    expect(within(column('Rejected')).getByText('Ended')).toBeTruthy()
    expect(within(column('Withdrawn')).getByText('Ended')).toBeTruthy()
    expect(within(column('Rejected')).getByText('Omar Farooq')).toBeTruthy()
  })

  it('says when a column holds more than it shows', async () => {
    const b = makeBoard(items, 1)
    b.columns.applied = { total: 7, items: [items[0]], page: 1, page_size: 1, has_more: true }
    board.mockResolvedValue(b)
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(within(column('Applied')).getByText(/Showing 1 of 7/)).toBeTruthy()
  })

  it('stacks columns on small screens and scrolls sideways on larger ones', async () => {
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const row = column('Applied').parentElement!
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('md:flex-row')
    expect(row.className).toContain('md:overflow-x-auto')
  })
})

describe('moving applications (the server decides what is offered)', () => {
  it('offers Move only where the server allowed a move, and Reopen only where it allowed that', async () => {
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(screen.getByRole('button', { name: 'Move Sana Iqbal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move Bilal Ahmed' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Move Omar Farooq' })).toBeNull() // rejected: no moves
    expect(screen.getByRole('button', { name: 'Reopen Omar Farooq' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Hina Shah/ })).toBeNull() // hired: final
  })

  it('moves an application and refreshes the board', async () => {
    changeStage.mockResolvedValue(makeApplication({ stage: 'screening' }))
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const calls = board.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Move Sana Iqbal' }))
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Move to Screening' }))
    await waitFor(() => expect(changeStage).toHaveBeenCalledWith('a1', 'screening', undefined))
    await waitFor(() => expect(board.mock.calls.length).toBeGreaterThan(calls))
  })

  it('refreshes the board when the server says the application changed meanwhile', async () => {
    changeStage.mockRejectedValue(new ApiError('This application was just changed by someone else. Refresh and retry.', 409))
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const calls = board.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Move Sana Iqbal' }))
    await user.click(screen.getByRole('button', { name: 'Move to Screening' }))
    expect((await screen.findByRole('alert')).textContent).toContain('changed by someone else')
    await waitFor(() => expect(board.mock.calls.length).toBeGreaterThan(calls))
  })

  it('reopens a rejected application', async () => {
    reopen.mockResolvedValue(makeApplication({ stage: 'interview' }))
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await user.click(screen.getByRole('button', { name: 'Reopen Omar Farooq' }))
    await user.click(screen.getByRole('button', { name: 'Reopen application' }))
    await waitFor(() => expect(reopen).toHaveBeenCalledWith('a3', undefined))
  })
})

describe('filters', () => {
  it('filters by job and recruiter through the server, and keeps the search text out of the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await waitFor(() => expect(within(screen.getByLabelText('Filter by job')).getAllByRole('option').length).toBe(2))
    await user.selectOptions(screen.getByLabelText('Filter by job'), 'job-1')
    await waitFor(() => expect(board.mock.calls.at(-1)![0]).toMatchObject({ job_id: 'job-1' }))
    await user.type(screen.getByLabelText('Search applications'), 'sana')
    await waitFor(() => expect(board.mock.calls.at(-1)![0]).toMatchObject({ q: 'sana' }), { timeout: 2000 })
    const url = screen.getByTestId('location').textContent!
    expect(url).toContain('job=job-1')
    expect(url).not.toMatch(/sana|q=/)
  })

  it('filters by date through the server and keeps the dates in the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await user.type(screen.getByLabelText('Applied from'), '2026-11-01')
    await waitFor(() => expect(board.mock.calls.at(-1)![0]).toMatchObject({ applied_from: '2026-11-01' }))
    expect(screen.getByTestId('location').textContent).toContain('from=2026-11-01')
  })
})

describe('empty and error states', () => {
  it('explains an empty pipeline', async () => {
    board.mockResolvedValue(makeBoard([]))
    render()
    expect(await screen.findByText('No applications yet')).toBeTruthy()
  })

  it('explains an empty filtered pipeline', async () => {
    board.mockResolvedValue(makeBoard([]))
    render('/recruitment/pipeline?job=job-9')
    expect(await screen.findByText('No applications match your filters')).toBeTruthy()
  })

  it('shows an error with retry', async () => {
    board.mockRejectedValueOnce(new ApiError('Cannot reach the server', 0))
    const user = userEvent.setup()
    render()
    expect(await screen.findByText('Cannot reach the server')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Applied column' })).toBeTruthy()
  })

  it('keeps the old board and offers a retry when a refresh fails', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    board.mockRejectedValueOnce(new ApiError('Lost connection', 0))
    await user.selectOptions(screen.getByLabelText('Filter by recruiter'), '')
    await user.type(screen.getByLabelText('Search applications'), 'x')
    expect(await screen.findByText('Lost connection', undefined, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Applied column' })).toBeTruthy()
  })
})
