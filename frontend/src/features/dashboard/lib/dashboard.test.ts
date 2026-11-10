import { describe, expect, it } from 'vitest'
import { points } from '../../../test/analyticsFixtures'
import {
  bucketLabel,
  daysInRange,
  formatDays,
  formatPercent,
  hasActivity,
  longDay,
  niceScale,
  percentOf,
  presetRange,
  rangeProblem,
  summarise,
} from './dashboard'

describe('presetRange', () => {
  const today = new Date(2026, 2, 18) // 18 March 2026, local

  it.each([
    ['7d', '2026-03-12'],
    ['30d', '2026-02-17'],
    ['90d', '2025-12-19'],
    ['12m', '2025-03-19'],
  ] as const)('%s ends today and counts today as a day', (preset, start) => {
    const r = presetRange(preset, today)
    expect(r).toEqual({ start, end: '2026-03-18' })
    expect(daysInRange(r.start, r.end)).toBe(preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 365)
  })

  it('crosses a year end', () => {
    expect(presetRange('7d', new Date(2026, 0, 3))).toEqual({ start: '2025-12-28', end: '2026-01-03' })
  })
})

describe('rangeProblem', () => {
  it('accepts a sensible range, including a single day', () => {
    expect(rangeProblem('2026-03-01', '2026-03-31')).toBeNull()
    expect(rangeProblem('2026-03-01', '2026-03-01')).toBeNull()
  })

  it.each([
    ['', '2026-03-01', /both/],
    ['2026-03-01', '', /both/],
    ['2026-03-10', '2026-03-01', /must not be after/],
    ['2020-01-01', '2026-03-01', /at most 731/],
  ])('refuses %j to %j', (a, b, message) => {
    expect(rangeProblem(a, b)).toMatch(message)
  })

  it('allows exactly 731 days', () => {
    expect(daysInRange('2024-03-01', '2026-03-01')).toBe(731)
    expect(rangeProblem('2024-03-01', '2026-03-01')).toBeNull()
    expect(rangeProblem('2024-02-29', '2026-03-01')).toMatch(/at most 731/)
  })
})

describe('numbers', () => {
  it('percentOf never divides by zero', () => {
    expect(percentOf(0, 0)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(2, 3)).toBe(67)
  })

  it('formats conversion and days, with n/a for unknown', () => {
    expect(formatPercent(null)).toBe('n/a')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.1667)).toBe('16.7%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatDays(null)).toBe('n/a')
    expect(formatDays(1)).toBe('1 day')
    expect(formatDays(12.5)).toBe('12.5 days')
  })

  it.each([
    [0, 2, 1], [1, 2, 1], [3, 3, 1], [5, 5, 1], [9, 10, 2], [11, 15, 5], [47, 50, 10], [101, 150, 50], [980, 1000, 200],
  ])('niceScale(%i) tops out at %i in steps of %i, never below the data', (max, top, step) => {
    expect(niceScale(max)).toEqual({ top, step })
    expect(niceScale(max).top).toBeGreaterThanOrEqual(max)
  })
})

describe('labels', () => {
  it('labels days, weeks and months', () => {
    expect(bucketLabel('2026-03-09', 'day')).toBe('9 Mar')
    expect(bucketLabel('2026-03-09', 'week')).toBe('9 Mar')
    expect(bucketLabel('2026-03-01', 'month')).toBe('Mar 2026')
  })

  it('longDay does not shift with the time zone', () => {
    expect(longDay('2026-03-01')).toBe('1 Mar 2026')
    expect(longDay('2026-12-31')).toBe('31 Dec 2026')
  })
})

describe('series helpers', () => {
  it('summarise gives the total and the first peak', () => {
    const p = points(5, (i) => ({ applications: [1, 4, 2, 4, 0][i] }))
    expect(summarise(p, 'applications')).toEqual({ total: 11, peak: 4, peakAt: '2026-03-02' })
    expect(summarise(p, 'hires')).toEqual({ total: 0, peak: 0, peakAt: null })
  })

  it('hasActivity is false only when every bucket is zero', () => {
    expect(hasActivity(points(4))).toBe(false)
    expect(hasActivity(points(4, (i) => ({ hires: i === 3 ? 1 : 0 })))).toBe(true)
    expect(hasActivity([])).toBe(false)
  })
})
