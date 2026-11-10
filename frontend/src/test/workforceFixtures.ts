import type {
  AttendanceRecord,
  AttendanceStats,
  EmployeeBalances,
  LeaveRequest,
  LeaveType,
  MonthSummary,
  TodayStatus,
  WorkSettings,
} from '../types/workforce'

export const me = { id: 'emp-1', name: 'Sana Iqbal', department: 'Engineering' }
export const other = { id: 'emp-2', name: 'Bilal Ahmed', department: 'Sales' }

export const makeRecord = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: 'rec-1', employee: me, work_date: '2026-03-02', check_in_at: '2026-03-02T04:05:00Z', check_out_at: '2026-03-02T12:00:00Z',
  worked_minutes: 475, is_late: false, left_early: false, source: 'self', corrected: false, timezone: 'Asia/Karachi', state: 'closed', ...over,
})

export const makeToday = (over: Partial<TodayStatus> = {}): TodayStatus => ({
  state: 'not_checked_in', work_date: '2026-03-02', timezone: 'Asia/Karachi', record: null, minutes_so_far: 0, is_working_day: true,
  holiday_name: null, on_leave: false, work_start: '09:00:00', work_end: '17:00:00', grace_minutes: 10, stale_open_from: null, ...over,
})

export const makeSummary = (over: Partial<MonthSummary> = {}): MonthSummary => ({
  month: '2026-03', working_days_so_far: 10,
  items: [{ employee: me, present_days: 8, late_days: 2, early_days: 1, worked_minutes: 3840, expected_days: 10, leave_days: 1, absent_days: 1 }],
  total: 1, page: 1, page_size: 25, totals: {}, ...over,
})

export const makeStats = (over: Partial<AttendanceStats> = {}): AttendanceStats => ({
  date: '2026-03-02', is_working_day: true, holiday_name: null, expected: 10, present: 7, late: 2, still_in: 3, checked_out: 4, on_leave: 1, not_checked_in: 2, ...over,
})

export const types: LeaveType[] = [
  { id: 't-annual', code: 'annual', name: 'Annual leave', is_paid: true, tracks_balance: true, default_days: 14, is_active: true },
  { id: 't-sick', code: 'sick', name: 'Sick leave', is_paid: true, tracks_balance: true, default_days: 10, is_active: true },
  { id: 't-unpaid', code: 'unpaid', name: 'Unpaid leave', is_paid: false, tracks_balance: false, default_days: 0, is_active: true },
]

export const makeBalances = (over: Partial<EmployeeBalances> = {}): EmployeeBalances => ({
  employee: me, year: 2026,
  balances: [
    { leave_type: { id: 't-annual', code: 'annual', name: 'Annual leave', is_paid: true }, year: 2026, entitlement: 14, used: 4, pending: 2, available: 8 },
    { leave_type: { id: 't-sick', code: 'sick', name: 'Sick leave', is_paid: true }, year: 2026, entitlement: 10, used: 0, pending: 0, available: 10 },
  ],
  ...over,
})

export const makeLeave = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: 'lv-1', employee: me, leave_type: { id: 't-annual', code: 'annual', name: 'Annual leave', is_paid: true }, start_date: '2026-03-10',
  end_date: '2026-03-12', days: 3, reason: 'Family event', status: 'pending', submitted_at: '2026-03-02T08:00:00Z', reviewer: null,
  review_reason: null, decided_at: null, cancelled_at: null, allowed_actions: ['withdraw'], ...over,
})

export const settings: WorkSettings = {
  timezone: 'Asia/Karachi', work_days: [0, 1, 2, 3, 4], work_start: '09:00:00', work_end: '17:00:00', grace_minutes: 10, max_backdate_days: 30, updated_at: null,
}
