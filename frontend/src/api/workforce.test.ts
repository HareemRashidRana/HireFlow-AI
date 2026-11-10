import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { attendanceApi, configApi, leaveApi, workforceAnalyticsApi } from './workforce'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

const verbs = () => request.mock.calls.map((c) => `${c[1]?.method ?? 'GET'} ${c[0]}`)

describe('attendanceApi', () => {
  it('self-service calls take no employee id: the server uses the login', async () => {
    await attendanceApi.today()
    await attendanceApi.checkIn()
    await attendanceApi.checkOut()
    await attendanceApi.mine({ start: '2026-03-01', end: '2026-03-31', late: true, page: 2, page_size: 15 })
    await attendanceApi.mySummary('2026-03')
    expect(verbs()).toEqual([
      'GET /attendance/me/today',
      'POST /attendance/check-in',
      'POST /attendance/check-out',
      'GET /attendance/me/records?start=2026-03-01&end=2026-03-31&late=true&page=2&page_size=15',
      'GET /attendance/me/summary?month=2026-03',
    ])
  })

  it('HR calls use the HR routes and PATCH for corrections', async () => {
    await attendanceApi.stats('2026-03-02')
    await attendanceApi.records({ employee_id: 'e1', state: 'open', page: 1 })
    await attendanceApi.summary({ month: '2026-03', page: 2 })
    await attendanceApi.addRecord({ employee_id: 'e1', work_date: '2026-03-02', check_in_at: 'a', check_out_at: null, reason: 'r' })
    await attendanceApi.correct('r 1', { check_in_at: 'x', reason: 'r' })
    await attendanceApi.corrections('r1')
    expect(verbs()).toEqual([
      'GET /attendance/stats?date=2026-03-02',
      'GET /attendance/records?employee_id=e1&state=open&page=1',
      'GET /attendance/summary?month=2026-03&page=2',
      'POST /attendance/records',
      'PATCH /attendance/records/r%201',
      'GET /attendance/records/r1/corrections',
    ])
  })

  it('offers no way to delete a record', () => {
    expect(Object.keys(attendanceApi).some((k) => /delete|remove/i.test(k))).toBe(false)
  })
})

describe('leaveApi', () => {
  it('requests and decisions', async () => {
    await leaveApi.preview('2026-03-02', '2026-03-04')
    await leaveApi.submit({ leave_type_id: 't', start_date: 'a', end_date: 'b', reason: '' })
    await leaveApi.approve('x', 'ok')
    await leaveApi.reject('x', 'no')
    await leaveApi.withdraw('x')
    await leaveApi.cancel('x', 'why')
    await leaveApi.history('x')
    expect(verbs()).toEqual([
      'GET /leave/preview?start_date=2026-03-02&end_date=2026-03-04',
      'POST /leave/requests',
      'POST /leave/requests/x/approve',
      'POST /leave/requests/x/reject',
      'POST /leave/requests/x/withdraw',
      'POST /leave/requests/x/cancel',
      'GET /leave/requests/x/history',
    ])
    expect(request.mock.calls[2][1].json).toEqual({ reason: 'ok' })
  })

  it('balances: own, anyone (HR), allocate and adjust', async () => {
    await leaveApi.myBalances(2026)
    await leaveApi.myBalances(undefined)
    await leaveApi.balances('e1', 2026)
    await leaveApi.allocate(2026)
    await leaveApi.allocate(2026, 'e1')
    await leaveApi.adjust({ employee_id: 'e1', leave_type_id: 't', year: 2026, days: -1, reason: 'r' })
    expect(verbs()).toEqual([
      'GET /leave/balances/me?year=2026',
      'GET /leave/balances/me',
      'GET /leave/balances?employee_id=e1&year=2026',
      'POST /leave/balances/allocate',
      'POST /leave/balances/allocate',
      'POST /leave/balances/adjust',
    ])
    expect(request.mock.calls[3][1].json).toEqual({ year: 2026, employee_id: null })
  })

  it('lists, types, calendar and stats', async () => {
    await leaveApi.mine({ status: 'pending' })
    await leaveApi.list({ employee_id: 'e1', status: 'approved', page: 2 })
    await leaveApi.types(false)
    await leaveApi.types(true)
    await leaveApi.createType({ code: 'x', name: 'X', is_paid: true, tracks_balance: true, default_days: 1, is_active: true })
    await leaveApi.updateType('t', { default_days: 3 })
    await leaveApi.calendar('2026-03')
    await leaveApi.stats()
    expect(verbs()).toEqual([
      'GET /leave/requests/me?status=pending',
      'GET /leave/requests?employee_id=e1&status=approved&page=2',
      'GET /leave/types',
      'GET /leave/types?include_inactive=true',
      'POST /leave/types',
      'PATCH /leave/types/t',
      'GET /leave/calendar?month=2026-03',
      'GET /leave/stats',
    ])
  })
})

describe('configApi and workforce analytics', () => {
  it('settings and holidays', async () => {
    await configApi.settings()
    await configApi.saveSettings({ timezone: 'UTC', work_days: [0], work_start: '09:00', work_end: '17:00', grace_minutes: 1, max_backdate_days: 1 })
    await configApi.holidays(2026)
    await configApi.addHoliday({ day: '2026-03-23', name: 'x' })
    await configApi.removeHoliday('h 1')
    await workforceAnalyticsApi.overview()
    expect(verbs()).toEqual([
      'GET /work-settings',
      'PUT /work-settings',
      'GET /holidays?year=2026',
      'POST /holidays',
      'DELETE /holidays/h%201',
      'GET /analytics/workforce',
    ])
  })
})
