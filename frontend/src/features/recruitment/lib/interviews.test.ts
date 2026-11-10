import { describe, expect, it } from 'vitest'
import { makeInterview } from '../../../test/interviewFixtures'
import {
  addDays,
  cleanFeedback,
  dateKey,
  emptyFeedback,
  formatRange,
  groupByDay,
  meetingUrlProblem,
  minutesBetween,
  parseDay,
  startOfWeek,
  toCreatePayload,
  validateFeedback,
  validateSchedule,
  weekRange,
  zoneOptions,
} from './interviews'
import type { ScheduleValues } from './interviews'

const good = (over: Partial<ScheduleValues> = {}): ScheduleValues => ({
  application_id: 'app-1', title: 'Technical interview', interview_type: 'technical', mode: 'online', date: '2026-11-20',
  start_time: '10:00', end_time: '11:00', timezone: 'Asia/Karachi', location: '', meeting_url: '', interviewer_ids: ['u1'], ...over,
})

describe('validateSchedule', () => {
  it('accepts a complete form', () => {
    expect(validateSchedule(good(), { needsApplication: true })).toEqual({})
  })

  it.each([
    [{ title: '' }, 'title'], [{ title: '   ' }, 'title'], [{ title: 'x'.repeat(151) }, 'title'],
    [{ date: '' }, 'date'], [{ start_time: '' }, 'start_time'], [{ end_time: '' }, 'end_time'],
    [{ end_time: '10:00' }, 'end_time'], [{ end_time: '09:00' }, 'end_time'], [{ end_time: '10:04' }, 'end_time'],
    [{ end_time: '22:30' }, 'end_time'], [{ mode: 'in_person' as const }, 'location'], [{ location: 'x'.repeat(256) }, 'location'],
    [{ meeting_url: 'http://meet.example.com/x' }, 'meeting_url'], [{ meeting_url: 'not a link' }, 'meeting_url'],
    [{ meeting_url: 'https://meet.example.com/j/1?pwd=abc' }, 'meeting_url'], [{ interviewer_ids: [] }, 'interviewer_ids'],
    [{ interviewer_ids: Array.from({ length: 11 }, (_, i) => `u${i}`) }, 'interviewer_ids'], [{ application_id: '' }, 'application_id'],
  ])('refuses %j (%s)', (over, field) => {
    expect(validateSchedule(good(over), { needsApplication: true })[field as keyof ScheduleValues]).toBeTruthy()
  })

  it('does not ask for an application when the page already knows it', () => {
    expect(validateSchedule(good({ application_id: '' }), { needsApplication: false })).toEqual({})
  })

  it('an in-person interview is fine once it has a location', () => {
    expect(validateSchedule(good({ mode: 'in_person', location: 'Head office' }), { needsApplication: true })).toEqual({})
  })
})

describe('meetingUrlProblem', () => {
  it.each(['', '   ', 'https://meet.example.com/room/abc', 'https://zoom.us/j/123?from=addon'])('accepts %j', (u) => {
    expect(meetingUrlProblem(u)).toBeNull()
  })

  it.each([
    ['http://x.example.com', /https/], ['ftp://x.example.com', /https/], ['x.example.com/room', /https/], ['javascript:alert(1)', /https/],
    ['https://user:pw@x.example.com/', /username or password/], ['https://x.example.com/a#frag', /#/],
    ['https://x.example.com/a b', /not valid/], [`https://x.example.com/${'a'.repeat(500)}`, /not valid/],
  ])('refuses %j', (u, message) => {
    expect(meetingUrlProblem(u)).toMatch(message)
  })

  it.each(['pwd', 'PASSWORD', 'passcode', 'token', 'access_token', 'key', 'secret', 'otp', 'jwt', 'sig'])('refuses a link carrying %s', (k) => {
    expect(meetingUrlProblem(`https://x.example.com/j/1?lang=en&${k}=abc`)).toMatch(/password or access token/)
  })
})

describe('toCreatePayload', () => {
  it('sends the local date and times and the zone: the server decides the instant', () => {
    expect(toCreatePayload(good({ title: '  Hi  ', location: ' Room 1 ', meeting_url: ' https://m.example.com/x ' }))).toEqual({
      application_id: 'app-1', title: 'Hi', interview_type: 'technical', mode: 'online', starts_at: '2026-11-20T10:00',
      ends_at: '2026-11-20T11:00', timezone: 'Asia/Karachi', location: 'Room 1', meeting_url: 'https://m.example.com/x', interviewer_ids: ['u1'],
    })
  })

  it('turns blanks into null and never sends a UTC conversion', () => {
    const p = toCreatePayload(good())
    expect(p.location).toBeNull()
    expect(p.meeting_url).toBeNull()
    expect(p.starts_at).not.toMatch(/Z|[+-]\d\d:\d\d$/)
  })
})

describe('dates and weeks', () => {
  it('minutesBetween', () => {
    expect(minutesBetween('10:00', '11:30')).toBe(90)
    expect(minutesBetween('11:00', '10:00')).toBe(-60)
  })

  it.each([['2026-11-18', '2026-11-16'], ['2026-11-16', '2026-11-16'], ['2026-11-22', '2026-11-16'], ['2026-11-23', '2026-11-23'], ['2026-01-01', '2025-12-29']])(
    'the week of %s starts on Monday %s',
    (day, monday) => expect(dateKey(startOfWeek(parseDay(day)))).toBe(monday),
  )

  it('addDays crosses month and year ends', () => {
    expect(dateKey(addDays(parseDay('2026-12-30'), 3))).toBe('2027-01-02')
    expect(dateKey(addDays(parseDay('2026-03-01'), -1))).toBe('2026-02-28')
  })

  it('the requested range covers the week with a day of padding each side', () => {
    const r = weekRange(parseDay('2026-11-16'))
    expect(new Date(r.starts_to).getTime() - new Date(r.starts_from).getTime()).toBeGreaterThanOrEqual(9 * 24 * 3600 * 1000 - 3600 * 1000) // 9 days (an hour of slack for a clock change)
  })

  it("groups by each interview's own day, in start order", () => {
    const a = makeInterview({ id: 'a', starts_local: '2026-11-20T15:00', ends_local: '2026-11-20T16:00' })
    const b = makeInterview({ id: 'b', starts_local: '2026-11-20T09:00', ends_local: '2026-11-20T10:00' })
    const c = makeInterview({ id: 'c', starts_local: '2026-11-21T09:00', ends_local: '2026-11-21T10:00' })
    const g = groupByDay([a, b, c])
    expect(Object.keys(g)).toEqual(['2026-11-20', '2026-11-21'])
    expect(g['2026-11-20'].map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('formatRange shows the interview in its own zone with the offset', () => {
    expect(formatRange(makeInterview())).toBe('Fri, 20 Nov 2026, 10:00-11:00 (UTC+05:00)')
    expect(formatRange(makeInterview({ ends_local: '2026-11-21T01:00' }))).toContain('Sat 21 Nov 01:00')
  })

  it('zoneOptions always includes the zone in use, once', () => {
    const z = zoneOptions('Pacific/Auckland', 'UTC')
    expect(z).toContain('Pacific/Auckland')
    expect(z.filter((x) => x === 'UTC')).toHaveLength(1)
  })
})

describe('feedback helpers', () => {
  it('a draft may be empty, a submission needs an overall rating and overall feedback', () => {
    expect(validateFeedback(emptyFeedback, 'draft')).toEqual({})
    const e = validateFeedback(emptyFeedback, 'submit')
    expect(e.overall_rating).toBeTruthy()
    expect(e.overall_feedback).toBeTruthy()
    expect(validateFeedback({ ...emptyFeedback, overall_rating: 3, overall_feedback: 'ok' }, 'submit')).toEqual({})
    expect(validateFeedback({ ...emptyFeedback, overall_rating: 3, overall_feedback: '   ' }, 'submit').overall_feedback).toBeTruthy()
  })

  it('limits every text to 4000 characters', () => {
    expect(validateFeedback({ ...emptyFeedback, strengths: 'x'.repeat(4001) }, 'draft').strengths).toBeTruthy()
    expect(validateFeedback({ ...emptyFeedback, strengths: 'x'.repeat(4000) }, 'draft')).toEqual({})
  })

  it('cleanFeedback trims and turns blanks into null', () => {
    expect(cleanFeedback({ ...emptyFeedback, overall_feedback: '  hi  ', strengths: '   ', private_notes: '' })).toMatchObject({
      overall_feedback: 'hi', strengths: null, private_notes: null,
    })
  })
})
