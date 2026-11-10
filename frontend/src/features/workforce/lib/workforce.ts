import type { LeaveRequest, LeaveStatus, LeaveType, WorkSettingsInput } from '../../../types/workforce'

export const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const weekdayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/** "7h 35m", "45m", "0m". Never negative, never NaN. */
export function formatDuration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.floor(Number.isFinite(minutes ?? NaN) ? (minutes as number) : 0))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${pad(m % 60)}m` : `${m}m`
}

/** The clock time of an instant in a given IANA zone, e.g. "09:05". */
export function formatClock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Mon 2 Mar 2026" from a plain calendar day (never shifted by the viewer's time zone). */
export function formatDay(day: string): string {
  const d = parseDay(day)
  return `${weekdayShort[(d.getDay() + 6) % 7]} ${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear()}`
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} to ${formatDay(end)}`
}

export function nextDay(day: string): string {
  const d = parseDay(day)
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
}

export const monthOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${monthNames[m - 1]} ${y}`
}

/** Mon-first weeks of a month; days outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const count = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: (first.getDay() + 6) % 7 }, () => null)
  for (let d = 1; d <= count; d++) cells.push(`${month}-${pad(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
}

export const inRange = (day: string, start: string, end: string) => day >= start && day <= end

/** "Mon-Fri", "Mon, Tue, Sat". */
export function workDaysText(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 0) return 'none'
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  return contiguous && sorted.length > 2
    ? `${weekdayShort[sorted[0]]} to ${weekdayShort[sorted[sorted.length - 1]]}`
    : sorted.map((d) => weekdayShort[d]).join(', ')
}

// ---- time zones ----------------------------------------------------------------------------------

function offsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(utcMs / 1000) * 1000) / 60000
}

/** The UTC instant of a wall-clock date and time in `tz` ("2026-03-02", "09:30", "Asia/Karachi"). */
export function wallToUtc(day: string, time: string, tz: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let ms = guess - offsetMinutes(guess, tz) * 60000
  ms = guess - offsetMinutes(ms, tz) * 60000 // once more, in case the first guess crossed a clock change
  return new Date(ms).toISOString()
}

/** The wall-clock date and time of an instant in `tz`, for filling date and time inputs. */
export function utcToWall(iso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

export function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz.trim() !== ''
  } catch {
    return false
  }
}

// ---- leave ---------------------------------------------------------------------------------------

export const statusLabels: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
}

export const statusStyles: Record<LeaveStatus, string> = {
  pending: 'bg-amber-50 text-amber-800',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  withdrawn: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-600',
}

export const formatDays = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`

export interface LeaveFormValues {
  leave_type_id: string
  start_date: string
  end_date: string
  reason: string
}

export function validateLeave(v: LeaveFormValues): Partial<Record<keyof LeaveFormValues, string>> {
  const errors: Partial<Record<keyof LeaveFormValues, string>> = {}
  if (!v.leave_type_id) errors.leave_type_id = 'Choose a leave type.'
  if (!v.start_date) errors.start_date = 'Choose the first day.'
  if (!v.end_date) errors.end_date = 'Choose the last day.'
  if (v.start_date && v.end_date) {
    if (v.end_date < v.start_date) errors.end_date = 'The last day must not be before the first day.'
    else if (v.start_date.slice(0, 4) !== v.end_date.slice(0, 4)) errors.end_date = 'A request cannot span two years. Submit one per year.'
  }
  if (v.reason.length > 1000) errors.reason = 'Keep the reason under 1000 characters.'
  return errors
}

/** Why a request cannot be made against this balance (the server checks again). */
export function balanceProblem(type: LeaveType | undefined, available: number | undefined, days: number | undefined): string | null {
  if (!type || !type.tracks_balance || available === undefined || days === undefined) return null
  return days > available ? `You have ${formatDays(available)} available, and this needs ${formatDays(days)}.` : null
}

export function validateSettings(v: WorkSettingsInput): Partial<Record<keyof WorkSettingsInput, string>> {
  const errors: Partial<Record<keyof WorkSettingsInput, string>> = {}
  if (!isValidZone(v.timezone)) errors.timezone = 'Use a time zone name such as Asia/Karachi.'
  if (v.work_days.length === 0) errors.work_days = 'Choose at least one working day.'
  if (!v.work_start) errors.work_start = 'Set when the day starts.'
  if (!v.work_end) errors.work_end = 'Set when the day ends.'
  else if (v.work_start && v.work_end <= v.work_start) errors.work_end = 'The day must end after it starts.'
  if (!Number.isInteger(v.grace_minutes) || v.grace_minutes < 0 || v.grace_minutes > 240) errors.grace_minutes = 'Use 0 to 240 minutes.'
  if (!Number.isInteger(v.max_backdate_days) || v.max_backdate_days < 0 || v.max_backdate_days > 366) errors.max_backdate_days = 'Use 0 to 366 days.'
  return errors
}

export const isOwnRequest = (r: LeaveRequest, employeeId: string | null) => employeeId !== null && r.employee.id === employeeId
