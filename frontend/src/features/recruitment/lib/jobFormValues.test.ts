import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeJob } from '../../../test/fixtures'
import {
  buildJobCreatePayload,
  buildJobPatchPayload,
  emptyJobValues,
  mapJobApiError,
  toJobFormValues,
  validateJob,
} from './jobFormValues'
import type { JobFormValues } from './jobFormValues'

const valid: JobFormValues = {
  ...emptyJobValues,
  title: 'Backend Engineer',
  department: 'Engineering',
  location: 'Remote',
  employment_type: 'full_time',
}
const withValues = (over: Partial<JobFormValues>): JobFormValues => ({ ...valid, ...over })

describe('validateJob', () => {
  it('accepts the minimum valid form', () => {
    expect(validateJob(valid)).toEqual({})
  })

  it('accepts a fully filled form', () => {
    const full = withValues({
      description: 'Great role.',
      required_skills: ['Python'],
      min_experience_years: '5',
      salary_min: '100',
      salary_max: '200',
      salary_currency: 'USD',
      openings: '3',
    })
    expect(validateJob(full)).toEqual({})
  })

  it('requires title, department, location and type', () => {
    const errors = validateJob(emptyJobValues)
    expect(Object.keys(errors).sort()).toEqual(['department', 'employment_type', 'location', 'title'])
  })

  it.each([
    ['too short', 'ab'],
    ['blank', '   '],
    ['too long', 'x'.repeat(151)],
  ])('rejects a title that is %s', (_label, title) => {
    expect(validateJob(withValues({ title })).title).toBeDefined()
  })

  it('counts the trimmed title length', () => {
    expect(validateJob(withValues({ title: '  abc  ' })).title).toBeUndefined()
    expect(validateJob(withValues({ title: '  ab  ' })).title).toBeDefined()
  })

  it('limits department and location length', () => {
    expect(validateJob(withValues({ department: 'd'.repeat(101) })).department).toBeDefined()
    expect(validateJob(withValues({ location: 'l'.repeat(151) })).location).toBeDefined()
    expect(validateJob(withValues({ department: 'd'.repeat(100), location: 'l'.repeat(150) }))).toEqual({})
  })

  it.each(['0', '501', '-1', '1.5', 'abc', ''])('rejects openings "%s"', (openings) => {
    expect(validateJob(withValues({ openings })).openings).toBeDefined()
  })

  it.each(['1', '500', ' 7 '])('accepts openings "%s"', (openings) => {
    expect(validateJob(withValues({ openings })).openings).toBeUndefined()
  })

  it('validates optional experience only when provided', () => {
    expect(validateJob(withValues({ min_experience_years: '' })).min_experience_years).toBeUndefined()
    expect(validateJob(withValues({ min_experience_years: '0' })).min_experience_years).toBeUndefined()
    expect(validateJob(withValues({ min_experience_years: '50' })).min_experience_years).toBeUndefined()
    expect(validateJob(withValues({ min_experience_years: '51' })).min_experience_years).toBeDefined()
    expect(validateJob(withValues({ min_experience_years: '-1' })).min_experience_years).toBeDefined()
    expect(validateJob(withValues({ min_experience_years: '2.5' })).min_experience_years).toBeDefined()
  })

  it('caps the description at 10,000 characters', () => {
    expect(validateJob(withValues({ description: 'x'.repeat(10_000) })).description).toBeUndefined()
    expect(validateJob(withValues({ description: 'x'.repeat(10_001) })).description).toBeDefined()
  })

  describe('salary', () => {
    it('is optional', () => {
      expect(validateJob(valid)).toEqual({})
    })

    it('needs a currency when an amount is given', () => {
      expect(validateJob(withValues({ salary_min: '100' })).salary_currency).toMatch(/currency/i)
      expect(validateJob(withValues({ salary_max: '100' })).salary_currency).toMatch(/currency/i)
    })

    it('needs an amount when a currency is given', () => {
      expect(validateJob(withValues({ salary_currency: 'USD' })).salary_currency).toMatch(/amount/i)
    })

    it('rejects a minimum above the maximum', () => {
      expect(
        validateJob(withValues({ salary_min: '300', salary_max: '100', salary_currency: 'USD' })).salary_min,
      ).toMatch(/cannot be greater/)
    })

    it('accepts equal minimum and maximum', () => {
      expect(validateJob(withValues({ salary_min: '100', salary_max: '100', salary_currency: 'USD' }))).toEqual({})
    })

    it('rejects non-numeric, negative and absurd amounts', () => {
      expect(validateJob(withValues({ salary_min: 'abc', salary_currency: 'USD' })).salary_min).toBeDefined()
      expect(validateJob(withValues({ salary_min: '-5', salary_currency: 'USD' })).salary_min).toBeDefined()
      expect(validateJob(withValues({ salary_max: '1000000001', salary_currency: 'USD' })).salary_max).toBeDefined()
    })

    it('requires a 3-letter currency code', () => {
      expect(validateJob(withValues({ salary_min: '1', salary_currency: 'US' })).salary_currency).toBeDefined()
      expect(validateJob(withValues({ salary_min: '1', salary_currency: 'USDX' })).salary_currency).toBeDefined()
      expect(validateJob(withValues({ salary_min: '1', salary_currency: 'usd' }))).toEqual({})
    })
  })
})

describe('buildJobCreatePayload', () => {
  it('trims text, converts numbers and uses null for blanks', () => {
    const payload = buildJobCreatePayload(
      withValues({ title: '  Data Analyst ', department: ' Analytics ', location: ' Remote ', openings: ' 3 ' }),
    )
    expect(payload).toEqual({
      title: 'Data Analyst',
      department: 'Analytics',
      location: 'Remote',
      employment_type: 'full_time',
      description: '',
      required_skills: [],
      nice_to_have_skills: [],
      min_experience_years: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      openings: 3,
      hiring_manager_id: null,
    })
  })

  it('includes salary, skills and manager when provided; uppercases the currency', () => {
    const payload = buildJobCreatePayload(
      withValues({
        required_skills: ['Python'],
        nice_to_have_skills: ['React'],
        min_experience_years: '4',
        salary_min: '100',
        salary_max: '200',
        salary_currency: 'usd',
        hiring_manager_id: 'abc',
        description: '  Hello  ',
      }),
    )
    expect(payload).toMatchObject({
      required_skills: ['Python'],
      nice_to_have_skills: ['React'],
      min_experience_years: 4,
      salary_min: 100,
      salary_max: 200,
      salary_currency: 'USD',
      hiring_manager_id: 'abc',
      description: 'Hello',
    })
  })

  it('treats 0 as a real number, not as blank', () => {
    const payload = buildJobCreatePayload(withValues({ min_experience_years: '0', salary_min: '0', salary_currency: 'USD' }))
    expect(payload.min_experience_years).toBe(0)
    expect(payload.salary_min).toBe(0)
  })

  it('never sends a status (jobs are always created as drafts)', () => {
    expect(buildJobCreatePayload(valid)).not.toHaveProperty('status')
  })
})

describe('toJobFormValues / buildJobPatchPayload', () => {
  it('round-trips a saved job without changes', () => {
    const job = makeJob({ hiring_manager_id: 'mgr-1' })
    expect(buildJobPatchPayload(toJobFormValues(job), job)).toEqual({})
  })

  it('shows null numbers as empty strings', () => {
    const values = toJobFormValues(makeJob({ min_experience_years: null, salary_min: null, salary_max: null, salary_currency: null }))
    expect(values).toMatchObject({ min_experience_years: '', salary_min: '', salary_max: '', salary_currency: '' })
  })

  it('sends only the fields that changed', () => {
    const job = makeJob()
    const values = { ...toJobFormValues(job), title: 'New Title', openings: '5' }
    expect(buildJobPatchPayload(values, job)).toEqual({ title: 'New Title', openings: 5 })
  })

  it('detects skill list changes', () => {
    const job = makeJob({ required_skills: ['Python'] })
    const values = { ...toJobFormValues(job), required_skills: ['Python', 'Go'] }
    expect(buildJobPatchPayload(values, job)).toEqual({ required_skills: ['Python', 'Go'] })
  })

  it('does not report a change for whitespace-only edits', () => {
    const job = makeJob()
    const values = { ...toJobFormValues(job), title: `  ${job.title}  ` }
    expect(buildJobPatchPayload(values, job)).toEqual({})
  })

  it('sends nulls to clear the salary range and the manager', () => {
    const job = makeJob({ hiring_manager_id: 'mgr-1' })
    const values = {
      ...toJobFormValues(job),
      salary_min: '',
      salary_max: '',
      salary_currency: '',
      hiring_manager_id: '',
    }
    expect(buildJobPatchPayload(values, job)).toEqual({
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      hiring_manager_id: null,
    })
  })
})

describe('mapJobApiError', () => {
  it('maps field validation errors onto their inputs', () => {
    const error = new ApiError('Please correct the highlighted fields.', 422, { title: 'Too short', salary_min: 'Bad' })
    expect(mapJobApiError(error)).toEqual({ fields: { title: 'Too short', salary_min: 'Bad' }, general: null })
  })

  it('maps a skill-list location such as required_skills.3 to the list', () => {
    const error = new ApiError('x', 422, { 'required_skills.3': 'Each skill must be at most 50 characters' })
    expect(mapJobApiError(error).fields).toEqual({ required_skills: 'Each skill must be at most 50 characters' })
  })

  it('ignores unknown server fields instead of crashing', () => {
    const error = new ApiError('Please correct the highlighted fields.', 422, { mystery: 'huh' })
    expect(mapJobApiError(error)).toEqual({ fields: {}, general: 'Please correct the highlighted fields.' })
  })

  it.each([
    ['Hiring manager not found', 'hiring_manager_id'],
    ['The hiring manager must be an active employee', 'hiring_manager_id'],
    ['Minimum salary cannot be greater than maximum salary', 'salary_min'],
    ['Choose a currency for the salary range', 'salary_currency'],
    ['A published job needs a description', 'description'],
  ])('maps the 422 message "%s" to %s', (message, field) => {
    expect(mapJobApiError(new ApiError(message, 422)).fields).toEqual({ [field]: message })
  })

  it('shows other errors as a general message', () => {
    expect(mapJobApiError(new ApiError('Closed jobs cannot be edited. Reopen the job first.', 409))).toEqual({
      fields: {},
      general: 'Closed jobs cannot be edited. Reopen the job first.',
    })
  })

  it('handles non-API errors', () => {
    expect(mapJobApiError(new Error('boom')).general).toMatch(/something went wrong/i)
  })
})
