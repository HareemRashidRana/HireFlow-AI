// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { emptyOverview, makeJobs, makeOverview, options, points } from '../../../test/analyticsFixtures'
import { renderAs } from '../../../test/render'
import type { DashboardFilterValues } from '../lib/dashboard'
import { InterviewPanel, RecentActivity, SourcePanel, TimeToHirePanel } from './BreakdownPanels'
import { DashboardFilters } from './DashboardFilters'
import { FunnelChart } from './FunnelChart'
import { JobPerformanceTable } from './JobPerformanceTable'
import { KpiCards } from './KpiCards'
import { TrendChart } from './TrendChart'

const jobsApi = vi.hoisted(() => vi.fn())
vi.mock('../../../api/analytics', () => ({ analyticsApi: { jobs: jobsApi } }))
beforeEach(() => jobsApi.mockReset())

describe('KpiCards', () => {
  it('shows each real number with its hint and whether it is "right now" or for the period', () => {
    renderAs(<KpiCards kpis={makeOverview().kpis} period="This period" />)
    const region = screen.getByLabelText('Key figures')
    const card = (label: string) => within(region).getByText(label).closest('div')?.parentElement as HTMLElement
    expect(within(card('Employees')).getByText('42')).toBeTruthy()
    expect(within(card('Employees')).getByText('40 active')).toBeTruthy()
    expect(within(card('Employees')).getByText('Right now')).toBeTruthy()
    expect(within(card('Open jobs')).getByText('5')).toBeTruthy()
    expect(within(card('Open jobs')).getByText('3 closed')).toBeTruthy()
    expect(within(card('Applications')).getByText('20')).toBeTruthy()
    expect(within(card('Applications')).getByText('This period')).toBeTruthy()
    expect(within(card('Hires')).getByText('2')).toBeTruthy()
    expect(within(card('Upcoming interviews')).getByText('4')).toBeTruthy()
    expect(within(card('Upcoming interviews')).getByText('6 completed in this period')).toBeTruthy()
    expect(within(card('Candidates')).getByText('120')).toBeTruthy()
  })

  it('shows zeros as zeros', () => {
    renderAs(<KpiCards kpis={emptyOverview().kpis} period="This period" />)
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(6)
  })

  it('formats large numbers with separators', () => {
    renderAs(<KpiCards kpis={{ ...makeOverview().kpis, total_candidates: 12345 }} period="p" />)
    expect(screen.getByText((12345).toLocaleString())).toBeTruthy()
  })
})

describe('FunnelChart', () => {
  it('lists every stage in order with its count and share, and the total adds up', () => {
    renderAs(<FunnelChart funnel={makeOverview().funnel} />)
    const rows = within(screen.getByRole('list', { name: 'Applications by current stage' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent?.split(/\d/)[0])).toEqual(['Applied', 'Screening', 'Shortlisted', 'Interview', 'Offer', 'Hired', 'Rejected', 'Withdrawn'])
    expect(rows[0].textContent).toContain('8')
    expect(rows[0].textContent).toContain('40%')
    expect(rows[5].textContent).toContain('10%')
    expect(screen.getByText(/20 applications received in this period, each counted once at its current stage/)).toBeTruthy()
    expect(screen.getByText(/4 so far/)).toBeTruthy()
  })

  it('draws bars from zero, relative to the biggest stage', () => {
    const { container } = renderAs(<FunnelChart funnel={makeOverview().funnel} />)
    const widths = [...container.querySelectorAll<HTMLElement>('span[style]')].map((e) => e.style.width)
    expect(widths[0]).toBe('100%')
    expect(widths[1]).toBe('50%')
    expect(widths[3]).toBe('12.5%')
  })

  it('says so when there are no applications', () => {
    renderAs(<FunnelChart funnel={emptyOverview().funnel} />)
    expect(screen.getByText('No applications were received in this period.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('TrendChart', () => {
  const data = points(7, (i) => ({ applications: i + 1, interviews: i % 2, hires: i === 6 ? 3 : 0 }))

  it('is a described image with a text summary of each line', () => {
    renderAs(<TrendChart points={data} granularity="day" />)
    const img = screen.getByRole('img')
    const label = img.getAttribute('aria-label') ?? ''
    expect(label).toContain('Applications: 28 in total, most on 7 Mar (7)')
    expect(label).toContain('Interviews: 3 in total')
    expect(label).toContain('Hires: 3 in total, most on 7 Mar (3)')
  })

  it('draws one line per series and starts the axis at zero', () => {
    const { container } = renderAs(<TrendChart points={data} granularity="day" />)
    expect(container.querySelectorAll('polyline')).toHaveLength(3)
    const ticks = [...container.querySelectorAll('svg text')].map((t) => t.textContent).filter((t) => /^\d+$/.test(t ?? ''))
    expect(ticks[0]).toBe('0')
    expect(Number(ticks.at(-1))).toBeGreaterThanOrEqual(7)
  })

  it('does not rely on colour alone: lines have different dash patterns', () => {
    const { container } = renderAs(<TrendChart points={data} granularity="day" />)
    const dashes = [...container.querySelectorAll('polyline')].map((p) => p.getAttribute('stroke-dasharray'))
    expect(new Set(dashes).size).toBe(3)
  })

  it('offers the same data as a table for screen readers', () => {
    renderAs(<TrendChart points={data} granularity="day" />)
    const table = screen.getByRole('table', { name: 'Data behind the trend chart' })
    expect(within(table).getAllByRole('row')).toHaveLength(8)
    expect(within(table).getByRole('row', { name: /7 Mar 7 0 3/ })).toBeTruthy()
  })

  it('labels weeks and months honestly', () => {
    const { rerender } = renderAs(<TrendChart points={data} granularity="week" />)
    expect(screen.getByText(/Each point is one week \(starting on the date shown\)/)).toBeTruthy()
    rerender(<TrendChart points={points(3, (i) => ({ applications: i + 1 }))} granularity="month" />)
    expect(screen.getByText(/Each point is one month/)).toBeTruthy()
  })

  it('shows a message instead of a flat line when nothing happened', () => {
    const { container } = renderAs(<TrendChart points={points(7)} granularity="day" />)
    expect(screen.getByText(/Nothing happened in this period yet/)).toBeTruthy()
    expect(container.querySelector('svg[role=img]')).toBeNull()
  })

  it('copes with a single bucket', () => {
    const { container } = renderAs(<TrendChart points={points(1, () => ({ applications: 2 }))} granularity="day" />)
    expect(container.querySelector('polyline')?.getAttribute('points')).not.toMatch(/NaN/)
  })
})

describe('breakdown panels', () => {
  it('InterviewPanel: upcoming, statuses and types', () => {
    const o = makeOverview()
    renderAs(<InterviewPanel data={o.interviews} upcoming={4} />)
    expect(screen.getByText('upcoming right now', { exact: false })).toBeTruthy()
    const dl = screen.getByLabelText('Interviews in this period by status')
    expect(within(dl).getByText('Completed').nextElementSibling?.textContent).toBe('6')
    expect(within(dl).getByText('Rescheduled').nextElementSibling?.textContent).toBe('1')
    const types = within(screen.getByRole('list', { name: 'Interviews by type' })).getAllByRole('listitem')
    expect(types[0].textContent).toContain('Technical')
    expect(types[0].textContent).toContain('70%')
    expect(types[1].textContent).toContain('HR round')
  })

  it('InterviewPanel: empty, and cancelled-only', () => {
    const { rerender } = renderAs(<InterviewPanel data={emptyOverview().interviews} upcoming={0} />)
    expect(screen.getByText('No interviews were scheduled in this period.')).toBeTruthy()
    rerender(<InterviewPanel data={{ ...emptyOverview().interviews, cancelled: 2 }} upcoming={0} />)
    expect(screen.getByText('Every interview in this period was cancelled or moved.')).toBeTruthy()
  })

  it('SourcePanel shows recorded sources with shares, or an empty message', () => {
    const { rerender } = renderAs(<SourcePanel sources={makeOverview().sources} />)
    const rows = within(screen.getByRole('list', { name: 'Applications by source' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['Referral945%', 'LinkedIn630%', 'Other525%'])
    expect(screen.getByText(/Nothing is guessed/)).toBeTruthy()
    rerender(<SourcePanel sources={[]} />)
    expect(screen.getByText(/no sources to show/)).toBeTruthy()
  })

  it('TimeToHirePanel: average, no hires, and the missing-date warning', () => {
    const { rerender } = renderAs(<TimeToHirePanel data={{ average_days: 12.5, hires_measured: 2, hires_without_date: 0 }} />)
    expect(screen.getByText('12.5 days')).toBeTruthy()
    expect(screen.getByText(/across 2 hires made in this period/)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    rerender(<TimeToHirePanel data={{ average_days: null, hires_measured: 0, hires_without_date: 0 }} />)
    expect(screen.getByText('n/a')).toBeTruthy()
    expect(screen.getByText(/nothing to average/)).toBeTruthy()
    rerender(<TimeToHirePanel data={{ average_days: 4, hires_measured: 1, hires_without_date: 2 }} />)
    expect(screen.getByRole('note').textContent).toMatch(/2 hired applications have no recorded hire date/)
  })

  it('RecentActivity links to the application and shows no person', () => {
    renderAs(<RecentActivity items={makeOverview().recent_activity} />)
    const links = screen.getAllByRole('link')
    expect(links[0].getAttribute('href')).toBe('/recruitment/applications/app-1')
    expect(links[0].textContent).toContain('Moved to Screening')
    expect(links[0].textContent).toContain('Backend Engineer')
    expect(links[1].textContent).toContain('Hired')
  })

  it('RecentActivity empty state', () => {
    renderAs(<RecentActivity items={[]} />)
    expect(screen.getByText('No recruitment activity yet.')).toBeTruthy()
  })
})

describe('DashboardFilters', () => {
  const base: DashboardFilterValues = { preset: '30d', start: '', end: '', job_id: '', department: '' }
  const setup = (values = base, dirty = false) => {
    const onChange = vi.fn()
    const onReset = vi.fn()
    renderAs(<DashboardFilters values={values} options={options} onChange={onChange} onReset={onReset} dirty={dirty} />)
    return { onChange, onReset, user: userEvent.setup() }
  }

  it('offers the period presets, departments and jobs from the server', () => {
    setup()
    expect(within(screen.getByLabelText('Period')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Last 7 days', 'Last 30 days', 'Last 90 days', 'Last 12 months', 'Custom range',
    ])
    expect(within(screen.getByLabelText('Department')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All departments', 'Engineering', 'Sales'])
    expect(within(screen.getByLabelText('Job')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All jobs', 'Backend Engineer', 'Quiet Role'])
    expect(screen.queryByLabelText('From')).toBeNull()
  })

  it('reports each change with the others kept', async () => {
    const { onChange, user } = setup()
    await user.selectOptions(screen.getByLabelText('Period'), '90d')
    expect(onChange).toHaveBeenLastCalledWith({ ...base, preset: '90d' })
    await user.selectOptions(screen.getByLabelText('Department'), 'Sales')
    expect(onChange).toHaveBeenLastCalledWith({ ...base, department: 'Sales' })
  })

  it('narrows the job list to the chosen department', async () => {
    setup({ ...base, department: 'Sales' })
    expect(within(screen.getByLabelText('Job')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All jobs', 'Quiet Role'])
  })

  it('choosing a department clears a job from another department', async () => {
    const { onChange, user } = setup({ ...base, job_id: 'job-1' })
    await user.selectOptions(screen.getByLabelText('Department'), 'Sales')
    expect(onChange).toHaveBeenLastCalledWith({ ...base, job_id: '', department: 'Sales' })
  })

  it('a custom range shows date fields and explains a bad range', () => {
    setup({ ...base, preset: 'custom', start: '2026-03-10', end: '2026-03-01' })
    expect(screen.getByLabelText('From')).toBeTruthy()
    expect(screen.getByLabelText('To')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('The start date must not be after the end date.')
  })

  it('shows Reset only when something is changed', async () => {
    const { onReset, user } = setup(base, true)
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(onReset).toHaveBeenCalled()
  })

  it('has no Reset when nothing is changed, and no stray buttons', () => {
    setup()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('JobPerformanceTable', () => {
  const params = { start: '2026-03-01', end: '2026-03-07', timezone: 'UTC' }

  it('shows each job with its numbers and "n/a" when there is no conversion rate', async () => {
    jobsApi.mockResolvedValue(makeJobs())
    renderAs(<JobPerformanceTable params={params} />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1].textContent).toContain('Backend Engineer')
    expect(rows[1].textContent).toContain('Engineering')
    expect(rows[1].textContent).toContain('16.7%')
    expect(rows[2].textContent).toContain('Quiet Role')
    expect(rows[2].textContent).toContain('n/a')
    expect(within(table).getByRole('link', { name: 'Backend Engineer' }).getAttribute('href')).toBe('/recruitment/jobs/job-1')
    expect(jobsApi).toHaveBeenCalledWith({ ...params, page: 1, page_size: 8 }, expect.anything())
  })

  it('has labelled columns', async () => {
    jobsApi.mockResolvedValue(makeJobs())
    renderAs(<JobPerformanceTable params={params} />)
    await screen.findByRole('table')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Job', 'Department', 'Status', 'Applications', 'Interviews', 'Hired', 'Rejected', 'Conversion',
    ])
  })

  it('also renders stacked cards for small screens', async () => {
    jobsApi.mockResolvedValue(makeJobs())
    const { container } = renderAs(<JobPerformanceTable params={params} />)
    await screen.findByRole('table')
    expect(container.querySelector('.xl\\:block')).toBeTruthy()
    expect(container.querySelector('ul.xl\\:hidden')).toBeTruthy()
  })

  it('pages through the server', async () => {
    jobsApi.mockResolvedValue(makeJobs({ total: 20 }))
    renderAs(<JobPerformanceTable params={params} />)
    await screen.findByRole('table')
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(jobsApi).toHaveBeenLastCalledWith({ ...params, page: 2, page_size: 8 }, expect.anything()))
  })

  it('empty, loading and error states', async () => {
    jobsApi.mockResolvedValueOnce(makeJobs({ items: [], total: 0 }))
    const { unmount } = renderAs(<JobPerformanceTable params={params} />)
    expect(screen.getAllByRole('status').some((e) => /Loading job performance/.test(e.textContent ?? ''))).toBe(true)
    expect(await screen.findByText('No jobs match these filters.')).toBeTruthy()
    unmount()
    jobsApi.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeJobs())
    renderAs(<JobPerformanceTable params={params} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeTruthy()
  })
})
