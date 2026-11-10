// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { renderAs } from '../../../test/render'
import { makeBalances, makeLeave, me, other, types } from '../../../test/workforceFixtures'
import { LeaveApprovalsPage } from './LeaveApprovalsPage'
import { LeaveBalancesPage } from './LeaveBalancesPage'
import { LeaveCalendarPage } from './LeaveCalendarPage'
import { LeaveDashboardPage } from './LeaveDashboardPage'
import { MyLeavePage } from './MyLeavePage'

const api = vi.hoisted(() => ({
  types: vi.fn(), myBalances: vi.fn(), balances: vi.fn(), allocate: vi.fn(), adjust: vi.fn(), preview: vi.fn(), submit: vi.fn(),
  mine: vi.fn(), list: vi.fn(), history: vi.fn(), approve: vi.fn(), reject: vi.fn(), withdraw: vi.fn(), cancel: vi.fn(), calendar: vi.fn(),
  stats: vi.fn(), empList: vi.fn(),
}))
vi.mock('../../../api/workforce', () => ({ leaveApi: api }))
vi.mock('../../../api/employees', () => ({ employeesApi: { list: (...a: unknown[]) => api.empList(...a) } }))

const staff = { employeeId: 'emp-1' }
const preview = (days: number, weekends = 0, holidays = 0) => ({ start_date: '2026-03-10', end_date: '2026-03-12', days, weekends_skipped: weekends, holidays_skipped: holidays })

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.types.mockResolvedValue(types)
  api.myBalances.mockResolvedValue(makeBalances())
  api.mine.mockResolvedValue({ items: [makeLeave()], total: 1, page: 1, page_size: 10 })
  api.list.mockResolvedValue({ items: [makeLeave({ employee: other, allowed_actions: ['approve', 'reject'] })], total: 1, page: 1, page_size: 10 })
  api.preview.mockResolvedValue(preview(3))
  api.history.mockResolvedValue([])
  api.stats.mockResolvedValue({ pending_requests: 4, approved_days_this_month: 7.5, on_leave_today: 2, starting_next_14_days: 3 })
  api.calendar.mockResolvedValue({ month: '2026-03', holidays: [{ id: 'h1', day: '2026-03-23', name: 'Pakistan Day' }], my_leave: [{ employee: 'Sana Iqbal', leave_type: 'Annual leave', start_date: '2026-03-10', end_date: '2026-03-12', days: 3 }], team_leave: [] })
  api.empList.mockResolvedValue({ items: [{ id: 'emp-2', first_name: 'Bilal', last_name: 'Ahmed' }], total: 1, page: 1, page_size: 20 })
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

async function fill(user: ReturnType<typeof userEvent.setup>, type = 't-annual', start = '2026-03-10', end = '2026-03-12') {
  await user.selectOptions(await screen.findByLabelText(/Leave type/), type)
  fireEvent.change(screen.getByLabelText(/First day/), { target: { value: start } })
  fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: end } })
}

describe('MyLeavePage: requesting leave', () => {
  it('shows the leave types and the balance you would draw on', async () => {
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const user = userEvent.setup()
    await fill(user)
    expect(within(screen.getByLabelText(/Leave type/)).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a type…', 'Annual leave', 'Sick leave', 'Unpaid leave (unpaid)'])
    expect(await screen.findByText(/Available 2026:/)).toBeTruthy()
    expect(screen.getByText('8 days')).toBeTruthy()
  })

  it('previews the working days, saying how many weekend days and holidays are not counted', async () => {
    api.preview.mockResolvedValue(preview(5, 2, 1))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    await fill(userEvent.setup(), 't-annual', '2026-03-10', '2026-03-18')
    const box = await screen.findByTestId('leave-preview')
    await waitFor(() => expect(box.textContent).toContain('5 days of leave (2 weekend days and 1 holiday not counted)'))
    expect(api.preview).toHaveBeenCalledWith('2026-03-10', '2026-03-18', expect.anything())
  })

  it('warns when there are no working days and will not send', async () => {
    api.preview.mockResolvedValue(preview(0, 2, 0))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    await fill(userEvent.setup(), 't-annual', '2026-03-07', '2026-03-08')
    expect(await screen.findByText(/There are no working days in this range/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks a request bigger than the balance, with both numbers', async () => {
    api.preview.mockResolvedValue(preview(9))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    await fill(userEvent.setup())
    expect(await screen.findByText('You have 8 days available, and this needs 9 days.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('unpaid leave is never blocked by a balance and says so', async () => {
    api.preview.mockResolvedValue(preview(20))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    await fill(userEvent.setup(), 't-unpaid')
    expect(await screen.findByText(/Unpaid leave never uses your paid balance/)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('leave-preview').textContent).toContain('20 days'))
    expect((screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('validates an empty form without calling the server', async () => {
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('Choose a leave type.')).toBeTruthy()
    expect(screen.getByText('Choose the first day.')).toBeTruthy()
    expect(screen.getByText('Choose the last day.')).toBeTruthy()
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('refuses a last day before the first, and a range across two years', async () => {
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const user = userEvent.setup()
    await fill(user, 't-unpaid', '2026-03-12', '2026-03-10')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('The last day must not be before the first day.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: '2027-01-02' } })
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText(/cannot span two years/)).toBeTruthy()
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('sends the request, confirms, clears the form and refreshes the list and balances', async () => {
    api.submit.mockResolvedValue(makeLeave())
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const user = userEvent.setup()
    await fill(user)
    await user.type(screen.getByLabelText(/Reason/), '  Family event ')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith({ leave_type_id: 't-annual', start_date: '2026-03-10', end_date: '2026-03-12', reason: 'Family event' }))
    expect(await screen.findByText(/Leave requested/)).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText(/First day/) as HTMLInputElement).value).toBe(''))
    expect(api.mine.mock.calls.length).toBeGreaterThan(1)
  })

  it('shows what the server says when it refuses, and keeps what was typed', async () => {
    api.submit.mockRejectedValue(new ApiError('You already have approved leave from 2026-03-09 to 2026-03-10 that overlaps these dates.', 409))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const user = userEvent.setup()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect((await screen.findAllByRole('alert')).some((a) => /overlaps these dates/.test(a.textContent ?? ''))).toBe(true)
    expect((screen.getByLabelText(/First day/) as HTMLInputElement).value).toBe('2026-03-10')
  })

  it('without a linked employee record it explains and loads nothing', () => {
    renderAs(<MyLeavePage />, { role: 'employee' })
    expect(screen.getByText(/not linked to an employee record/)).toBeTruthy()
    expect(api.types).not.toHaveBeenCalled()
  })
})

describe('MyLeavePage: your requests', () => {
  it('lists them with status and the days, and a pending one can be withdrawn', async () => {
    api.withdraw.mockResolvedValue(makeLeave({ status: 'withdrawn' }))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const row = within(await screen.findByRole('list', { name: 'Leave requests' })).getByRole('listitem')
    expect(row.textContent).toContain('Annual leave')
    expect(row.textContent).toContain('3 days')
    expect(row.textContent).toContain('Pending')
    await userEvent.setup().click(within(row).getByRole('button', { name: /^Withdraw/ }))
    await waitFor(() => expect(api.withdraw).toHaveBeenCalledWith('lv-1'))
    expect(await screen.findByText('Request withdrawn.')).toBeTruthy()
  })

  it('shows the reviewer and their note on a decided request, and no actions it should not have', async () => {
    api.mine.mockResolvedValue({ items: [makeLeave({ status: 'rejected', allowed_actions: [], reviewer: { email: 'hr@example.com' }, review_reason: 'Release week' })], total: 1, page: 1, page_size: 10 })
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const row = within(await screen.findByRole('list', { name: 'Leave requests' })).getByRole('listitem')
    expect(row.textContent).toContain('hr@example.com: Release week')
    expect(row.textContent).toContain('Rejected')
    expect(within(row).queryByRole('button', { name: /Withdraw|Approve|Reject|Cancel leave/ })).toBeNull()
  })

  it('cancelling approved leave goes through a dialog and asks the server', async () => {
    api.mine.mockResolvedValue({ items: [makeLeave({ status: 'approved', allowed_actions: ['cancel'] })], total: 1, page: 1, page_size: 10 })
    api.cancel.mockResolvedValue(makeLeave({ status: 'cancelled' }))
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Cancel leave/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/will go back to the balance/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel leave' }))
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('lv-1', ''))
    expect(await screen.findByText(/days were returned to the balance/)).toBeTruthy()
  })

  it('filters by status and pages', async () => {
    api.mine.mockResolvedValue({ items: [makeLeave()], total: 25, page: 1, page_size: 10 })
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    const user = userEvent.setup()
    await screen.findByText('Page 1 of 3')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(api.mine.mock.calls.at(-1)?.[0].page).toBe(2))
    await user.selectOptions(screen.getByLabelText('Status'), 'approved')
    await waitFor(() => expect(api.mine.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'approved', page: 1 }))
  })

  it('has empty and error states', async () => {
    api.mine.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 10 })
    const { unmount } = renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    expect(await screen.findByText('No leave requests yet')).toBeTruthy()
    unmount()
    api.mine.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ items: [makeLeave()], total: 1, page: 1, page_size: 10 })
    renderAs(<MyLeavePage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Leave requests' })).toBeTruthy()
  })
})

describe('LeaveApprovalsPage (HR)', () => {
  it('shows pending requests with who, what and when, and starts on pending', async () => {
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    const row = within(await screen.findByRole('list', { name: 'Leave requests' })).getByRole('listitem')
    expect(row.textContent).toContain('Bilal Ahmed')
    expect(row.textContent).toContain('Annual leave')
    expect(row.textContent).toContain('Tue 10 Mar 2026 to Thu 12 Mar 2026')
    expect(api.list.mock.calls[0][0]).toMatchObject({ status: 'pending', page: 1 })
  })

  it('approving takes an optional note and asks the server', async () => {
    api.approve.mockResolvedValue(makeLeave({ status: 'approved' }))
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Approve/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Note/), 'Enjoy')
    await user.click(within(dialog).getByRole('button', { name: 'Approve request' }))
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('lv-1', 'Enjoy'))
    expect(await screen.findByText('Request approved.')).toBeTruthy()
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1))
  })

  it('rejecting needs a reason and sends it', async () => {
    api.reject.mockResolvedValue(makeLeave({ status: 'rejected' }))
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Reject/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }))
    expect(await within(dialog).findByText('Say why you are rejecting this request.')).toBeTruthy()
    expect(api.reject).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText(/Reason for rejecting/), ' Release week ')
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith('lv-1', 'Release week'))
  })

  it('shows the server refusal (for example a balance that has since changed) and keeps the dialog', async () => {
    api.approve.mockRejectedValue(new ApiError('The employee no longer has enough balance to approve this request.', 409))
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Approve/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Approve request' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('no longer has enough balance')
  })

  it("your own request has no approve or reject button, and the page says another approver is needed", async () => {
    api.list.mockResolvedValue({ items: [makeLeave({ employee: me, allowed_actions: ['withdraw'] })], total: 1, page: 1, page_size: 10 })
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager', employeeId: 'emp-1' })
    const row = within(await screen.findByRole('list', { name: 'Leave requests' })).getByRole('listitem')
    expect(within(row).queryByRole('button', { name: /^Approve|^Reject/ })).toBeNull()
    expect(screen.getByText(/another HR manager or administrator has to decide it/)).toBeTruthy()
  })

  it('shows who decided and why, and the history dialog lists each step', async () => {
    api.list.mockResolvedValue({ items: [makeLeave({ employee: other, status: 'approved', allowed_actions: ['cancel'], reviewer: { email: 'hr@example.com' }, review_reason: 'Fine' })], total: 1, page: 1, page_size: 10 })
    api.history.mockResolvedValue([{ event_type: 'submitted', actor_email: 'bilal@example.com', note: null, created_at: '2026-03-02T08:00:00Z' }, { event_type: 'approved', actor_email: 'hr@example.com', note: 'Fine', created_at: '2026-03-02T09:00:00Z' }])
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    const row = within(await screen.findByRole('list', { name: 'Leave requests' })).getByRole('listitem')
    expect(row.textContent).toContain('hr@example.com: Fine')
    await userEvent.setup().click(within(row).getByRole('button', { name: /^History/ }))
    const steps = within(await screen.findByRole('list', { name: 'History' })).getAllByRole('listitem')
    expect(steps[0].textContent).toContain('Submitted')
    expect(steps[1].textContent).toContain('Approved by hr@example.com')
    expect(steps[1].textContent).toContain('Fine')
  })

  it('HR cancelling someone else’s leave must give a reason', async () => {
    api.list.mockResolvedValue({ items: [makeLeave({ employee: other, status: 'approved', allowed_actions: ['cancel'] })], total: 1, page: 1, page_size: 10 })
    api.cancel.mockResolvedValue(makeLeave({ status: 'cancelled' }))
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager', employeeId: 'emp-9' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Cancel leave/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel leave' }))
    expect(await within(dialog).findByText('Say why you are cancelling this leave.')).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/Reason/), 'Project deadline')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel leave' }))
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('lv-1', 'Project deadline'))
  })

  it('filters by status and employee, with an empty state', async () => {
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    const user = userEvent.setup()
    await screen.findByRole('list', { name: 'Leave requests' })
    api.list.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
    await user.selectOptions(screen.getByLabelText('Status'), 'approved')
    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'approved' }))
    expect(await screen.findByText('No requests found')).toBeTruthy()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Employee' }), 'emp-2')
    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[0].employee_id).toBe('emp-2'))
  })

  it('shows "nothing waiting" for an empty pending list and an error with retry', async () => {
    api.list.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 10 })
    const { unmount } = renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    expect(await screen.findByText('Nothing waiting for a decision')).toBeTruthy()
    unmount()
    api.list.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ items: [makeLeave({ employee: other, allowed_actions: ['approve'] })], total: 1, page: 1, page_size: 10 })
    renderAs(<LeaveApprovalsPage />, { role: 'hr_manager' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Leave requests' })).toBeTruthy()
  })
})

describe('LeaveBalancesPage', () => {
  it('shows your entitlement, used, pending and available per type', async () => {
    renderAs(<LeaveBalancesPage />, { role: 'employee', ...staff })
    const rows = within(await screen.findByRole('list', { name: /Leave balances for/ })).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Annual leave')
    expect(rows[0].textContent).toContain('Entitled: 14 days')
    expect(rows[0].textContent).toContain('Used: 4 days')
    expect(rows[0].textContent).toContain('Pending: 2 days')
    expect(rows[0].textContent).toContain('Available: 8 days')
    expect(screen.queryByRole('button', { name: /Grant|Adjust/ })).toBeNull()
  })

  it('asks for the chosen year', async () => {
    renderAs(<LeaveBalancesPage />, { role: 'employee', ...staff })
    await screen.findByRole('list', { name: /Leave balances for/ })
    const year = screen.getByLabelText('Year')
    fireEvent.change(year, { target: { value: '2027' } })
    await waitFor(() => expect(api.myBalances).toHaveBeenLastCalledWith(2027, expect.anything()))
  })

  it('HR grants the year to everyone and is told what happened', async () => {
    api.allocate.mockResolvedValue({ granted: 9, already_granted: 0 })
    renderAs(<LeaveBalancesPage />, { role: 'hr_manager', employeeId: 'emp-9' })
    await userEvent.setup().click(await screen.findByRole('button', { name: /Grant \d{4} entitlement to everyone/ }))
    await waitFor(() => expect(api.allocate).toHaveBeenCalledWith(new Date().getFullYear(), undefined))
    expect(await screen.findByText(/9 entitlements granted/)).toBeTruthy()
  })

  it('HR sees another employee’s balances and adjusts them with a reason', async () => {
    api.balances.mockResolvedValue(makeBalances({ employee: other }))
    api.adjust.mockResolvedValue(makeBalances({ employee: other }))
    renderAs(<LeaveBalancesPage />, { role: 'hr_manager', employeeId: 'emp-9' })
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Employee' }), 'emp-2')
    expect(await screen.findByText(/Bilal Ahmed, /)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Adjust balance' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    expect(await within(dialog).findByText('Choose a leave type.')).toBeTruthy()
    expect(within(dialog).getByText(/Enter a number of days other than zero/)).toBeTruthy()
    expect(within(dialog).getByText('Say why you are adjusting this balance.')).toBeTruthy()
    await user.selectOptions(within(dialog).getByLabelText(/Leave type/), 't-annual')
    await user.type(within(dialog).getByLabelText(/Days/), '-2')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Carry-over correction')
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    await waitFor(() => expect(api.adjust).toHaveBeenCalledWith({ employee_id: 'emp-2', leave_type_id: 't-annual', year: new Date().getFullYear(), days: -2, reason: 'Carry-over correction' }))
  })

  it('shows the server refusal for an adjustment that would overdraw', async () => {
    api.balances.mockResolvedValue(makeBalances({ employee: other }))
    api.adjust.mockRejectedValue(new ApiError('That adjustment would make the balance negative.', 422))
    renderAs(<LeaveBalancesPage />, { role: 'hr_manager', employeeId: 'emp-9' })
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Employee' }), 'emp-2')
    await user.click(await screen.findByRole('button', { name: 'Adjust balance' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText(/Leave type/), 't-annual')
    await user.type(within(dialog).getByLabelText(/Days/), '-99')
    await user.type(within(dialog).getByLabelText(/Reason/), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('negative')
  })

  it('an unlinked login sees an explanation; an unlinked HR user is asked to choose someone', async () => {
    const { unmount } = renderAs(<LeaveBalancesPage />, { role: 'employee' })
    expect(screen.getByText(/not linked to an employee record/)).toBeTruthy()
    unmount()
    renderAs(<LeaveBalancesPage />, { role: 'hr_manager' })
    expect(screen.getByText('Choose an employee to see their balances.')).toBeTruthy()
  })

  it('error state with retry', async () => {
    api.myBalances.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeBalances())
    renderAs(<LeaveBalancesPage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: /Leave balances for/ })).toBeTruthy()
  })
})

describe('LeaveCalendarPage', () => {
  it('shows holidays and your own approved leave, for the month asked', async () => {
    renderAs(<LeaveCalendarPage />, { role: 'employee', ...staff })
    expect((await screen.findByRole('list', { name: 'Holidays' })).textContent).toContain('Pakistan Day')
    expect(screen.getByRole('list', { name: 'Approved leave' }).textContent).toContain('Annual leave')
    expect(screen.getByRole('heading', { name: 'Your approved leave' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Manage holidays' })).toBeNull()
    expect(api.calendar.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}$/)
  })

  it('moves between months', async () => {
    renderAs(<LeaveCalendarPage />, { role: 'employee', ...staff })
    await screen.findByRole('list', { name: 'Holidays' })
    const first = api.calendar.mock.calls[0][0] as string
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(api.calendar.mock.calls.at(-1)?.[0]).not.toBe(first))
  })

  it('HR sees everyone’s leave by name and a link to manage holidays', async () => {
    api.calendar.mockResolvedValue({ month: '2026-03', holidays: [], my_leave: [], team_leave: [{ employee: 'Bilal Ahmed', leave_type: 'Sick leave', start_date: '2026-03-04', end_date: '2026-03-04', days: 1 }] })
    renderAs(<LeaveCalendarPage />, { role: 'hr_manager' })
    expect((await screen.findByRole('list', { name: 'Approved leave' })).textContent).toContain('Bilal Ahmed: Sick leave')
    expect(screen.getByRole('link', { name: 'Manage holidays' }).getAttribute('href')).toBe('/settings/work')
    expect(screen.getByText('No company holidays this month.')).toBeTruthy()
  })

  it('empty and error states', async () => {
    api.calendar.mockResolvedValueOnce({ month: '2026-03', holidays: [], my_leave: [], team_leave: [] })
    const { unmount } = renderAs(<LeaveCalendarPage />, { role: 'employee', ...staff })
    expect(await screen.findByText('No approved leave this month.')).toBeTruthy()
    unmount()
    api.calendar.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ month: '2026-03', holidays: [], my_leave: [], team_leave: [] })
    renderAs(<LeaveCalendarPage />, { role: 'employee', ...staff })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No approved leave this month.')).toBeTruthy()
  })
})

describe('LeaveDashboardPage', () => {
  it('an employee sees balances and their latest requests, and nothing for HR', async () => {
    renderAs(<LeaveDashboardPage />, { role: 'employee', ...staff })
    expect(await screen.findByLabelText('Your balances')).toBeTruthy()
    expect((await screen.findByRole('list', { name: 'Your latest requests' })).textContent).toContain('Annual leave')
    expect(screen.queryByLabelText('For HR')).toBeNull()
    expect(api.stats).not.toHaveBeenCalled()
    expect(api.list).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Request leave' }).getAttribute('href')).toBe('/leave/requests')
  })

  it('HR also sees the real counts and what is waiting', async () => {
    renderAs(<LeaveDashboardPage />, { role: 'hr_manager', employeeId: 'emp-9' })
    const stats = await screen.findByLabelText('Leave statistics')
    expect(within(stats).getByText('Waiting for a decision').closest('div')?.textContent).toContain('4')
    expect(within(stats).getByText('On leave today').closest('div')?.textContent).toContain('2')
    expect(within(stats).getByText('Approved days this month').closest('div')?.textContent).toContain('7.5 days')
    expect((await screen.findByRole('list', { name: 'Pending requests' })).textContent).toContain('Bilal Ahmed')
  })

  it('an unlinked HR user still gets the HR view, but no personal sections', async () => {
    renderAs(<LeaveDashboardPage />, { role: 'admin' })
    expect(await screen.findByLabelText('Leave statistics')).toBeTruthy()
    expect(screen.queryByLabelText('Your balances')).toBeNull()
    expect(api.myBalances).not.toHaveBeenCalled()
  })

  it('shows the explanation to an unlinked non-HR user', () => {
    renderAs(<LeaveDashboardPage />, { role: 'recruiter' })
    expect(screen.getByText(/not linked to an employee record/)).toBeTruthy()
  })

  it('shows errors with a retry', async () => {
    api.stats.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce({ pending_requests: 1, approved_days_this_month: 0, on_leave_today: 0, starting_next_14_days: 0 })
    renderAs(<LeaveDashboardPage />, { role: 'hr_manager', employeeId: 'emp-9' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Leave statistics')).toBeTruthy()
  })
})
