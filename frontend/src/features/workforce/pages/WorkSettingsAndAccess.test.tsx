// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { RequirePermission } from '../../../auth/guards'
import { homePath } from '../../../auth/permissions'
import { Sidebar } from '../../../components/layout/Sidebar'
import { WorkforcePanel } from '../../dashboard/components/WorkforcePanel'
import { makeUser } from '../../../test/fixtures'
import { makeWorkforce } from '../../../test/analyticsFixtures'
import { renderAs } from '../../../test/render'
import { settings, types } from '../../../test/workforceFixtures'
import { WorkSettingsPage } from './WorkSettingsPage'

const cfg = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn(), holidays: vi.fn(), addHoliday: vi.fn(), removeHoliday: vi.fn() }))
const leave = vi.hoisted(() => ({ types: vi.fn(), updateType: vi.fn() }))
const overview = vi.hoisted(() => vi.fn())
vi.mock('../../../api/workforce', () => ({ configApi: cfg, leaveApi: leave, workforceAnalyticsApi: { overview } }))
vi.mock('../../../hooks/useApiHealth', () => ({ useApiHealth: () => 'online' }))

beforeEach(() => {
  for (const m of [...Object.values(cfg), ...Object.values(leave), overview]) m.mockReset()
  cfg.settings.mockResolvedValue(settings)
  cfg.holidays.mockResolvedValue([{ id: 'h1', day: '2026-03-23', name: 'Pakistan Day' }])
  leave.types.mockResolvedValue(types)
  overview.mockResolvedValue(makeWorkforce())
})

describe('WorkSettingsPage', () => {
  const page = () => renderAs(<WorkSettingsPage />, { role: 'hr_manager' })

  it('loads the current rules into the form', async () => {
    page()
    expect(((await screen.findByLabelText(/Company time zone/)) as HTMLInputElement).value).toBe('Asia/Karachi')
    expect((screen.getByLabelText(/^Day starts/) as HTMLInputElement).value).toBe('09:00')
    expect((screen.getByLabelText(/^Day ends/) as HTMLInputElement).value).toBe('17:00')
    expect((screen.getByLabelText(/Grace period/) as HTMLInputElement).value).toBe('10')
    const days = within(screen.getByRole('group', { name: 'Working days' })).getAllByRole('checkbox') as HTMLInputElement[]
    expect(days.map((d) => d.checked)).toEqual([true, true, true, true, true, false, false])
  })

  it('saves what was changed, in the shape the server expects', async () => {
    cfg.saveSettings.mockResolvedValue({ ...settings, work_end: '18:00:00' })
    page()
    const user = userEvent.setup()
    const end = await screen.findByLabelText(/^Day ends/)
    await user.clear(end)
    await user.type(end, '18:00')
    await user.click(within(screen.getByRole('group', { name: 'Working days' })).getByLabelText('Sat'))
    await user.click(screen.getByRole('button', { name: 'Save working rules' }))
    await waitFor(() => expect(cfg.saveSettings).toHaveBeenCalledWith({
      timezone: 'Asia/Karachi', work_days: [0, 1, 2, 3, 4, 5], work_start: '09:00', work_end: '18:00', grace_minutes: 10, max_backdate_days: 30,
    }))
    expect(await screen.findByText(/Working rules saved/)).toBeTruthy()
  })

  it('explains each invalid value and sends nothing', async () => {
    page()
    const user = userEvent.setup()
    await user.clear(await screen.findByLabelText(/Company time zone/))
    await user.type(screen.getByLabelText(/Company time zone/), 'Mars/Base')
    fireEvent.change(screen.getByLabelText(/^Day ends/), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText(/Grace period/), { target: { value: '500' } })
    for (const box of within(screen.getByRole('group', { name: 'Working days' })).getAllByRole('checkbox') as HTMLInputElement[]) if (box.checked) await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Save working rules' }))
    expect(await screen.findByText('Use a time zone name such as Asia/Karachi.')).toBeTruthy()
    expect(screen.getByText('The day must end after it starts.')).toBeTruthy()
    expect(screen.getByText('Use 0 to 240 minutes.')).toBeTruthy()
    expect(screen.getByText('Choose at least one working day.')).toBeTruthy()
    expect(cfg.saveSettings).not.toHaveBeenCalled()
  })

  it('shows a server refusal', async () => {
    cfg.saveSettings.mockRejectedValue(new ApiError('You do not have permission to perform this action.', 403))
    page()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save working rules' }))
    expect(await screen.findByText(/do not have permission/)).toBeTruthy()
  })

  it('adds a holiday, tells HR approved leave is unchanged, and lists it', async () => {
    cfg.addHoliday.mockResolvedValue({ id: 'h2', day: '2026-08-14', name: 'Independence Day' })
    page()
    const user = userEvent.setup()
    expect((await screen.findByRole('list', { name: 'Holidays' })).textContent).toContain('Pakistan Day')
    await user.click(screen.getByRole('button', { name: 'Add holiday' }))
    expect(await screen.findByText('Choose the date and give the holiday a name.')).toBeTruthy()
    expect(cfg.addHoliday).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-14' } })
    await user.type(screen.getByLabelText('Name'), ' Independence Day ')
    await user.click(screen.getByRole('button', { name: 'Add holiday' }))
    await waitFor(() => expect(cfg.addHoliday).toHaveBeenCalledWith({ day: '2026-08-14', name: 'Independence Day' }))
    expect(await screen.findByText(/Leave already approved is not changed/)).toBeTruthy()
    await waitFor(() => expect(cfg.holidays).toHaveBeenLastCalledWith(2026, expect.anything()))
  })

  it('shows a duplicate-holiday refusal', async () => {
    cfg.addHoliday.mockRejectedValue(new ApiError('There is already a holiday on that date.', 409))
    page()
    const user = userEvent.setup()
    await screen.findByRole('list', { name: 'Holidays' })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-23' } })
    await user.type(screen.getByLabelText('Name'), 'Again')
    await user.click(screen.getByRole('button', { name: 'Add holiday' }))
    expect(await screen.findByText('There is already a holiday on that date.')).toBeTruthy()
  })

  it('removes a holiday', async () => {
    cfg.removeHoliday.mockResolvedValue(undefined)
    page()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove Pakistan Day' }))
    await waitFor(() => expect(cfg.removeHoliday).toHaveBeenCalledWith('h1'))
    expect(await screen.findByText(/Pakistan Day removed/)).toBeTruthy()
  })

  it('changing the year loads that year; a bad year is refused', async () => {
    page()
    await screen.findByRole('list', { name: 'Holidays' })
    const year = screen.getAllByLabelText('Year').at(-1) as HTMLInputElement
    fireEvent.change(year, { target: { value: '2027' } })
    await waitFor(() => expect(cfg.holidays).toHaveBeenLastCalledWith(2027, expect.anything()))
    fireEvent.change(year, { target: { value: '1900' } })
    expect(await screen.findByText('Choose a year between 2000 and 2100.')).toBeTruthy()
  })

  it('edits the yearly days of a leave type and can turn one off; unpaid types have no days', async () => {
    leave.updateType.mockResolvedValue(types[0])
    page()
    const user = userEvent.setup()
    const list = await screen.findByRole('list', { name: 'Leave types' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('No yearly days')).toBeTruthy()
    const days = within(list).getAllByLabelText('Yearly days')[0]
    expect(within(list).getByRole('button', { name: 'Save yearly days for Annual leave' }).hasAttribute('disabled')).toBe(true)
    await user.clear(days)
    await user.type(days, '16')
    await user.click(within(list).getByRole('button', { name: 'Save yearly days for Annual leave' }))
    await waitFor(() => expect(leave.updateType).toHaveBeenCalledWith('t-annual', { default_days: 16 }))
    await user.click(within(list).getAllByRole('button', { name: 'Turn off' })[2])
    await waitFor(() => expect(leave.updateType).toHaveBeenCalledWith('t-unpaid', { is_active: false }))
  })

  it('shows errors with retry for the rules and the types', async () => {
    cfg.settings.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(settings)
    leave.types.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(types)
    page()
    for (const retry of await screen.findAllByRole('button', { name: 'Try again' })) await userEvent.setup().click(retry)
    expect(await screen.findByRole('list', { name: 'Leave types' })).toBeTruthy()
    expect(await screen.findByLabelText(/Company time zone/)).toBeTruthy()
  })
})

describe('WorkforcePanel on the dashboard', () => {
  it('shows today’s real numbers, the monthly rate and the leave trend', async () => {
    renderAs(<WorkforcePanel />, { role: 'hr_manager' })
    const tiles = await screen.findByLabelText('Workforce today')
    const tile = (label: string) => within(tiles).getByText(label).closest('a, div') as HTMLElement
    expect(tile('Present today').textContent).toContain('9')
    expect(tile('Present today').textContent).toContain('of 12 expected')
    expect(tile('Late arrivals').textContent).toContain('2')
    expect(tile('On approved leave').textContent).toContain('1')
    expect(tile('Pending leave requests').textContent).toContain('3')
    expect(tile('Monthly attendance').textContent).toContain('92.5%')
    expect(tile('Pending leave requests').closest('a')?.getAttribute('href')).toBe('/leave/approvals')
    const bars = within(screen.getByRole('list', { name: 'Approved leave days per month' })).getAllByRole('listitem')
    expect(bars.map((b) => b.textContent)).toEqual(['0Oct', '2Nov', '5Dec', '0Jan', '3.5Feb', '1Mar'])
  })

  it('does not invent a rate before any working day has finished', async () => {
    overview.mockResolvedValue(makeWorkforce({ attendance_rate: null }))
    renderAs(<WorkforcePanel />, { role: 'hr_manager' })
    const tile = (await screen.findByText('Monthly attendance')).closest('div') as HTMLElement
    expect(tile.textContent).toContain('n/a')
    expect(tile.textContent).toContain('No working day has finished yet')
  })

  it('says so on a non-working day, and shows an empty trend honestly', async () => {
    overview.mockResolvedValue(makeWorkforce({ is_working_day: false, expected: 0, leave_trend: makeWorkforce().leave_trend.map((p) => ({ ...p, approved_days: 0 })) }))
    renderAs(<WorkforcePanel />, { role: 'hr_manager' })
    expect(await screen.findByText(/Today is not a working day, so nobody is expected/)).toBeTruthy()
    expect(screen.getByText('No leave was approved in these months.')).toBeTruthy()
  })

  it('shows an error with a retry', async () => {
    overview.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeWorkforce())
    renderAs(<WorkforcePanel />, { role: 'hr_manager' })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Workforce today')).toBeTruthy()
  })
})

describe('who sees what', () => {
  const links = () => [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((a) => a.textContent?.trim())

  it('an employee gets their own attendance, leave and profile, and no HR or recruitment links', () => {
    renderAs(<Sidebar />, { role: 'employee' })
    expect(links()).toEqual(['Attendance', 'Leave', 'My profile'])
  })

  it.each(['admin', 'hr_manager'] as const)('%s also gets the work schedule page, even without an employee record of their own', (role) => {
    renderAs(<Sidebar />, { role })
    expect(links()).toEqual(expect.arrayContaining(['Dashboard', 'Attendance', 'Leave', 'Work schedule']))
  })

  it('a recruiter has attendance and leave only when linked to an employee, and never the work schedule', () => {
    const { unmount } = renderAs(<Sidebar />, { role: 'recruiter' })
    expect(links()).not.toContain('Attendance')
    unmount()
    renderAs(<Sidebar />, { role: 'recruiter', employeeId: 'emp-1' })
    expect(links()).toEqual(expect.arrayContaining(['Attendance', 'Leave']))
    expect(links()).not.toContain('Work schedule')
  })

  it.each(['employee', 'recruiter'] as const)('%s is shown an access message for HR pages', (role) => {
    renderAs(<RequirePermission permission="workforce:manage"><WorkSettingsPage /></RequirePermission>, { role, employeeId: 'emp-1' })
    expect(screen.getByText("You don't have access to this page")).toBeTruthy()
    expect(cfg.settings).not.toHaveBeenCalled()
  })

  it('HR and admin are let in', async () => {
    renderAs(<RequirePermission permission="workforce:manage"><WorkSettingsPage /></RequirePermission>, { role: 'admin' })
    expect(await screen.findByRole('heading', { name: 'Work schedule' })).toBeTruthy()
  })

  it('everyone still lands where they did before', () => {
    expect(homePath(makeUser('admin'))).toBe('/dashboard')
    expect(homePath(makeUser('employee'))).toBe('/profile')
  })
})
