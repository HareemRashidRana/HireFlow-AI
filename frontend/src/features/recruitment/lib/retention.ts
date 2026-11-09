/** Mirrors the backend rule: "expiring" = retention date within the next 30 days (inclusive). */
export const EXPIRING_WINDOW_DAYS = 30

export type RetentionKind = 'ok' | 'expiring' | 'expired'

export interface RetentionState {
  kind: RetentionKind
  /** Whole days from today to the retention date (negative once it has passed). */
  daysLeft: number
}

/** "2027-03-15" -> local midnight, so the date never shifts with the time zone. */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function retentionState(retainUntil: string, today: Date = new Date()): RetentionState {
  const msPerDay = 24 * 60 * 60 * 1000
  const daysLeft = Math.round((parseIsoDate(retainUntil).getTime() - startOfDay(today).getTime()) / msPerDay)
  if (daysLeft < 0) return { kind: 'expired', daysLeft }
  if (daysLeft <= EXPIRING_WINDOW_DAYS) return { kind: 'expiring', daysLeft }
  return { kind: 'ok', daysLeft }
}

/** Today as "YYYY-MM-DD" in the user's own time zone (what a date input expects). */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
