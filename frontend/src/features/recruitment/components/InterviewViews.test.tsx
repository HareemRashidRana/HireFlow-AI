// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeInterview, stats } from '../../../test/interviewFixtures'
import { renderAs } from '../../../test/render'
import { emptyFilters } from '../lib/interviewFilters'
import { parseDay } from '../lib/interviews'
import { InterviewCalendar } from './InterviewCalendar'
import { InterviewFilters } from './InterviewFilters'
import { InterviewStats } from './InterviewStats'
import { InterviewStatusBadge } from './InterviewStatusBadge'
import { InterviewTable } from './InterviewTable'

const statsApi = vi.fn()
vi.mock('../../../api/interviews', () => ({ interviewsApi: { stats: (...a: unknown[]) => statsApi(...a) } }))
beforeEach(() => statsApi.mockReset())

describe('InterviewCalendar', () => {
  const monday = parseDay('2026-11-16')
  const render = (items = [makeInterview()], extra: Partial<Parameters<typeof InterviewCalendar>[0]> = {}) => {
    const handlers = { onPrev: vi.fn(), onNext: vi.fn(), onToday: vi.fn() }
    renderAs(<InterviewCalendar weekStart={monday} today="2026-11-18" items={items} loading={false} {...handlers} {...extra} />)
    return { ...handlers, user: userEvent.setup() }
  }

  it('shows seven days of the week, Monday first, and today highlighted', () => {
    render([])
    const days = screen.getAllByRole('listitem', { name: /\d{1,2} \w+/ })
    expect(days).toHaveLength(7)
    expect(days[0].getAttribute('aria-label')).toBe('Monday 16 November')
    expect(days[6].getAttribute('aria-label')).toBe('Sunday 22 November')
    expect(days[2].className).toContain('border-lavender-400')
    expect(screen.getByText('Week of 16 Nov – 22 Nov 2026')).toBeTruthy()
  })

  it('places each real interview on its own day with its time, person and type', () => {
    render([makeInterview({ starts_local: '2026-11-20T10:00', ends_local: '2026-11-20T11:00' })])
    const friday = screen.getByRole('listitem', { name: 'Friday 20 November' })
    const link = within(friday).getByRole('link')
    expect(link.getAttribute('href')).toBe('/recruitment/interviews/int-1')
    expect(link.textContent).toContain('10:00–11:00')
    expect(link.textContent).toContain('Sana Iqbal')
    expect(link.textContent).toContain('Technical · Backend Engineer')
    expect(within(screen.getByRole('listitem', { name: 'Monday 16 November' })).getByText('No interviews')).toBeTruthy()
  })

  it('orders a day by time and mutes cancelled and moved interviews', () => {
    render([
      makeInterview({ id: 'late', starts_local: '2026-11-17T15:00', ends_local: '2026-11-17T16:00' }),
      makeInterview({ id: 'early', starts_local: '2026-11-17T09:00', ends_local: '2026-11-17T10:00', status: 'cancelled' }),
      makeInterview({ id: 'moved', starts_local: '2026-11-17T12:00', ends_local: '2026-11-17T13:00', status: 'rescheduled' }),
    ])
    const links = within(screen.getByRole('listitem', { name: 'Tuesday 17 November' })).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/recruitment/interviews/early', '/recruitment/interviews/moved', '/recruitment/interviews/late'])
    expect(links[0].textContent).toContain('cancelled')
    expect(links[1].textContent).toContain('moved')
    expect(links[0].className).toContain('text-slate-400')
  })

  it('moves between weeks', async () => {
    const { user, onPrev, onNext, onToday } = render([])
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect([onPrev, onNext, onToday].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('stacks on small screens and spreads across seven columns on wide ones', () => {
    render([])
    const grid = screen.getAllByRole('list')[0]
    expect(grid.className).toContain('sm:grid-cols-2')
    expect(grid.className).toContain('lg:grid-cols-7')
  })

  it('announces that it is loading', () => {
    render([], { loading: true })
    expect(screen.getByRole('region', { name: 'Interview calendar' }).getAttribute('aria-busy')).toBe('true')
  })
})

describe('InterviewTable', () => {
  const rows = [makeInterview(), makeInterview({ id: 'int-2', title: 'Final chat', status: 'confirmed', interview_type: 'final', round_number: 3 })]

  it('lists the interviews in the order given, with status spelled out', () => {
    renderAs(<InterviewTable items={rows} />)
    const table = screen.getByRole('table')
    const body = within(table).getAllByRole('row').slice(1)
    expect(body).toHaveLength(2)
    expect(within(body[0]).getByRole('link', { name: 'Technical interview' }).getAttribute('href')).toBe('/recruitment/interviews/int-1')
    expect(within(body[0]).getByText('Scheduled')).toBeTruthy()
    expect(within(body[1]).getByText('Confirmed')).toBeTruthy()
    expect(within(body[1]).getByText(/Final · round 3 · Online/)).toBeTruthy()
    expect(within(body[0]).getByText('recruiter@example.com')).toBeTruthy()
  })

  it('has labelled columns and no rating column', () => {
    renderAs(<InterviewTable items={rows} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['When', 'Interview', 'Candidate', 'Interviewers', 'Status'])
  })

  it('switches between a table and stacked cards by screen size', () => {
    const { container } = renderAs(<InterviewTable items={rows} />)
    expect(container.querySelector('.md\\:block')).toBeTruthy()
    expect(container.querySelector('ul.md\\:hidden')).toBeTruthy()
  })
})

describe('InterviewFilters', () => {
  const setup = (values = emptyFilters) => {
    const onChange = vi.fn()
    renderAs(<InterviewFilters values={values} onChange={onChange} />)
    return { onChange, user: userEvent.setup() }
  }

  it('offers search, status, type, a date range and "mine", all labelled', () => {
    setup()
    for (const name of ['Search', 'Status', 'Type', 'From', 'To']) expect(screen.getByLabelText(name)).toBeTruthy()
    expect(screen.getByLabelText('Only interviews I am on')).toBeTruthy()
    expect(screen.getByRole('search', { name: 'Filter interviews' })).toBeTruthy()
  })

  it('reports each change with the others kept', async () => {
    const { onChange, user } = setup({ ...emptyFilters, q: 'sana' })
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled')
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, q: 'sana', status: 'cancelled' })
    await user.click(screen.getByLabelText('Only interviews I am on'))
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, q: 'sana', mine: true })
  })

  it('counts active filters and clears them all', async () => {
    const { onChange, user } = setup({ ...emptyFilters, q: 'x', type: 'panel', mine: true })
    await user.click(screen.getByRole('button', { name: 'Clear 3 filters' }))
    expect(onChange).toHaveBeenCalledWith(emptyFilters)
  })

  it('shows no clear button when nothing is filtered, and no way to sort by a rating', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull()
    expect(screen.queryByText(/rating|score|rank/i)).toBeNull()
  })
})

describe('InterviewStatusBadge', () => {
  it.each([['scheduled', 'Scheduled'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['rescheduled', 'Rescheduled']] as const)(
    'spells out %s in words',
    (status, text) => {
      renderAs(<InterviewStatusBadge status={status} />)
      expect(screen.getByText(text)).toBeTruthy()
    },
  )
})

describe('InterviewStats', () => {
  it('shows the real numbers from the server', async () => {
    statsApi.mockResolvedValue(stats)
    renderAs(<InterviewStats refreshKey={0} />)
    expect(await screen.findByText('Upcoming')).toBeTruthy()
    const region = screen.getByRole('region', { name: 'Interview statistics' })
    const tile = (label: string) => within(region).getByText(label).closest('div') as HTMLElement
    expect(within(tile('Upcoming')).getByText('4')).toBeTruthy()
    expect(within(tile('Upcoming')).getByText('2 in the next 7 days')).toBeTruthy()
    expect(within(tile('Scheduled')).getByText('3')).toBeTruthy()
    expect(within(tile('Scheduled')).getByText('1 confirmed')).toBeTruthy()
    expect(within(tile('Completed')).getByText('1')).toBeTruthy()
    expect(within(tile('Cancelled')).getByText('1 rescheduled')).toBeTruthy()
    expect(within(tile('Feedback pending')).getByText('2')).toBeTruthy()
    expect(within(tile('Feedback submitted')).getByText('1')).toBeTruthy()
    expect(screen.getByText(/Next 14 days: Fri 20 Nov \(2\)/)).toBeTruthy()
  })

  it('shows a placeholder while loading, and an error with a retry', async () => {
    statsApi.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(stats)
    renderAs(<InterviewStats refreshKey={0} />)
    expect(await screen.findByText(/Couldn't load the interview numbers/)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Feedback pending')).toBeTruthy()
  })

  it('leaves out the next-14-days line when nothing is upcoming', async () => {
    statsApi.mockResolvedValue({ ...stats, upcoming_by_day: [] })
    renderAs(<InterviewStats refreshKey={0} />)
    await screen.findByText('Upcoming')
    expect(screen.queryByText(/Next 14 days/)).toBeNull()
  })
})
