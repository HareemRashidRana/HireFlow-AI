import type {
  AttendanceCreate,
  AttendanceList,
  AttendanceListParams,
  AttendanceRecord,
  AttendanceStats,
  AttendanceUpdate,
  Correction,
  EmployeeBalances,
  Holiday,
  LeaveCalendar,
  LeaveEvent,
  LeaveList,
  LeaveListParams,
  LeavePreview,
  LeaveRequest,
  LeaveStats,
  LeaveSubmit,
  LeaveType,
  LeaveTypeInput,
  MonthSummary,
  TodayStatus,
  WorkSettings,
  WorkSettingsInput,
  WorkforceOverview,
} from '../types/workforce'
import { request } from './http'
import { toQuery } from './query'

const enc = encodeURIComponent

/** Attendance. There is no route here that lets a person edit their own history. */
export const attendanceApi = {
  today: (signal?: AbortSignal) => request<TodayStatus>('/attendance/me/today', { signal }),
  checkIn: () => request<AttendanceRecord>('/attendance/check-in', { method: 'POST' }),
  checkOut: () => request<AttendanceRecord>('/attendance/check-out', { method: 'POST' }),
  mine: (params: { start?: string; end?: string; late?: boolean; page?: number; page_size?: number }, signal?: AbortSignal) =>
    request<AttendanceList>(`/attendance/me/records${toQuery(params)}`, { signal }),
  mySummary: (month: string, signal?: AbortSignal) =>
    request<MonthSummary>(`/attendance/me/summary${toQuery({ month })}`, { signal }),

  // HR
  stats: (date: string | undefined, signal?: AbortSignal) =>
    request<AttendanceStats>(`/attendance/stats${toQuery({ date })}`, { signal }),
  records: (params: AttendanceListParams, signal?: AbortSignal) =>
    request<AttendanceList>(`/attendance/records${toQuery(params)}`, { signal }),
  summary: (params: { month: string; page?: number; page_size?: number }, signal?: AbortSignal) =>
    request<MonthSummary>(`/attendance/summary${toQuery(params)}`, { signal }),
  addRecord: (data: AttendanceCreate) =>
    request<AttendanceRecord>('/attendance/records', { method: 'POST', json: data }),
  correct: (id: string, data: AttendanceUpdate) =>
    request<AttendanceRecord>(`/attendance/records/${enc(id)}`, { method: 'PATCH', json: data }),
  corrections: (id: string, signal?: AbortSignal) =>
    request<Correction[]>(`/attendance/records/${enc(id)}/corrections`, { signal }),
}

export const leaveApi = {
  types: (includeInactive: boolean, signal?: AbortSignal) =>
    request<LeaveType[]>(`/leave/types${toQuery({ include_inactive: includeInactive || undefined })}`, { signal }),
  createType: (data: LeaveTypeInput) => request<LeaveType>('/leave/types', { method: 'POST', json: data }),
  updateType: (id: string, data: Partial<Omit<LeaveTypeInput, 'code'>>) =>
    request<LeaveType>(`/leave/types/${enc(id)}`, { method: 'PATCH', json: data }),

  myBalances: (year: number | undefined, signal?: AbortSignal) =>
    request<EmployeeBalances>(`/leave/balances/me${toQuery({ year })}`, { signal }),
  balances: (employeeId: string, year: number | undefined, signal?: AbortSignal) =>
    request<EmployeeBalances>(`/leave/balances${toQuery({ employee_id: employeeId, year })}`, { signal }),
  allocate: (year: number, employeeId?: string) =>
    request<{ granted: number; already_granted: number }>('/leave/balances/allocate', {
      method: 'POST',
      json: { year, employee_id: employeeId ?? null },
    }),
  adjust: (data: { employee_id: string; leave_type_id: string; year: number; days: number; reason: string }) =>
    request<EmployeeBalances>('/leave/balances/adjust', { method: 'POST', json: data }),

  preview: (start: string, end: string, signal?: AbortSignal) =>
    request<LeavePreview>(`/leave/preview${toQuery({ start_date: start, end_date: end })}`, { signal }),
  submit: (data: LeaveSubmit) => request<LeaveRequest>('/leave/requests', { method: 'POST', json: data }),
  mine: (params: { status?: string; page?: number; page_size?: number }, signal?: AbortSignal) =>
    request<LeaveList>(`/leave/requests/me${toQuery(params)}`, { signal }),
  list: (params: LeaveListParams, signal?: AbortSignal) =>
    request<LeaveList>(`/leave/requests${toQuery(params)}`, { signal }),
  history: (id: string, signal?: AbortSignal) =>
    request<LeaveEvent[]>(`/leave/requests/${enc(id)}/history`, { signal }),
  approve: (id: string, reason: string) =>
    request<LeaveRequest>(`/leave/requests/${enc(id)}/approve`, { method: 'POST', json: { reason } }),
  reject: (id: string, reason: string) =>
    request<LeaveRequest>(`/leave/requests/${enc(id)}/reject`, { method: 'POST', json: { reason } }),
  withdraw: (id: string) => request<LeaveRequest>(`/leave/requests/${enc(id)}/withdraw`, { method: 'POST' }),
  cancel: (id: string, reason: string) =>
    request<LeaveRequest>(`/leave/requests/${enc(id)}/cancel`, { method: 'POST', json: { reason } }),
  calendar: (month: string, signal?: AbortSignal) =>
    request<LeaveCalendar>(`/leave/calendar${toQuery({ month })}`, { signal }),
  stats: (signal?: AbortSignal) => request<LeaveStats>('/leave/stats', { signal }),
}

export const configApi = {
  settings: (signal?: AbortSignal) => request<WorkSettings>('/work-settings', { signal }),
  saveSettings: (data: WorkSettingsInput) => request<WorkSettings>('/work-settings', { method: 'PUT', json: data }),
  holidays: (year: number, signal?: AbortSignal) => request<Holiday[]>(`/holidays${toQuery({ year })}`, { signal }),
  addHoliday: (data: { day: string; name: string }) => request<Holiday>('/holidays', { method: 'POST', json: data }),
  removeHoliday: (id: string) => request<void>(`/holidays/${enc(id)}`, { method: 'DELETE' }),
}

export const workforceAnalyticsApi = {
  overview: (signal?: AbortSignal) => request<WorkforceOverview>('/analytics/workforce', { signal }),
}
