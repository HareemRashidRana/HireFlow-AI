// Mirrors backend/app/schemas/workforce.py.

export interface WorkSettings {
  timezone: string
  work_days: number[] // Monday = 0
  work_start: string // "09:00:00"
  work_end: string
  grace_minutes: number
  max_backdate_days: number
  updated_at: string | null
}

export interface WorkSettingsInput {
  timezone: string
  work_days: number[]
  work_start: string // "09:00"
  work_end: string
  grace_minutes: number
  max_backdate_days: number
}

export interface Holiday {
  id: string
  day: string
  name: string
}

export interface EmployeeRef {
  id: string
  name: string
  department: string
}

export interface AttendanceRecord {
  id: string
  employee: EmployeeRef
  work_date: string
  check_in_at: string
  check_out_at: string | null
  worked_minutes: number | null
  is_late: boolean
  left_early: boolean
  source: 'self' | 'hr'
  corrected: boolean
  timezone: string
  state: 'open' | 'closed'
}

export interface AttendanceList {
  items: AttendanceRecord[]
  total: number
  page: number
  page_size: number
}

export interface TodayStatus {
  state: 'not_checked_in' | 'checked_in' | 'checked_out'
  work_date: string
  timezone: string
  record: AttendanceRecord | null
  minutes_so_far: number
  is_working_day: boolean
  holiday_name: string | null
  on_leave: boolean
  work_start: string
  work_end: string
  grace_minutes: number
  stale_open_from: string | null
}

export interface Correction {
  id: string
  kind: 'created' | 'updated'
  reason: string
  actor: { id: string; email: string } | null
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  created_at: string
}

export interface SummaryRow {
  employee: EmployeeRef
  present_days: number
  late_days: number
  early_days: number
  worked_minutes: number
  expected_days: number
  leave_days: number
  absent_days: number
}

export interface MonthSummary {
  month: string
  /** FINISHED working days (before today): what "absent" is measured against. */
  working_days_so_far: number
  /** Working days up to and including today: the basis for "days present of N". */
  working_days_through_today: number
  items: SummaryRow[]
  total: number
  page: number
  page_size: number
  totals: Record<string, number>
}

export interface AttendanceStats {
  date: string
  is_working_day: boolean
  holiday_name: string | null
  expected: number
  present: number
  late: number
  still_in: number
  checked_out: number
  on_leave: number
  not_checked_in: number
}

export interface AttendanceListParams {
  employee_id?: string
  start?: string
  end?: string
  late?: boolean
  state?: 'open' | 'closed'
  department?: string
  page?: number
  page_size?: number
}

export interface AttendanceCreate {
  employee_id: string
  work_date: string
  check_in_at: string
  check_out_at: string | null
  reason: string
}

export interface AttendanceUpdate {
  check_in_at?: string
  check_out_at?: string
  reason: string
}

// ---- leave ----

export interface LeaveType {
  id: string
  code: string
  name: string
  is_paid: boolean
  tracks_balance: boolean
  default_days: number
  is_active: boolean
}

export interface TypeRef {
  id: string
  code: string
  name: string
  is_paid: boolean
}

export interface BalanceRow {
  leave_type: TypeRef
  year: number
  entitlement: number
  used: number
  pending: number
  available: number
}

export interface EmployeeBalances {
  employee: EmployeeRef
  year: number
  balances: BalanceRow[]
}

export interface LeavePreview {
  start_date: string
  end_date: string
  days: number
  weekends_skipped: number
  holidays_skipped: number
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled'

export interface LeaveRequest {
  id: string
  employee: EmployeeRef
  leave_type: TypeRef
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  submitted_at: string
  reviewer: { email: string } | null
  review_reason: string | null
  decided_at: string | null
  cancelled_at: string | null
  allowed_actions: string[]
}

export interface LeaveList {
  items: LeaveRequest[]
  total: number
  page: number
  page_size: number
}

export interface LeaveEvent {
  event_type: string
  actor_email: string | null
  note: string | null
  created_at: string
}

export interface LeaveListParams {
  employee_id?: string
  status?: LeaveStatus
  type_id?: string
  start?: string
  end?: string
  page?: number
  page_size?: number
}

export interface LeaveSubmit {
  leave_type_id: string
  start_date: string
  end_date: string
  reason: string
}

export interface CalendarLeave {
  employee: string
  leave_type: string
  start_date: string
  end_date: string
  days: number
}

export interface LeaveCalendar {
  month: string
  holidays: Holiday[]
  my_leave: CalendarLeave[]
  team_leave: CalendarLeave[]
}

export interface LeaveStats {
  pending_requests: number
  approved_days_this_month: number
  on_leave_today: number
  starting_next_14_days: number
}

export interface WorkforceOverview {
  date: string
  timezone: string
  is_working_day: boolean
  expected: number
  present: number
  late: number
  on_leave: number
  not_checked_in: number
  pending_leave_requests: number
  attendance_rate: number | null
  leave_trend: { month: string; approved_days: number }[]
}

export interface LeaveTypeInput {
  code: string
  name: string
  is_paid: boolean
  tracks_balance: boolean
  default_days: number
  is_active: boolean
}
