// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { makeOverview, makeWorkforce } from '../../test/analyticsFixtures'
import { list, makeInterview } from '../../test/interviewFixtures'
import { renderAs } from '../../test/render'
import { makeBalances, makeLeave, makeRecord, makeSummary, makeToday, other } from '../../test/workforceFixtures'
import { EmployeeHomePage } from './employee/EmployeeHomePage'
import { HrHomePage, HrReportsPage } from './hr/HrPages'
import { RecruiterHomePage } from './recruiter/RecruiterHomePage'

const wf = vi.hoisted(() => ({
  today: vi.fn(), checkIn: vi.fn(), checkOut: vi.fn(), mySummary: vi.fn(), summary: vi.fn(),
  myBalances: vi.fn(), mine: vi.fn(), list: vi.fn(), stats: vi.fn(), overview: vi.fn(),
}))
const analytics = vi.hoisted(() => ({ overview: vi.fn() }))
const interviews = vi.hoisted(() => ({ list: vi.fn() }))
const employees = vi.hoisted(() => ({ getMine: vi.fn() }))
vi.mock('../../api/workforce', () => ({
  attendanceApi: { today: wf.today, checkIn: wf.checkIn, checkOut: wf.checkOut, mySummary: wf.mySummary, summary: wf.summary },
  leaveApi: { myBalances: wf.myBalances, mine: wf.mine, list: wf.list, stats: wf.stats },
  workforceAnalyticsApi: { overview: wf.overview },
}))
vi.mock('../../api/analytics', () => ({ analyticsApi: analytics }))
vi.mock('../../api/interviews', () => ({ interviewsApi: interviews }))
vi.mock('../../api/employees', () => ({ employeesApi: employees }))

beforeEach(() => {
  for (const m of [...Object.values(wf), analytics.overview, interviews.list, employees.getMine]) m.mockReset()
  wf.today.mockResolvedValue(makeToday())
  wf.mySummary.mockResolvedValue(makeSummary())
  wf.myBalances.mockResolvedValue(makeBalances())
  wf.mine.mockResolvedValue({ items: [makeLeave(), makeLeave({ id: 'lv-2', status: 'approved', leave_type: { id: 't-sick', code: 'sick', name: 'Sick leave', is_paid: true } })], total: 2, page: 1, page_size: 4 })
  wf.list.mockResolvedValue({ items: [makeLeave({ employee: other, allowed_actions: ['approve', 'reject'] })], total: 1, page: 1, page_size: 5 })
  wf.stats.mockResolvedValue({ pending_requests: 4, approved_days_this_month: 7.5, on_leave_today: 2, starting_next_14_days: 3 })
  wf.overview.mockResolvedValue(makeWorkforce())
  wf.summary.mockResolvedValue({ ...makeSummary(), totals: { present_days: 40, late_days: 6, early_days: 3, absent_days: 2, leave_days: 5, worked_minutes: 19200 }, items: [makeSummary().items[0]] })
  analytics.overview.mockResolvedValue(makeOverview())
  interviews.list.mockResolvedValue(list([makeInterview(), makeInterview({ id: 'i2', status: 'cancelled', title: 'Cancelled one' })]))
  employees.getMine.mockResolvedValue({ id: 'emp-1', first_name: 'Sana', last_name: 'Iqbal' })
})

describe('EmployeeHomePage (the simple portal)', () => {
  const home = () => renderAs(<EmployeeHomePage />, { role: 'employee', employeeId: 'emp-1' })

  it('greets by first name and puts Check in first', async () => {
    home()
    expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty('textContent', expect.stringMatching(/^Good (morning|afternoon|evening), Sana$/))
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeTruthy()
    expect(screen.getByTestId('attendance-state').textContent).toBe('Not checked in')
  })

  it('the Check in button is large, and checking in calls the server and refreshes the day', async () => {
    wf.checkIn.mockResolvedValue(makeRecord({ state: 'open', check_out_at: null, worked_minutes: null }))
    home()
    const button = await screen.findByRole('button', { name: 'Check in' })
    expect(button.className).toContain('h-14')
    await userEvent.setup().click(button)
    await waitFor(() => expect(wf.checkIn).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('You are checked in.')).toBeTruthy()
    await waitFor(() => expect(wf.today.mock.calls.length).toBeGreaterThan(1))
  })

  it('while checked in the button becomes Check out, and checking out works', async () => {
    wf.today.mockResolvedValue(makeToday({ state: 'checked_in', record: makeRecord({ state: 'open', check_out_at: null, worked_minutes: null }) }))
    wf.checkOut.mockResolvedValue(makeRecord())
    home()
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(wf.checkOut).toHaveBeenCalledTimes(1))
  })

  it('says leave days left in plain words, with the Apply for leave button', async () => {
    home()
    const days = await screen.findByLabelText('Leave days you can still take')
    expect(within(days).getByText('Annual leave').closest('div')?.textContent).toContain('8 days')
    expect(within(days).getByText('Annual leave').closest('div')?.textContent).toContain('left of 14 days this year')
    expect(within(days).getByText('Sick leave').closest('div')?.textContent).toContain('10 days')
    expect(screen.getByRole('link', { name: 'Apply for leave' }).getAttribute('href')).toBe('/leave/requests')
  })

  it('shows the status of recent leave requests and the month in words, with a link to the history', async () => {
    home()
    const requests = await screen.findByRole('list', { name: 'My latest leave requests' })
    const rows = within(requests).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Pending')
    expect(rows[1].textContent).toContain('Approved')
    const month = await screen.findByLabelText('Attendance this month')
    expect(within(month).getByText('Days I came in').closest('div')?.textContent).toContain('8')
    expect(within(month).getByText('Times I was late').closest('div')?.textContent).toContain('2')
    expect(screen.getByRole('link', { name: 'See my attendance history' }).getAttribute('href')).toBe('/attendance/history')
  })

  it('has friendly empty states', async () => {
    wf.mine.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 4 })
    wf.myBalances.mockResolvedValue(makeBalances({ balances: [] }))
    home()
    expect(await screen.findByText(/You have not asked for leave yet/)).toBeTruthy()
    expect(await screen.findByText('HR has not set up your leave days yet.')).toBeTruthy()
  })

  it('each part fails separately, with a retry, and the rest still works', async () => {
    wf.myBalances.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeBalances())
    home()
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeTruthy()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Leave days you can still take')).toBeTruthy()
  })

  it('an account with no employee record is told so and nothing is requested', () => {
    renderAs(<EmployeeHomePage />, { role: 'employee' })
    expect(screen.getByText(/not linked to an employee record/)).toBeTruthy()
    expect(wf.today).not.toHaveBeenCalled()
    expect(wf.myBalances).not.toHaveBeenCalled()
  })

  it('offers nothing but the employee\'s own actions', async () => {
    home()
    await screen.findByRole('button', { name: 'Check in' })
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs.every((h) => ['/leave/requests', '/attendance/history'].includes(h ?? ''))).toBe(true)
  })
})

describe('HrHomePage', () => {
  it('shows today\'s attendance and leave, what waits for a decision, and quick actions', async () => {
    renderAs(<HrHomePage />, { role: 'hr_manager' })
    const tiles = await screen.findByLabelText('Workforce today')
    expect(within(tiles).getByText('Present today').closest('a, div')?.textContent).toContain('9')
    const waiting = await screen.findByRole('list', { name: 'Pending leave requests' })
    expect(waiting.textContent).toContain('Bilal Ahmed')
    expect(wf.list).toHaveBeenCalledWith({ status: 'pending', page_size: 5 }, expect.anything())
    const actions = within(screen.getByRole('list', { name: 'Quick actions' })).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(actions).toEqual(['/leave/approvals', '/attendance/manage', '/employees', '/leave/balances', '/settings/work'])
  })

  it('says when nothing is waiting, and retries a failure', async () => {
    wf.list.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 5 })
    const { unmount } = renderAs(<HrHomePage />, { role: 'hr_manager' })
    expect(await screen.findByText('No leave requests are waiting.')).toBeTruthy()
    unmount()
    wf.list.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 5 })
    renderAs(<HrHomePage />, { role: 'hr_manager' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No leave requests are waiting.')).toBeTruthy()
  })
})

describe('HrReportsPage', () => {
  it('shows a month\'s totals and each employee, and asks for the month chosen', async () => {
    renderAs(<HrReportsPage />, { role: 'hr_manager' })
    const totals = await screen.findByLabelText(/Totals for/)
    expect(within(totals).getByText('Days present').closest('div')?.textContent).toContain('40')
    expect(within(totals).getByText('Late arrivals').closest('div')?.textContent).toContain('6')
    expect(within(totals).getByText('Hours worked').closest('div')?.textContent).toContain('320h 00m')
    expect((await screen.findByRole('list', { name: 'Report by employee' })).textContent).toContain('Sana Iqbal')
    const leave = await screen.findByLabelText('Leave statistics')
    expect(within(leave).getByText('Approved days this month').closest('div')?.textContent).toContain('7.5 days')
    expect(wf.summary.mock.calls[0][0]).toMatchObject({ page: 1, page_size: 15 })
    expect(wf.summary.mock.calls[0][0].month).toMatch(/^\d{4}-\d{2}$/)
  })

  it('has an error state with a retry and an empty state', async () => {
    wf.summary.mockRejectedValueOnce(new ApiError('boom', 500))
    renderAs(<HrReportsPage />, { role: 'hr_manager' })
    wf.summary.mockResolvedValueOnce({ ...makeSummary(), items: [], total: 0, totals: { present_days: 0, late_days: 0, early_days: 0, absent_days: 0, leave_days: 0, worked_minutes: 0 } })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('There are no active employees to report on.')).toBeTruthy()
  })
})

describe('RecruiterHomePage', () => {
  it('shows the last 30 days of hiring, the funnel and the next interviews (not cancelled ones)', async () => {
    renderAs(<RecruiterHomePage />, { role: 'recruiter' })
    const figures = await screen.findByLabelText('Recruitment figures')
    expect(within(figures).getByText('Open jobs').closest('div')?.textContent).toContain('5')
    expect(within(figures).getByText('New applications').closest('div')?.textContent).toContain('20')
    expect(within(figures).getByText('Hires').closest('div')?.textContent).toContain('2')
    expect(await screen.findByRole('list', { name: 'Applications by current stage' })).toBeTruthy()
    const next = await screen.findByRole('list', { name: 'Upcoming interviews' })
    expect(next.textContent).toContain('Technical interview')
    expect(next.textContent).not.toContain('Cancelled one')
    expect(analytics.overview.mock.calls[0][0].timezone).toMatch(/\S/)
  })

  it('links to the recruiting areas and nothing else', async () => {
    renderAs(<RecruiterHomePage />, { role: 'recruiter' })
    const hrefs = within(await screen.findByRole('list', { name: 'Recruitment shortcuts' })).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/recruitment/jobs', '/recruitment/candidates', '/recruitment/applications', '/recruitment/pipeline', '/recruitment/interviews', '/dashboard'])
  })

  it('has empty and error states', async () => {
    interviews.list.mockResolvedValue(list([]))
    const { unmount } = renderAs(<RecruiterHomePage />, { role: 'recruiter' })
    expect(await screen.findByText(/No interviews are scheduled/)).toBeTruthy()
    unmount()
    analytics.overview.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeOverview())
    renderAs(<RecruiterHomePage />, { role: 'recruiter' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Recruitment figures')).toBeTruthy()
  })
})
