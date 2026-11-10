import type {
  FeedbackContent,
  Interview,
  InterviewCreate,
  InterviewMode,
  InterviewStatus,
  InterviewType,
} from '../../../types/interview'

export const typeLabels: Record<InterviewType, string> = {
  phone_screen: 'Phone screen',
  technical: 'Technical',
  behavioral: 'Behavioural',
  hr_round: 'HR round',
  panel: 'Panel',
  final: 'Final',
  other: 'Other',
}
export const modeLabels: Record<InterviewMode, string> = {
  online: 'Online',
  in_person: 'In person',
  phone: 'Phone',
}
export const statusLabels: Record<InterviewStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
}
export const statusTone: Record<InterviewStatus, string> = {
  scheduled: 'bg-lavender-100 text-lavender-700',
  confirmed: 'bg-navy-900 text-white',
  completed: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-500 line-through',
  rescheduled: 'bg-amber-50 text-amber-800',
}
export const interviewTypes = Object.keys(typeLabels) as InterviewType[]
export const interviewModes = Object.keys(modeLabels) as InterviewMode[]
export const interviewStatuses = Object.keys(statusLabels) as InterviewStatus[]

// ---- time zones ------------------------------------------------------------------------------

const COMMON_ZONES = [
  'UTC', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London',
  'Europe/Berlin', 'Europe/Paris', 'Africa/Cairo', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney',
]

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** A short list of sensible zones, always including the user's own and the one in use. */
export function zoneOptions(...extra: (string | undefined)[]): string[] {
  return [...new Set([browserZone(), ...extra.filter((z): z is string => !!z), ...COMMON_ZONES])]
}

// ---- local date helpers (no time-zone arithmetic: the server resolves instants) ---------------

const pad = (n: number) => String(n).padStart(2, '0')

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "2026-11-20T10:00" or "2026-11-20" -> a Date at local midnight of that calendar day. */
export function parseDay(text: string): Date {
  const [y, m, d] = text.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const back = (d.getDay() + 6) % 7
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -back)
}

export const timeOf = (local: string) => local.slice(11, 16)
export const dayOf = (local: string) => local.slice(0, 10)

export function dayLabel(text: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return parseDay(text).toLocaleDateString('en-GB', options)
}

/** "Fri 20 Nov 2026, 10:00-11:00 (UTC+05:00)": in the zone the interview was scheduled in. */
export function formatRange(i: Pick<Interview, 'starts_local' | 'ends_local' | 'utc_offset'>): string {
  const same = dayOf(i.starts_local) === dayOf(i.ends_local)
  const end = same ? timeOf(i.ends_local) : `${dayLabel(i.ends_local)} ${timeOf(i.ends_local)}`
  return `${dayLabel(i.starts_local, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${timeOf(i.starts_local)}-${end} (UTC${i.utc_offset})`
}

/** The UTC range to request for a week shown in the browser's zone, padded a day each side so an
 * interview scheduled in another zone near midnight is not lost. Grouping uses the interview's own day. */
export function weekRange(weekStart: Date): { starts_from: string; starts_to: string } {
  return {
    starts_from: addDays(weekStart, -1).toISOString(),
    starts_to: addDays(weekStart, 8).toISOString(),
  }
}

export function groupByDay(items: Interview[]): Record<string, Interview[]> {
  const out: Record<string, Interview[]> = {}
  for (const i of [...items].sort((a, b) => a.starts_local.localeCompare(b.starts_local))) {
    ;(out[dayOf(i.starts_local)] ??= []).push(i)
  }
  return out
}

// ---- scheduling form -------------------------------------------------------------------------

export interface ScheduleValues {
  application_id: string
  title: string
  interview_type: InterviewType
  mode: InterviewMode
  date: string
  start_time: string
  end_time: string
  timezone: string
  location: string
  meeting_url: string
  interviewer_ids: string[]
}

export type ScheduleErrors = Partial<Record<keyof ScheduleValues, string>>

const SECRET_KEYS = new Set([
  'pwd', 'password', 'passwd', 'pass', 'passcode', 'pin', 'token', 'access_token', 'auth', 'key', 'secret',
  'code', 'otp', 'jwt', 'session', 'sid', 'signature', 'sig', 'apikey', 'api_key',
])

/** Mirrors the server: a plain https link with no password or token. Null means "fine". */
export function meetingUrlProblem(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  if (url.length > 500 || /\s/.test(url)) return 'The meeting link is not valid.'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'The meeting link must be a full https:// address.'
  }
  if (parsed.protocol !== 'https:') return 'The meeting link must be a full https:// address.'
  if (parsed.username || parsed.password) return 'The meeting link must not contain a username or password.'
  if (parsed.hash) return 'Remove the part after # from the meeting link.'
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_KEYS.has(key.toLowerCase()))
      return 'The meeting link contains a password or access token. Remove it: HireFlow does not store meeting secrets.'
  }
  return null
}

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

export function validateSchedule(v: ScheduleValues, options: { needsApplication: boolean }): ScheduleErrors {
  const e: ScheduleErrors = {}
  if (options.needsApplication && !v.application_id) e.application_id = 'Choose the application.'
  if (!v.title.trim()) e.title = 'Give the interview a title.'
  else if (v.title.trim().length > 150) e.title = 'Keep the title under 150 characters.'
  if (!v.date) e.date = 'Choose the date.'
  if (!v.start_time) e.start_time = 'Choose the start time.'
  if (!v.end_time) e.end_time = 'Choose the end time.'
  if (v.start_time && v.end_time) {
    const minutes = minutesBetween(v.start_time, v.end_time)
    if (minutes <= 0) e.end_time = 'The end time must be after the start time.'
    else if (minutes < 5) e.end_time = 'An interview must be at least 5 minutes long.'
    else if (minutes > 12 * 60) e.end_time = 'An interview can be at most 12 hours long.'
  }
  if (v.mode === 'in_person' && !v.location.trim()) e.location = 'Add the location for an in-person interview.'
  if (v.location.trim().length > 255) e.location = 'Keep the location under 255 characters.'
  const link = meetingUrlProblem(v.meeting_url)
  if (link) e.meeting_url = link
  if (v.interviewer_ids.length === 0) e.interviewer_ids = 'Choose at least one interviewer.'
  else if (v.interviewer_ids.length > 10) e.interviewer_ids = 'An interview can have at most 10 interviewers.'
  return e
}

export const hasErrors = (e: object) => Object.keys(e).length > 0

/** Local date and time plus the zone: the SERVER resolves the exact instant (and refuses a time
 * that does not exist or happens twice on a daylight-saving day). */
export function toCreatePayload(v: ScheduleValues): InterviewCreate {
  return {
    application_id: v.application_id,
    title: v.title.trim(),
    interview_type: v.interview_type,
    mode: v.mode,
    starts_at: `${v.date}T${v.start_time}`,
    ends_at: `${v.date}T${v.end_time}`,
    timezone: v.timezone,
    location: v.location.trim() || null,
    meeting_url: v.meeting_url.trim() || null,
    interviewer_ids: v.interviewer_ids,
  }
}

// ---- feedback --------------------------------------------------------------------------------

export const emptyFeedback: FeedbackContent = {
  overall_rating: null,
  technical_rating: null,
  communication_rating: null,
  problem_solving_rating: null,
  overall_feedback: null,
  technical_notes: null,
  role_notes: null,
  strengths: null,
  concerns: null,
  private_notes: null,
}

export const FEEDBACK_TEXT_MAX = 4000

export function validateFeedback(c: FeedbackContent, mode: 'submit' | 'draft'): Partial<Record<keyof FeedbackContent, string>> {
  const e: Partial<Record<keyof FeedbackContent, string>> = {}
  const texts = ['overall_feedback', 'technical_notes', 'role_notes', 'strengths', 'concerns', 'private_notes'] as const
  for (const k of texts) if ((c[k] ?? '').trim().length > FEEDBACK_TEXT_MAX) e[k] = `Keep this under ${FEEDBACK_TEXT_MAX} characters.`
  if (mode === 'submit') {
    if (c.overall_rating === null) e.overall_rating = 'Choose an overall rating before submitting.'
    if (!(c.overall_feedback ?? '').trim()) e.overall_feedback = 'Write the overall feedback before submitting.'
  }
  return e
}

/** Blank strings become null, as the server stores them. */
export function cleanFeedback(c: FeedbackContent): FeedbackContent {
  const t = (s: string | null) => (s ?? '').trim() || null
  return {
    ...c,
    overall_feedback: t(c.overall_feedback),
    technical_notes: t(c.technical_notes),
    role_notes: t(c.role_notes),
    strengths: t(c.strengths),
    concerns: t(c.concerns),
    private_notes: t(c.private_notes),
  }
}

export const eventLabels: Record<string, string> = {
  created: 'Scheduled',
  updated: 'Details changed',
  confirmed: 'Confirmed',
  completed: 'Marked completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  interviewer_added: 'Interviewer added',
  interviewer_removed: 'Interviewer removed',
}
