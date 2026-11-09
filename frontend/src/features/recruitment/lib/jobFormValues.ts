import { ApiError } from '../../../api/errors'
import type { EmploymentType } from '../../../types/employee'
import type { Job, JobCreate, JobUpdate } from '../../../types/job'

/** Form state: numbers are strings so inputs stay controlled; skills are already lists. */
export interface JobFormValues {
  title: string
  department: string
  location: string
  employment_type: EmploymentType | ''
  openings: string
  description: string
  required_skills: string[]
  nice_to_have_skills: string[]
  min_experience_years: string
  salary_min: string
  salary_max: string
  salary_currency: string
  hiring_manager_id: string
}

export type JobFieldErrors = Partial<Record<keyof JobFormValues, string>>

export const emptyJobValues: JobFormValues = {
  title: '',
  department: '',
  location: '',
  employment_type: '',
  openings: '1',
  description: '',
  required_skills: [],
  nice_to_have_skills: [],
  min_experience_years: '',
  salary_min: '',
  salary_max: '',
  salary_currency: '',
  hiring_manager_id: '',
}

export function toJobFormValues(job: Job): JobFormValues {
  return {
    title: job.title,
    department: job.department,
    location: job.location,
    employment_type: job.employment_type,
    openings: String(job.openings),
    description: job.description,
    required_skills: job.required_skills,
    nice_to_have_skills: job.nice_to_have_skills,
    min_experience_years: job.min_experience_years === null ? '' : String(job.min_experience_years),
    salary_min: job.salary_min === null ? '' : String(job.salary_min),
    salary_max: job.salary_max === null ? '' : String(job.salary_max),
    salary_currency: job.salary_currency ?? '',
    hiring_manager_id: job.hiring_manager_id ?? '',
  }
}

const isWholeNumber = (text: string) => /^\d+$/.test(text.trim())
const MAX_MONEY = 1_000_000_000

/** Client-side checks that mirror the server's rules (the server stays the authority). */
export function validateJob(values: JobFormValues): JobFieldErrors {
  const e: JobFieldErrors = {}
  const title = values.title.trim()
  if (title.length < 3) e.title = 'Enter a job title (at least 3 characters).'
  else if (title.length > 150) e.title = 'The title can be at most 150 characters.'

  const department = values.department.trim()
  if (!department) e.department = 'Department is required.'
  else if (department.length > 100) e.department = 'At most 100 characters.'

  const location = values.location.trim()
  if (!location) e.location = 'Location is required.'
  else if (location.length > 150) e.location = 'At most 150 characters.'

  if (!values.employment_type) e.employment_type = 'Choose an employment type.'

  const openings = values.openings.trim()
  if (!isWholeNumber(openings) || Number(openings) < 1 || Number(openings) > 500)
    e.openings = 'Enter a whole number from 1 to 500.'

  if (values.description.trim().length > 10_000) e.description = 'The description can be at most 10,000 characters.'

  const experience = values.min_experience_years.trim()
  if (experience && (!isWholeNumber(experience) || Number(experience) > 50))
    e.min_experience_years = 'Enter a whole number from 0 to 50.'

  const low = values.salary_min.trim()
  const high = values.salary_max.trim()
  const currency = values.salary_currency.trim()
  if (low && (!isWholeNumber(low) || Number(low) > MAX_MONEY)) e.salary_min = 'Enter a valid amount.'
  if (high && (!isWholeNumber(high) || Number(high) > MAX_MONEY)) e.salary_max = 'Enter a valid amount.'
  if (!e.salary_min && !e.salary_max) {
    if (low && high && Number(low) > Number(high)) e.salary_min = 'Minimum cannot be greater than maximum.'
    else if ((low || high) && !currency) e.salary_currency = 'Choose a currency.'
    else if (!low && !high && currency) e.salary_currency = 'Enter a salary amount or clear the currency.'
  }
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) e.salary_currency = 'Use a 3-letter code, e.g. PKR.'
  return e
}

const num = (text: string): number | null => (text.trim() === '' ? null : Number(text.trim()))

export function buildJobCreatePayload(values: JobFormValues): Required<JobCreate> {
  return {
    title: values.title.trim(),
    department: values.department.trim(),
    location: values.location.trim(),
    employment_type: values.employment_type as EmploymentType,
    description: values.description.trim(),
    required_skills: values.required_skills,
    nice_to_have_skills: values.nice_to_have_skills,
    min_experience_years: num(values.min_experience_years),
    salary_min: num(values.salary_min),
    salary_max: num(values.salary_max),
    salary_currency: values.salary_currency.trim().toUpperCase() || null,
    openings: Number(values.openings.trim()),
    hiring_manager_id: values.hiring_manager_id || null,
  }
}

/** Only the fields that differ from the saved job (PATCH semantics). */
export function buildJobPatchPayload(values: JobFormValues, original: Job): JobUpdate {
  const next = buildJobCreatePayload(values)
  const prev = buildJobCreatePayload(toJobFormValues(original))
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(prev[key])) patch[key] = next[key]
  }
  return patch as JobUpdate
}

const FIELD_NAMES = new Set(Object.keys(emptyJobValues))

/**
 * Turns an ApiError into per-field messages plus an optional general message. Rule-based errors
 * arrive as plain text, so we match keywords to find the input they belong to.
 */
export function mapJobApiError(error: unknown): { fields: JobFieldErrors; general: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, general: 'Something went wrong. Please try again.' }

  const fields: JobFieldErrors = {}
  for (const [name, message] of Object.entries(error.fieldErrors)) {
    // Skill errors arrive as "required_skills.3"-style locations: attach them to the list.
    const base = name.split('.')[0]
    if (FIELD_NAMES.has(base) && !(base in fields)) fields[base as keyof JobFormValues] = message
  }
  if (Object.keys(fields).length > 0) return { fields, general: null }

  const text = error.message.toLowerCase()
  if (error.status === 422) {
    if (text.includes('hiring manager')) return { fields: { hiring_manager_id: error.message }, general: null }
    if (text.includes('minimum salary')) return { fields: { salary_min: error.message }, general: null }
    if (text.includes('currency')) return { fields: { salary_currency: error.message }, general: null }
    if (text.includes('description')) return { fields: { description: error.message }, general: null }
  }
  return { fields: {}, general: error.message }
}
