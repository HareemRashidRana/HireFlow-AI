import { describe, expect, it } from 'vitest'
import { types } from '../../../test/workforceFixtures'
import type { WorkSettingsInput } from '../../../types/workforce'
import {
  balanceProblem,
  formatClock,
  formatDay,
  formatDays,
  formatDuration,
  formatRange,
  inRange,
  isValidZone,
  monthGrid,
  monthLabel,
  nextDay,
  shiftMonth,
  utcToWall,
  validateLeave,
  validateSettings,
  wallToUtc,
  workDaysText,
} from './workforce'

describe('durations and days', () => {
  it.each([[0, '0m'], [5, '5m'], [59, '59m'], [60, '1h 00m'], [475, '7h 55m'], [3840, '64h 00m'], [-5, '0m'], [Number.NaN, '0m'], [90.9, '1h 30m']])(
    'formatDuration(%s) = %s, never negative or NaN',
    (minutes, text) => expect(formatDuration(minutes)).toBe(text),
  )

  it('null and undefined are zero', () => {
    expect(formatDuration(null)).toBe('0m')
    expect(formatDuration(undefined)).toBe('0m')
  })

  it('formatDays pluralises and keeps half days', () => {
    expect([formatDays(0), formatDays(1), formatDays(2), formatDays(2.5)]).toEqual(['0 days', '1 day', '2 days', '2.5 days'])
  })

  it('formats a calendar day without time-zone drift', () => {
    expect(formatDay('2026-03-02')).toBe('Mon 2 Mar 2026')
    expect(formatDay('2026-12-31')).toBe('Thu 31 Dec 2026')
    expect(formatRange('2026-03-02', '2026-03-02')).toBe('Mon 2 Mar 2026')
    expect(formatRange('2026-03-02', '2026-03-04')).toBe('Mon 2 Mar 2026 to Wed 4 Mar 2026')
  })

  it('nextDay crosses month and year ends', () => {
    expect([nextDay('2026-03-02'), nextDay('2026-02-28'), nextDay('2026-12-31')]).toEqual(['2026-03-03', '2026-03-01', '2027-01-01'])
  })

  it('inRange is inclusive at both ends', () => {
    expect([inRange('2026-03-02', '2026-03-02', '2026-03-04'), inRange('2026-03-04', '2026-03-02', '2026-03-04'), inRange('2026-03-05', '2026-03-02', '2026-03-04')]).toEqual([true, true, false])
  })
})

describe('months', () => {
  it('shifts across year boundaries', () => {
    expect([shiftMonth('2026-03', 1), shiftMonth('2026-12', 1), shiftMonth('2026-01', -1), shiftMonth('2026-03', -15)]).toEqual(['2026-04', '2027-01', '2025-12', '2024-12'])
  })

  it('labels a month', () => {
    expect(monthLabel('2026-03')).toBe('March 2026')
  })

  it('builds Monday-first weeks padded with nulls (March 2026 starts on a Sunday)', () => {
    const grid = monthGrid('2026-03')
    expect(grid[0]).toEqual([null, null, null, null, null, null, '2026-03-01'])
    expect(grid[1][0]).toBe('2026-03-02')
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid.flat().filter(Boolean)).toHaveLength(31)
    expect(grid.at(-1)?.at(-1)).toBeNull()
  })

  it('a month starting on Monday has no leading padding', () => {
    expect(monthGrid('2026-06')[0][0]).toBe('2026-06-01')
  })

  it('describes the working week', () => {
    expect([workDaysText([0, 1, 2, 3, 4]), workDaysText([0, 2, 5]), workDaysText([5, 6]), workDaysText([])]).toEqual(['Mon to Fri', 'Mon, Wed, Sat', 'Sat, Sun', 'none'])
  })
})

describe('time zones', () => {
  it('shows the clock time in the zone asked for', () => {
    expect(formatClock('2026-03-02T04:05:00Z', 'Asia/Karachi')).toBe('09:05')
    expect(formatClock('2026-03-02T04:05:00Z', 'UTC')).toBe('04:05')
    expect(formatClock('2026-03-02T04:05:00Z', 'America/New_York')).toBe('23:05')
  })

  it.each([
    ['2026-03-02', '09:00', 'Asia/Karachi', '2026-03-02T04:00:00.000Z'],
    ['2026-03-02', '09:00', 'UTC', '2026-03-02T09:00:00.000Z'],
    ['2026-03-02', '00:30', 'Asia/Karachi', '2026-03-01T19:30:00.000Z'],
    ['2026-03-07', '12:00', 'America/New_York', '2026-03-07T17:00:00.000Z'], // before the clocks change (EST)
    ['2026-03-09', '12:00', 'America/New_York', '2026-03-09T16:00:00.000Z'], // after (EDT)
    ['2026-07-01', '09:00', 'Europe/London', '2026-07-01T08:00:00.000Z'], // summer time
  ])('wallToUtc(%s %s in %s)', (day, time, tz, iso) => {
    expect(wallToUtc(day, time, tz)).toBe(iso)
  })

  it('converts back to the same wall time', () => {
    for (const tz of ['Asia/Karachi', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'UTC']) {
      const iso = wallToUtc('2026-03-02', '09:30', tz)
      expect(utcToWall(iso, tz)).toEqual({ date: '2026-03-02', time: '09:30' })
    }
  })

  it('utcToWall rolls over to the local date', () => {
    expect(utcToWall('2026-03-01T19:30:00Z', 'Asia/Karachi')).toEqual({ date: '2026-03-02', time: '00:30' })
  })

  it.each([['Asia/Karachi', true], ['UTC', true], ['Mars/Base', false], ['', false], ['   ', false]])('isValidZone(%j) is %s', (tz, ok) => {
    expect(isValidZone(tz)).toBe(ok)
  })
})

describe('validateLeave', () => {
  const good = { leave_type_id: 't-annual', start_date: '2026-03-10', end_date: '2026-03-12', reason: '' }

  it('accepts a complete request, with or without a reason', () => {
    expect(validateLeave(good)).toEqual({})
    expect(validateLeave({ ...good, end_date: '2026-03-10' })).toEqual({})
  })

  it.each([
    [{ leave_type_id: '' }, 'leave_type_id'],
    [{ start_date: '' }, 'start_date'],
    [{ end_date: '' }, 'end_date'],
    [{ end_date: '2026-03-09' }, 'end_date'],
    [{ start_date: '2026-12-30', end_date: '2027-01-02' }, 'end_date'],
    [{ reason: 'x'.repeat(1001) }, 'reason'],
  ])('refuses %j (%s)', (over, field) => {
    expect(validateLeave({ ...good, ...over })[field as keyof typeof good]).toBeTruthy()
  })
})

describe('balanceProblem', () => {
  const annual = types[0]
  const unpaid = types[2]

  it('is silent when the balance covers the request, including exactly', () => {
    expect(balanceProblem(annual, 5, 5)).toBeNull()
    expect(balanceProblem(annual, 5, 3)).toBeNull()
  })

  it('explains a shortfall with both numbers', () => {
    expect(balanceProblem(annual, 2, 3)).toBe('You have 2 days available, and this needs 3 days.')
    expect(balanceProblem(annual, 0, 1)).toBe('You have 0 days available, and this needs 1 day.')
  })

  it('never blocks types without a balance, or while numbers are unknown', () => {
    expect(balanceProblem(unpaid, 0, 10)).toBeNull()
    expect(balanceProblem(undefined, 0, 10)).toBeNull()
    expect(balanceProblem(annual, undefined, 3)).toBeNull()
    expect(balanceProblem(annual, 2, undefined)).toBeNull()
  })
})

describe('validateSettings', () => {
  const good: WorkSettingsInput = { timezone: 'Asia/Karachi', work_days: [0, 1, 2, 3, 4], work_start: '09:00', work_end: '17:00', grace_minutes: 10, max_backdate_days: 30 }

  it('accepts the defaults', () => {
    expect(validateSettings(good)).toEqual({})
  })

  it.each([
    [{ timezone: 'Mars/Base' }, 'timezone'],
    [{ work_days: [] }, 'work_days'],
    [{ work_start: '' }, 'work_start'],
    [{ work_end: '' }, 'work_end'],
    [{ work_end: '09:00' }, 'work_end'],
    [{ work_end: '08:00' }, 'work_end'],
    [{ grace_minutes: -1 }, 'grace_minutes'],
    [{ grace_minutes: 241 }, 'grace_minutes'],
    [{ grace_minutes: 1.5 }, 'grace_minutes'],
    [{ grace_minutes: Number.NaN }, 'grace_minutes'],
    [{ max_backdate_days: 367 }, 'max_backdate_days'],
  ])('refuses %j (%s)', (over, field) => {
    expect(validateSettings({ ...good, ...over })[field as keyof WorkSettingsInput]).toBeTruthy()
  })

  it('allows the boundaries', () => {
    expect(validateSettings({ ...good, grace_minutes: 0, max_backdate_days: 0 })).toEqual({})
    expect(validateSettings({ ...good, grace_minutes: 240, max_backdate_days: 366 })).toEqual({})
  })
})
