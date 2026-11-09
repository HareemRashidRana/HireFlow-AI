import { describe, expect, it } from 'vitest'
import { EXPIRING_WINDOW_DAYS, retentionState, todayIso } from './retention'

// A fixed "today" so the tests never depend on the real clock: 15 March 2026, mid-afternoon.
const today = new Date(2026, 2, 15, 15, 45)

describe('retentionState', () => {
  it('is ok well before the retention date', () => {
    expect(retentionState('2027-03-15', today)).toEqual({ kind: 'ok', daysLeft: 365 })
  })

  it('is ok one day outside the expiring window', () => {
    expect(retentionState('2026-04-15', today)).toEqual({ kind: 'ok', daysLeft: 31 })
  })

  it('is expiring on the last day of the 30 day window', () => {
    expect(EXPIRING_WINDOW_DAYS).toBe(30)
    expect(retentionState('2026-04-14', today)).toEqual({ kind: 'expiring', daysLeft: 30 })
  })

  it('is expiring on the retention date itself (it has not passed yet)', () => {
    expect(retentionState('2026-03-15', today)).toEqual({ kind: 'expiring', daysLeft: 0 })
  })

  it('is expired the day after the retention date', () => {
    expect(retentionState('2026-03-14', today)).toEqual({ kind: 'expired', daysLeft: -1 })
  })

  it('stays expired long after', () => {
    expect(retentionState('2025-01-01', today).kind).toBe('expired')
  })

  it('ignores the time of day', () => {
    expect(retentionState('2026-03-16', new Date(2026, 2, 15, 0, 0)).daysLeft).toBe(1)
    expect(retentionState('2026-03-16', new Date(2026, 2, 15, 23, 59)).daysLeft).toBe(1)
  })

  it('handles month and year boundaries and leap days', () => {
    expect(retentionState('2028-02-29', new Date(2028, 1, 28)).daysLeft).toBe(1)
    expect(retentionState('2027-01-01', new Date(2026, 11, 31)).daysLeft).toBe(1)
  })
})

describe('todayIso', () => {
  it('formats a date as YYYY-MM-DD with zero padding', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(todayIso(new Date(2026, 10, 30))).toBe('2026-11-30')
  })

  it('uses the local calendar day, not UTC', () => {
    expect(todayIso(new Date(2026, 2, 15, 23, 59))).toBe('2026-03-15')
    expect(todayIso(new Date(2026, 2, 15, 0, 1))).toBe('2026-03-15')
  })
})
