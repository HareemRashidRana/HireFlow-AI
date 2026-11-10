// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeApplicationItem, makeBoard, makeJob, makeJobList } from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { renderAs } from '../../../test/render'
import type { ApplicationListItem, Board } from '../../../types/application'
import { PipelineBoardPage } from './PipelineBoardPage'

const board = vi.fn()
const boardColumn = vi.fn()
const recruiters = vi.fn()
const jobsList = vi.fn()
vi.mock('../../../api/applications', () => ({
  applicationsApi: {
    board: (...a: unknown[]) => board(...a),
    boardColumn: (...a: unknown[]) => boardColumn(...a),
    recruiters: (...a: unknown[]) => recruiters(...a),
    changeStage: vi.fn(),
    reopen: vi.fn(),
  },
}))
vi.mock('../../../api/jobs', () => ({ jobsApi: { list: (...a: unknown[]) => jobsList(...a) } }))

const card = (n: number): ApplicationListItem =>
  makeApplicationItem({
    id: `a${n}`,
    candidate: { id: `c${n}`, first_name: 'Person', last_name: `N${n}`, email: `p${n}@example.com`, current_title: `Title ${n}` },
  })

/** A board whose "Applied" column holds 7 applications of which 3 are loaded. */
function crowdedBoard(): Board {
  const b = makeBoard([], 3)
  b.columns.applied = { total: 7, items: [card(1), card(2), card(3)], page: 1, page_size: 3, has_more: true }
  return b
}

beforeEach(() => {
  for (const m of [board, boardColumn, recruiters, jobsList]) m.mockReset()
  board.mockImplementation(async () => crowdedBoard()) // a fresh object per request, like a real fetch
  recruiters.mockResolvedValue([])
  jobsList.mockResolvedValue(makeJobList([makeJob()]))
})

const render = (url = '/recruitment/pipeline') =>
  renderAs(
    <>
      <PipelineBoardPage />
      <LocationProbe />
    </>,
    { path: '/recruitment/pipeline', url, role: 'hr_manager' },
  )
const applied = () => screen.getByRole('region', { name: 'Applied column' })
const names = () => within(applied()).queryAllByRole('link', { name: /^Person N\d+$/ }).map((l) => l.textContent)

describe('never silently hiding applications', () => {
  it('shows the true total and how many cards are loaded', async () => {
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(within(applied()).getByLabelText('7 applications')).toBeTruthy()
    expect(within(applied()).getByText('Showing 3 of 7')).toBeTruthy()
    expect(names()).toEqual(['Person N1', 'Person N2', 'Person N3'])
  })

  it('offers to load the rest, saying how many', async () => {
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(within(applied()).getByRole('button', { name: 'Load more Applied applications' }).textContent).toBe('Load 3 more')
  })

  it('does not offer it when every card is already shown', async () => {
    board.mockResolvedValue(makeBoard([card(1), card(2)]))
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
    expect(within(applied()).getByText('Showing 2 of 2')).toBeTruthy()
  })
})

describe('loading more', () => {
  it('appends the next page, asks for page 2 with the same filters, and updates the count', async () => {
    boardColumn.mockResolvedValue({ total: 7, items: [card(4), card(5), card(6)], page: 2, page_size: 3, has_more: true })
    const user = userEvent.setup()
    render('/recruitment/pipeline?job=job-1')
    await screen.findByRole('region', { name: 'Applied column' })
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(names()).toHaveLength(6))
    expect(names()).toEqual(['Person N1', 'Person N2', 'Person N3', 'Person N4', 'Person N5', 'Person N6'])
    expect(boardColumn).toHaveBeenCalledWith('applied', expect.objectContaining({ page: 2, page_size: 3, job_id: 'job-1' }))
    expect(within(applied()).getByText('Showing 6 of 7')).toBeTruthy()
  })

  it('keeps going page by page until the end, then stops offering more', async () => {
    boardColumn
      .mockResolvedValueOnce({ total: 7, items: [card(4), card(5), card(6)], page: 2, page_size: 3, has_more: true })
      .mockResolvedValueOnce({ total: 7, items: [card(7)], page: 3, page_size: 3, has_more: false })
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(names()).toHaveLength(6))
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(names()).toHaveLength(7))
    expect(boardColumn.mock.calls.map((c) => c[1].page)).toEqual([2, 3])
    expect(within(applied()).queryByRole('button', { name: /Load more/ })).toBeNull()
    expect(within(applied()).getByText('Showing 7 of 7')).toBeTruthy()
  })

  it('never shows the same application twice, even if the server repeats one', async () => {
    boardColumn.mockResolvedValue({ total: 7, items: [card(3), card(4)], page: 2, page_size: 3, has_more: false })
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(names()).toHaveLength(4))
    expect(new Set(names()).size).toBe(4)
  })

  it('shows a spinner-disabled button while loading, so it cannot be double-clicked', async () => {
    let finish: (v: unknown) => void = () => {}
    boardColumn.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const button = within(applied()).getByRole('button', { name: /Load more/ }) as HTMLButtonElement
    await user.click(button)
    await waitFor(() => expect(button.disabled).toBe(true))
    await user.click(button)
    expect(boardColumn).toHaveBeenCalledTimes(1)
    finish({ total: 7, items: [card(4)], page: 2, page_size: 3, has_more: true })
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it('reports a failure in that column, keeps the cards, and lets the user try again', async () => {
    boardColumn
      .mockRejectedValueOnce(new ApiError('Lost connection', 0))
      .mockResolvedValueOnce({ total: 7, items: [card(4), card(5), card(6)], page: 2, page_size: 3, has_more: true })
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    expect((await within(applied()).findByRole('alert')).textContent).toBe('Lost connection')
    expect(names()).toHaveLength(3)
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(names()).toHaveLength(6))
    expect(within(applied()).queryByRole('alert')).toBeNull()
  })

  it('drops the extra pages when the board reloads, so nothing is stale or doubled', async () => {
    boardColumn.mockResolvedValue({ total: 7, items: [card(4), card(5), card(6)], page: 2, page_size: 3, has_more: true })
    const user = userEvent.setup()
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    await user.click(within(applied()).getByRole('button', { name: /Load more/ }))
    await waitFor(() => expect(names()).toHaveLength(6))
    await user.selectOptions(screen.getByLabelText('Filter by source'), 'referral')
    await waitFor(() => expect(names()).toHaveLength(3))
    expect(within(applied()).getByText('Showing 3 of 7')).toBeTruthy()
  })
})

describe('the board scrolls inside itself, never the whole page', () => {
  it('is a positioned scroll container, so screen-reader-only labels cannot widen the page', async () => {
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const row = applied().parentElement!
    expect(row.className).toContain('relative')
    expect(row.className).toContain('md:overflow-x-auto')
    expect(row.className).toContain('flex-col') // stacked on small screens
    expect(row.className).toContain('md:flex-row')
  })
})

describe('what a card shows', () => {
  it('shows name, current title, job, source, applied date and recruiter', async () => {
    board.mockResolvedValue(makeBoard([makeApplicationItem({
      id: 'x1', source: 'referral', assigned_recruiter: { id: 'u', email: 'rana@example.com', role: 'recruiter' },
      candidate: { id: 'c1', first_name: 'Sana', last_name: 'Iqbal', email: 's@example.com', current_title: 'Data Engineer' },
    })]))
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    const col = applied()
    expect(within(col).getByText('Sana Iqbal')).toBeTruthy()
    expect(within(col).getByText('Data Engineer')).toBeTruthy()
    expect(within(col).getByText('Senior Backend Engineer')).toBeTruthy()
    expect(within(col).getByText('Referral')).toBeTruthy()
    expect(within(col).getByText(/Applied 3 Nov 2026/)).toBeTruthy()
    expect(within(col).getByText('rana')).toBeTruthy()
  })

  it('falls back to the email when there is no current title, and shows "Unassigned"', async () => {
    board.mockResolvedValue(makeBoard([makeApplicationItem({
      candidate: { id: 'c1', first_name: 'Sana', last_name: 'Iqbal', email: 's@example.com', current_title: null },
    })]))
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(within(applied()).getByText('s@example.com')).toBeTruthy()
    expect(within(applied()).getByText('Unassigned')).toBeTruthy()
  })

  it('links to the application, the candidate profile and the job', async () => {
    board.mockResolvedValue(makeBoard([makeApplicationItem({ id: 'x1' })]))
    render()
    await screen.findByRole('region', { name: 'Applied column' })
    expect(within(applied()).getByRole('link', { name: 'Sana Iqbal' }).getAttribute('href')).toBe('/recruitment/applications/x1')
    expect(within(applied()).getByRole('link', { name: 'Profile of Sana Iqbal' }).getAttribute('href')).toBe('/recruitment/candidates/cand-1')
    expect(within(applied()).getByRole('link', { name: 'Senior Backend Engineer' }).getAttribute('href')).toBe('/recruitment/jobs/job-1')
  })
})

describe('filters: indicator and consistency with the list', () => {
  it('says how many filters are active and clears them together', async () => {
    const user = userEvent.setup()
    render('/recruitment/pipeline?job=job-1&source=referral&from=2026-01-01')
    await screen.findByRole('region', { name: 'Applied column' })
    expect(screen.getByRole('button', { name: 'Clear (3)' })).toBeTruthy()
    expect(screen.getByText(/application.* match(es)? the current filters/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear (3)' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/recruitment/pipeline'))
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull()
  })

  it('sends every filter to the server', async () => {
    render('/recruitment/pipeline?job=job-1&recruiter=u-1&source=agency&from=2026-01-01&to=2026-02-01')
    await screen.findByRole('region', { name: 'Applied column' })
    expect(board.mock.calls.at(-1)![0]).toMatchObject({
      job_id: 'job-1', recruiter_id: 'u-1', source: 'agency', applied_from: '2026-01-01', applied_to: '2026-02-01',
    })
  })

  it('ignores junk in the URL instead of sending it to the server', async () => {
    render('/recruitment/pipeline?job=../../etc&source=pigeon&from=yesterday&recruiter=<script>')
    await screen.findByRole('region', { name: 'Applied column' })
    expect(board.mock.calls.at(-1)![0]).toMatchObject({ job_id: '', source: '', applied_from: '', recruiter_id: '' })
  })

  it('links to the list view carrying the same filters but never the search text', async () => {
    const user = userEvent.setup()
    render('/recruitment/pipeline?job=job-1&source=agency')
    await screen.findByRole('region', { name: 'Applied column' })
    await user.type(screen.getByLabelText('Search applications'), 'sana')
    const link = screen.getByRole('link', { name: /List view/ })
    expect(link.getAttribute('href')).toBe('/recruitment/applications?job=job-1&source=agency')
  })
})
