// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { renderAs } from '../../../test/render'
import { makeRecord, makeStats, makeSummary, makeToday, me, other, settings } from '../../../test/workforceFixtures'
import { AttendanceHistoryPage } from './AttendanceHistoryPage'
import { AttendanceManagePage } from './AttendanceManagePage'
import { AttendanceOverviewPage } from './AttendanceOverviewPage'
import { AttendancePage } from './AttendancePage'

const api = vi.hoisted(() => ({
  today: vi.fn(), checkIn: vi.fn(), checkOut: vi.fn(), mine: vi.fn(), mySummary: vi.fn(), stats: vi.fn(), records: vi.fn(),
  summary: vi.fn(), addRecord: vi.fn(), correct: vi.fn(), corrections: vi.fn(), settings: vi.fn(), empList: vi.fn(),
}))
vi.mock('../../../api/workforce', () => ({
  attendanceApi: api,
  configApi: { settings: (...a: unknown[]) => api.settings(...a) },
}))
vi.mock('../../../api/employees', () => ({ employeesApi: { list: (...a: unknown[]) => api.empList(...a) } }))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.today.mockResolvedValue(makeToday())
  api.mySummary.mockResolvedValue(makeSummary())
  api.mine.mockResolvedValue({ items: [makeRecord()], total: 1, page: 1, page_size: 15 })
  api.settings.mockResolvedValue(settings)
  api.empList.mockResolvedValue({ items: [{ id: 'emp-2', first_name: 'Bilal', last_name: 'Ahmed' }], total: 1, page: 1, page_size: 20 })
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const staff = { employeeId: 'emp-1' }

describe('AttendancePage: check in and out', () => {
  it('shows the day, the schedule and a check-in button when you have not started', async () => {
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect(await screen.findByTestId('attendance-state')).toHaveProperty('textContent', 'Not checked in')
    expect(screen.getAllByText('Mon 2 Mar 2026').length).toBeGreaterThan(0)
    expect(screen.getByText(/Working day 09:00 to 17:00, with 10 minutes of grace/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check out' })).toBeNull()
  })

  it('checking in calls the server once, confirms, and reloads the state', async () => {
    api.checkIn.mockResolvedValue(makeRecord({ state: 'open', check_out_at: null, worked_minutes: null }))
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check in' }))
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('You are checked in.')).toBeTruthy()
    await waitFor(() => expect(api.today.mock.calls.length).toBeGreaterThan(1))
  })

  it('while checked in it shows the check-in time, the time worked, and offers check-out only', async () => {
    api.today.mockResolvedValue(makeToday({ state: 'checked_in', minutes_so_far: 150, record: makeRecord({ state: 'open', check_out_at: null, worked_minutes: null, is_late: true }) }))
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect((await screen.findByTestId('attendance-state')).textContent).toBe('Checked in')
    expect(screen.getByText(/In at 09:05/)).toBeTruthy()
    expect(screen.getAllByText('Late').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check out' })).toBeTruthy()
  })

  it('checking out calls the server', async () => {
    api.today.mockResolvedValue(makeToday({ state: 'checked_in', record: makeRecord({ state: 'open', check_out_at: null, worked_minutes: null }) }))
    api.checkOut.mockResolvedValue(makeRecord())
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(api.checkOut).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('You are checked out.')).toBeTruthy()
  })

  it('after checking out it shows the worked time and no buttons', async () => {
    api.today.mockResolvedValue(makeToday({ state: 'checked_out', minutes_so_far: 475, record: makeRecord({ left_early: true }) }))
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect((await screen.findByTestId('attendance-state')).textContent).toBe('Checked out')
    expect(screen.getAllByText('7h 55m').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Left early').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Check (in|out)/ })).toBeNull()
    expect(screen.getByText('You have finished for today.')).toBeTruthy()
  })

  it('shows the server message when a check-in is refused', async () => {
    api.checkIn.mockRejectedValue(new ApiError('You are already checked in.', 409))
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check in' }))
    expect(await screen.findByText('You are already checked in.')).toBeTruthy()
  })

  it('an old unclosed check-in blocks checking in and says why', async () => {
    api.today.mockResolvedValue(makeToday({ stale_open_from: '2026-02-27' }))
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect(await screen.findByText(/open check-in from Fri 27 Feb 2026/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    [{ holiday_name: 'Founders day', is_working_day: false }, /company holiday: Founders day/],
    [{ is_working_day: false }, /not a working day/],
    [{ on_leave: true }, /approved leave today/],
  ])('notes the kind of day: %j', async (over, text) => {
    api.today.mockResolvedValue(makeToday(over))
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('shows this month and the recent days, including corrections', async () => {
    api.mine.mockResolvedValue({ items: [makeRecord({ corrected: true, is_late: true })], total: 1, page: 1, page_size: 7 })
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect(await screen.findByText('Days present')).toBeTruthy()
    const tile = (label: string) => screen.getByText(label).closest('div') as HTMLElement
    expect(within(tile('Days present')).getByText('8')).toBeTruthy()
    expect(within(tile('Absent')).getByText('1')).toBeTruthy()
    expect(within(tile('Hours worked')).getByText('64h 00m')).toBeTruthy()
    expect(await screen.findByText('Corrected by HR')).toBeTruthy()
    expect(api.mySummary).toHaveBeenCalledWith('2026-03', expect.anything())
  })

  it('has empty, loading and error states', async () => {
    api.mine.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 7 })
    const { unmount } = renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect(await screen.findByText(/No attendance recorded yet/)).toBeTruthy()
    unmount()
    api.today.mockRejectedValueOnce(new ApiError('Server down', 500)).mockResolvedValueOnce(makeToday())
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('attendance-state')).toBeTruthy()
  })

  it('without a linked employee record it explains and asks the server for nothing', () => {
    renderAs(<AttendancePage />, { role: 'employee' })
    expect(screen.getByText(/not linked to an employee record/)).toBeTruthy()
    expect(api.today).not.toHaveBeenCalled()
  })

  it('has no way to edit history: the only buttons are check in or out', async () => {
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    await screen.findByTestId('attendance-state')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Check in'])
  })
})

describe('days present is shown against working days INCLUDING today', () => {
  // Today's check-in counts as present, so "present of N" must use the through-today count: it can
  // never read "8 of 7". (The finished-days count is a different number, used for absence.)
  const summary = makeSummary({ working_days_so_far: 7, working_days_through_today: 8 })
  summary.items[0].present_days = 8

  it('the employee page says "of 8 working days so far, including today"', async () => {
    api.mySummary.mockResolvedValue(summary)
    renderAs(<AttendancePage />, { role: 'employee', ...staff })
    expect(await screen.findByText('of 8 working days so far, including today')).toBeTruthy()
    expect(screen.queryByText(/of 7 working days/)).toBeNull()
  })

  it('the history page uses the same basis', async () => {
    api.mySummary.mockResolvedValue(summary)
    renderAs(<AttendanceHistoryPage />, { role: 'employee', ...staff })
    expect(await screen.findByText('of 8 working days so far')).toBeTruthy()
    expect(screen.queryByText(/7 working days/)).toBeNull()
  })
})

describe('AttendanceHistoryPage', () => {
  it('lists the month with flags, durations and the summary', async () => {
    api.mine.mockResolvedValue({ items: [makeRecord({ is_late: true }), makeRecord({ id: 'r2', work_date: '2026-03-03', check_out_at: null, worked_minutes: null, state: 'open' })], total: 2, page: 1, page_size: 15 })
    renderAs(<AttendanceHistoryPage />, { role: 'employee', ...staff })
    const list = await screen.findByRole('list', { name: 'Attendance records' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('09:05 to 17:00')
    expect(rows[0].textContent).toContain('Late')
    expect(rows[0].textContent).toContain('7h 55m')
    expect(rows[1].textContent).toContain('still in')
    expect(rows[1].textContent).toContain('Open')
    expect(await screen.findByText('Days present')).toBeTruthy()
  })

  it('asks for the chosen month only, and for late days only when asked', async () => {
    renderAs(<AttendanceHistoryPage />, { role: 'employee', ...staff })
    await screen.findByRole('list', { name: 'Attendance records' })
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Only late days'))
    await waitFor(() => expect(api.mine.mock.calls.at(-1)?.[0]).toMatchObject({ late: true, page: 1 }))
    const call = api.mine.mock.calls.at(-1)?.[0]
    expect(call.start).toMatch(/-01$/)
    expect(call.end).toMatch(/-(28|29|30|31)$/)
    expect(call.start.slice(0, 7)).toBe(call.end.slice(0, 7))
  })

  it('empty states differ for "late only"', async () => {
    api.mine.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 15 })
    renderAs(<AttendanceHistoryPage />, { role: 'employee', ...staff })
    expect(await screen.findByText('No attendance this month')).toBeTruthy()
    await userEvent.setup().click(screen.getByLabelText('Only late days'))
    expect(await screen.findByText('No late days')).toBeTruthy()
  })

  it('pages and shows errors with retry', async () => {
    api.mine.mockResolvedValue({ items: [makeRecord()], total: 40, page: 1, page_size: 15 })
    renderAs(<AttendanceHistoryPage />, { role: 'employee', ...staff })
    await screen.findByText('Page 1 of 3')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(api.mine.mock.calls.at(-1)?.[0].page).toBe(2))
  })

  it('shows an error with a retry', async () => {
    api.mine.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ items: [makeRecord()], total: 1, page: 1, page_size: 15 })
    renderAs(<AttendanceHistoryPage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Attendance records' })).toBeTruthy()
  })
})

describe('AttendanceOverviewPage (HR)', () => {
  beforeEach(() => {
    api.stats.mockResolvedValue(makeStats())
    api.summary.mockResolvedValue(makeSummary({ items: [{ ...makeSummary().items[0] }, { employee: other, present_days: 10, late_days: 0, early_days: 0, worked_minutes: 4800, expected_days: 10, leave_days: 0, absent_days: 0 }], total: 2 }))
  })

  it('shows the day and the month per employee', async () => {
    renderAs(<AttendanceOverviewPage />, { role: 'hr_manager' })
    const stats = await screen.findByLabelText(/Attendance on/)
    expect(within(stats).getByText('Expected').closest('div')?.textContent).toContain('10')
    expect(within(stats).getByText('Late').closest('div')?.textContent).toContain('2')
    expect(within(stats).getByText('Not checked in').closest('div')?.textContent).toContain('2')
    const rows = within(await screen.findByRole('list', { name: 'Attendance by employee' })).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Sana Iqbal')
    expect(rows[0].textContent).toContain('Absent: 1')
    expect(rows[1].textContent).toContain('Bilal Ahmed')
  })

  it('says nobody is expected on a holiday or weekend', async () => {
    api.stats.mockResolvedValue(makeStats({ holiday_name: 'Founders day', is_working_day: false, expected: 0 }))
    renderAs(<AttendanceOverviewPage />, { role: 'hr_manager' })
    expect(await screen.findByText(/is a company holiday: Founders day. Nobody is expected./)).toBeTruthy()
  })

  it('changing the day asks for that day', async () => {
    renderAs(<AttendanceOverviewPage />, { role: 'hr_manager' })
    await screen.findByLabelText(/Attendance on/)
    const day = screen.getByLabelText('Day') as HTMLInputElement
    await userEvent.setup().clear(day)
    await userEvent.setup().type(day, '2026-03-02')
    await waitFor(() => expect(api.stats).toHaveBeenLastCalledWith('2026-03-02', expect.anything()))
  })

  it('empty and error states', async () => {
    api.summary.mockResolvedValue(makeSummary({ items: [], total: 0 }))
    api.stats.mockRejectedValueOnce(new ApiError('nope', 500)).mockResolvedValueOnce(makeStats())
    renderAs(<AttendanceOverviewPage />, { role: 'hr_manager' })
    expect(await screen.findByText('There are no active employees to show.')).toBeTruthy()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText(/Attendance on/)).toBeTruthy()
  })
})

describe('AttendanceManagePage (HR)', () => {
  const rec = makeRecord({ employee: other, is_late: true, id: 'rec-9' })
  beforeEach(() => {
    api.records.mockResolvedValue({ items: [rec, makeRecord({ id: 'rec-8', source: 'hr', corrected: true })], total: 2, page: 1, page_size: 15 })
  })

  it('lists records with who, when, and flags, and the HR-entered ones are marked', async () => {
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    const rows = within(await screen.findByRole('list', { name: 'Records' })).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Bilal Ahmed')
    expect(rows[0].textContent).toContain('Late')
    expect(rows[1].textContent).toContain('Added by HR')
  })

  it('filters are sent to the server and can be cleared', async () => {
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    await screen.findByRole('list', { name: 'Records' })
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Late only'))
    await user.click(screen.getByLabelText('Not checked out'))
    await waitFor(() => expect(api.records.mock.calls.at(-1)?.[0]).toMatchObject({ late: true, state: 'open', page: 1 }))
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(api.records.mock.calls.at(-1)?.[0].late).toBeUndefined())
  })

  it('a correction needs a reason, converts the time from the company zone, and refreshes', async () => {
    api.correct.mockResolvedValue(rec)
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Correct Bilal Ahmed on Mon 2 Mar 2026/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    expect(await within(dialog).findByText('Say why you are changing this record.')).toBeTruthy()
    expect(api.correct).not.toHaveBeenCalled()
    const checkIn = within(dialog).getByLabelText(/Check in/) as HTMLInputElement
    expect(checkIn.value).toBe('09:05')
    await user.clear(checkIn)
    await user.type(checkIn, '08:45')
    await user.type(within(dialog).getByLabelText(/Reason/), '  Kiosk was down ')
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(api.correct).toHaveBeenCalledTimes(1))
    expect(api.correct).toHaveBeenCalledWith('rec-9', { check_in_at: '2026-03-02T03:45:00.000Z', check_out_at: '2026-03-02T12:00:00.000Z', reason: 'Kiosk was down' })
    expect(await screen.findByText(/Record corrected/)).toBeTruthy()
    await waitFor(() => expect(api.records.mock.calls.length).toBeGreaterThan(1))
  })

  it('shows the server refusal inside the dialog and keeps it open', async () => {
    api.correct.mockRejectedValue(new ApiError('The check-out time must be after the check-in time.', 422))
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Correct Bilal Ahmed/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Fixing')
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('after the check-in')
    expect(screen.queryByText(/Record corrected/)).toBeNull()
  })

  it('adds a missing record with validation and the right payload', async () => {
    api.addRecord.mockResolvedValue(rec)
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Add a record/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }))
    expect(await within(dialog).findByText('Choose the employee.')).toBeTruthy()
    expect(within(dialog).getByText('Choose the day.')).toBeTruthy()
    expect(within(dialog).getByText('Say why you are adding this record.')).toBeTruthy()
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: 'Employee' }), 'emp-2')
    await user.type(within(dialog).getByLabelText(/Day/), '2026-03-03')
    await user.type(within(dialog).getByLabelText(/Check out/), '17:30')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Forgot, confirmed by manager')
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }))
    await waitFor(() => expect(api.addRecord).toHaveBeenCalledWith({
      employee_id: 'emp-2', work_date: '2026-03-03', check_in_at: '2026-03-03T04:00:00.000Z', check_out_at: '2026-03-03T12:30:00.000Z', reason: 'Forgot, confirmed by manager',
    }))
  })

  it('refuses a check-out before the check-in unless it is marked as the next day', async () => {
    api.addRecord.mockResolvedValue(rec)
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Add a record/ }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: 'Employee' }), 'emp-2')
    await user.type(within(dialog).getByLabelText(/Day/), '2026-03-03')
    await user.clear(within(dialog).getByLabelText(/Check in/))
    await user.type(within(dialog).getByLabelText(/Check in/), '22:00')
    await user.type(within(dialog).getByLabelText(/Check out/), '03:00')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Night shift')
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }))
    expect(await within(dialog).findByText('The check-out must be after the check-in.')).toBeTruthy()
    await user.click(within(dialog).getByLabelText(/next day/))
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }))
    await waitFor(() => expect(api.addRecord.mock.calls[0][0]).toMatchObject({ check_in_at: '2026-03-03T17:00:00.000Z', check_out_at: '2026-03-03T22:00:00.000Z' }))
  })

  it('shows the correction history: who, why and before/after', async () => {
    api.corrections.mockResolvedValue([{ id: 'c1', kind: 'updated', reason: 'Kiosk was down', actor: { id: 'u1', email: 'hr@example.com' }, before: { check_in_at: '2026-03-02T05:00:00Z', check_out_at: null }, after: { check_in_at: '2026-03-02T03:45:00Z', check_out_at: '2026-03-02T12:00:00Z' }, created_at: '2026-03-03T08:00:00Z' }])
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    await userEvent.setup().click(await screen.findByRole('button', { name: /History for Bilal Ahmed/ }))
    const item = within(await screen.findByRole('list', { name: 'Corrections' })).getByRole('listitem')
    expect(item.textContent).toContain('Changed by hr@example.com')
    expect(item.textContent).toContain('Reason: Kiosk was down')
    expect(item.textContent).toContain('Before: 10:00 to still open')
    expect(item.textContent).toContain('Now: 08:45 to 17:00')
  })

  it('says so when a record was never changed', async () => {
    api.corrections.mockResolvedValue([])
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    await userEvent.setup().click(await screen.findByRole('button', { name: /History for Bilal Ahmed/ }))
    expect(await screen.findByText(/No one has changed this record/)).toBeTruthy()
  })

  it('empty and error states', async () => {
    api.records.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 15 })
    const { unmount } = renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    expect(await screen.findByText('No attendance yet')).toBeTruthy()
    unmount()
    api.records.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ items: [rec], total: 1, page: 1, page_size: 15 })
    renderAs(<AttendanceManagePage />, { role: 'hr_manager' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Records' })).toBeTruthy()
  })
})

void me
