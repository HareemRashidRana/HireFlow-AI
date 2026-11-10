import type { Granularity, TrendPoint } from '../../../types/analytics'

export type Preset = '7d' | '30d' | '90d' | '12m' | 'custom'

export const presetLabels: Record<Preset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
  custom: 'Custom range',
}
const presetDays: Record<Exclude<Preset, 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 }

export const MAX_RANGE_DAYS = 731

export const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-03-09" for a local calendar day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The inclusive range for a preset, ending on `today` (a local day). */
export function presetRange(preset: Exclude<Preset, 'custom'>, today: Date): { start: string; end: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (presetDays[preset] - 1))
  return { start: dayKey(start), end: dayKey(today) }
}

export function daysInRange(start: string, end: string): number {
  return Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86_400_000) + 1
}

/** A problem with a custom range, or null. Mirrors the server's rules so the user hears first. */
export function rangeProblem(start: string, end: string): string | null {
  if (!start || !end) return 'Choose both a start and an end date.'
  if (start > end) return 'The start date must not be after the end date.'
  if (daysInRange(start, end) > MAX_RANGE_DAYS) return `Choose a range of at most ${MAX_RANGE_DAYS} days.`
  return null
}

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const stageLabels: Record<string, string> = {
  applied: 'Applied',
  screening: 'Screening',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const typeLabels: Record<string, string> = {
  phone_screen: 'Phone screen',
  technical: 'Technical',
  behavioral: 'Behavioural',
  hr_round: 'HR round',
  panel: 'Panel',
  final: 'Final',
  other: 'Other',
}

export const eventLabels: Record<string, string> = {
  created: 'Application received',
  stage_changed: 'Moved to',
  assigned: 'Recruiter assigned',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  hired: 'Hired',
  reopened: 'Reopened at',
}

/** Share of a total as a whole percent; 0 when the total is 0 (never NaN). */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export function formatPercent(rate: number | null): string {
  return rate === null ? 'n/a' : `${Math.round(rate * 1000) / 10}%`
}

export function formatDays(days: number | null): string {
  return days === null ? 'n/a' : `${days} day${days === 1 ? '' : 's'}`
}

/**
 * A y axis that starts at 0, steps by a round number (1, 2, 5 times a power of ten) and has at most
 * five intervals, so ticks are whole numbers and the top never cuts the data off.
 */
export function niceScale(max: number): { top: number; step: number } {
  const target = Math.max(max, 1)
  const pow = 10 ** Math.floor(Math.log10(target))
  const candidates = [pow / 10, pow, pow * 10].flatMap((p) => [p, 2 * p, 5 * p]).filter((c) => c >= 1)
  const step = candidates.find((c) => target / c <= 5) ?? pow * 10
  return { top: Math.max(Math.ceil(target / step) * step, step * 2), step }
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "9 Mar" for days and weeks (the week STARTING that day), "Mar 2026" for months. */
export function bucketLabel(day: string, granularity: Granularity): string {
  const d = parseDay(day)
  return granularity === 'month' ? `${monthNames[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${monthNames[d.getMonth()]}`
}

/** "9 Mar 2026" for a plain local day (no time-zone shifting, unlike parsing an ISO string). */
export function longDay(day: string): string {
  const d = parseDay(day)
  return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`
}

export function bucketNoun(granularity: Granularity): string {
  if (granularity === 'day') return 'day'
  return granularity === 'week' ? 'week (starting on the date shown)' : 'month'
}

export interface SeriesSummary {
  total: number
  peak: number
  peakAt: string | null
}

export function summarise(points: TrendPoint[], key: 'applications' | 'interviews' | 'hires'): SeriesSummary {
  let total = 0
  let peak = 0
  let peakAt: string | null = null
  for (const p of points) {
    total += p[key]
    if (p[key] > peak) {
      peak = p[key]
      peakAt = p.bucket_start
    }
  }
  return { total, peak, peakAt }
}

export const hasActivity = (points: TrendPoint[]) => points.some((p) => p.applications + p.interviews + p.hires > 0)


export interface DashboardFilterValues {
  preset: Preset
  start: string // used by "custom"
  end: string
  job_id: string
  department: string
}
