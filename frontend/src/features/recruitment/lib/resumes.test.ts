import { describe, expect, it } from 'vitest'
import { makeParsed } from '../../../test/fixtures'
import {
  MAX_RESUME_BYTES,
  describeParseProblem,
  formatBytes,
  formatMonths,
  hasReviewErrors,
  initialReviewValues,
  toReviewPayload,
  validateResumeFile,
  validateReview,
} from './resumes'
import type { ReviewFormValues } from './resumes'

describe('validateResumeFile', () => {
  it.each(['cv.pdf', 'CV.PDF', 'my.cv.docx', 'a b.DocX'])('accepts %s', (name) => {
    expect(validateResumeFile({ name, size: 1000 })).toBeNull()
  })

  it.each(['cv.exe', 'cv.doc', 'cv.pdf.exe', 'cv', 'cv.txt', '.pdf.zip', 'photo.png'])('refuses %s', (name) => {
    expect(validateResumeFile({ name, size: 1000 })).toMatch(/Only PDF and DOCX/)
  })

  it('refuses an empty file', () => {
    expect(validateResumeFile({ name: 'a.pdf', size: 0 })).toMatch(/empty/)
  })

  it('accepts exactly the limit and refuses one byte more', () => {
    expect(validateResumeFile({ name: 'a.pdf', size: MAX_RESUME_BYTES })).toBeNull()
    expect(validateResumeFile({ name: 'a.pdf', size: MAX_RESUME_BYTES + 1 })).toMatch(/too large.*5\.0 MB/)
  })
})

describe('formatting', () => {
  it.each([
    [0, '0 B'],
    [900, '900 B'],
    [1536, '1.5 KB'],
    [120_000, '117 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('formatBytes(%d) = %s', (n, text) => expect(formatBytes(n)).toBe(text))

  it.each([
    [null, 'Not found'],
    [0, 'Less than a month'],
    [1, '1 month'],
    [12, '1 year'],
    [70, '5 years 10 months'],
    [25, '2 years 1 month'],
  ])('formatMonths(%s) = %s', (n, text) => expect(formatMonths(n)).toBe(text))
})

describe('describeParseProblem', () => {
  it('says nothing when the file was read', () => {
    expect(describeParseProblem('parsed', null)).toBeNull()
    expect(describeParseProblem('pending', null)).toBeNull()
  })

  it('explains each known reason in plain words', () => {
    expect(describeParseProblem('no_text', 'ocr_unavailable')).toMatch(/scanned image/)
    expect(describeParseProblem('failed', 'encrypted')).toMatch(/password/)
    expect(describeParseProblem('failed', 'corrupt')).toMatch(/damaged/)
  })

  it('falls back to a safe sentence for an unknown code, never echoing it', () => {
    const text = describeParseProblem('failed', '<script>alert(1)</script>')
    expect(text).toMatch(/could not be read/)
    expect(text).not.toContain('script')
  })
})

describe('review form values', () => {
  it('starts from what the parser found and invents nothing', () => {
    const v = initialReviewValues(makeParsed({ phone: { value: null, confidence: null } }), null)
    expect(v.name).toBe('Sana Iqbal')
    expect(v.phone).toBe('')
    expect(v.skills).toEqual(['Python', 'SQL'])
    expect(v.experience[0]).toMatchObject({ title: 'Backend Developer', start: '2020-01', end: '', current: true })
    expect(v.education[0]).toMatchObject({ institution: 'LUMS', start_year: '2014' })
  })

  it('prefers what a person already confirmed over the machine reading', () => {
    const v = initialReviewValues(makeParsed(), {
      name: 'S. Iqbal', email: null, phone: null, skills: ['Go'], education: [], experience: [],
    })
    expect(v).toMatchObject({ name: 'S. Iqbal', email: '', skills: ['Go'], education: [], experience: [] })
  })

  it('copes with nothing being parsed at all', () => {
    expect(initialReviewValues(null, null)).toEqual({ name: '', email: '', phone: '', skills: [], education: [], experience: [] })
  })
})

const base = (): ReviewFormValues => ({ name: 'A', email: '', phone: '', skills: [], education: [], experience: [] })

describe('validateReview', () => {
  it('accepts an empty-but-valid form', () => {
    expect(hasReviewErrors(validateReview(base()))).toBe(false)
  })

  it('checks the email, but allows leaving it empty', () => {
    expect(validateReview({ ...base(), email: 'nope' }).email).toBeTruthy()
    expect(validateReview({ ...base(), email: ' a@b.co ' }).email).toBeUndefined()
  })

  it.each(['2020', '2020-01', '1999-12'])('accepts the date %s', (d) => {
    const v = { ...base(), experience: [{ title: '', company: '', start: d, end: '', current: false }] }
    expect(hasReviewErrors(validateReview(v))).toBe(false)
  })

  it.each(['20', '2020-13', '2020-00', 'Jan 2020', '2020-1', '2020-01-01'])('refuses the date %s', (d) => {
    const v = { ...base(), experience: [{ title: '', company: '', start: d, end: '', current: false }] }
    expect(validateReview(v).rows?.['experience-0-start']).toBeTruthy()
  })

  it.each(['1949', '2101', 'abcd', '20'])('refuses the year %s', (y) => {
    const v = { ...base(), education: [{ institution: '', degree: '', field: '', start_year: '', end_year: y }] }
    expect(validateReview(v).rows?.['education-0-end_year']).toBeTruthy()
  })

  it('limits name and phone length like the server', () => {
    expect(validateReview({ ...base(), name: 'x'.repeat(101) }).name).toBeTruthy()
    expect(validateReview({ ...base(), phone: '1'.repeat(31) }).phone).toBeTruthy()
  })
})

describe('toReviewPayload', () => {
  it('turns blanks into null, years into numbers and trims', () => {
    const payload = toReviewPayload({
      name: '  Sana  ', email: '', phone: ' ', skills: [' Python ', 'python', '', 'SQL'],
      education: [{ institution: ' LUMS ', degree: '', field: '', start_year: '2014', end_year: '' }],
      experience: [{ title: ' Dev ', company: '', start: '2020-01', end: '', current: false }],
    })
    expect(payload).toEqual({
      name: 'Sana', email: null, phone: null, skills: ['Python', 'SQL'],
      education: [{ institution: 'LUMS', degree: null, field: null, start_year: 2014, end_year: null }],
      experience: [{ title: 'Dev', company: null, start: '2020-01', end: null, current: false }],
    })
  })

  it('drops an end date for a current position', () => {
    const payload = toReviewPayload({ ...base(), experience: [{ title: 'x', company: '', start: '2020', end: '2021', current: true }] })
    expect(payload.experience[0]).toMatchObject({ end: null, current: true })
  })
})
