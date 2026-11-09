import { ApiError } from '../../../api/client'
import type {
  Employee,
  EmployeeCreate,
  EmployeeUpdate,
  EmploymentStatus,
  EmploymentType,
} from '../../../types/employee'

/** Form state: everything is a string so inputs stay controlled. */
export interface FormValues {
  employee_id: string
  first_name: string
  last_name: string
  work_email: string
  phone_number: string
  job_title: string
  department: string
  employment_type: EmploymentType | ''
  employment_status: EmploymentStatus
  date_of_joining: string
  manager_id: string
}

export type FieldErrors = Partial<Record<keyof FormValues, string>>

export const emptyValues: FormValues = {
  employee_id: '',
  first_name: '',
  last_name: '',
  work_email: '',
  phone_number: '',
  job_title: '',
  department: '',
  employment_type: '',
  employment_status: 'active',
  date_of_joining: '',
  manager_id: '',
}

export function toFormValues(e: Employee): FormValues {
  return {
    employee_id: e.employee_id,
    first_name: e.first_name,
    last_name: e.last_name,
    work_email: e.work_email,
    phone_number: e.phone_number ?? '',
    job_title: e.job_title,
    department: e.department,
    employment_type: e.employment_type,
    employment_status: e.employment_status,
    date_of_joining: e.date_of_joining,
    manager_id: e.manager_id ?? '',
  }
}

/** Trim and normalise the same way the backend does, so unchanged fields compare equal. */
function normalise(v: FormValues): FormValues {
  return {
    ...v,
    employee_id: v.employee_id.trim().toUpperCase(),
    first_name: v.first_name.trim(),
    last_name: v.last_name.trim(),
    work_email: v.work_email.trim().toLowerCase(),
    phone_number: v.phone_number.trim(),
    job_title: v.job_title.trim(),
    department: v.department.trim(),
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/

export function validate(values: FormValues): FieldErrors {
  const v = normalise(values)
  const errors: FieldErrors = {}
  if (!/^[A-Z0-9-]{3,20}$/.test(v.employee_id))
    errors.employee_id = 'Use 3–20 letters, numbers or hyphens (e.g. EMP-001).'
  if (!v.first_name) errors.first_name = 'First name is required.'
  if (!v.last_name) errors.last_name = 'Last name is required.'
  if (!EMAIL_RE.test(v.work_email)) errors.work_email = 'Enter a valid email address.'
  if (v.phone_number && !PHONE_RE.test(v.phone_number))
    errors.phone_number = 'Enter a valid phone number (digits, spaces, +, -, brackets).'
  if (!v.job_title) errors.job_title = 'Job title is required.'
  if (!v.department) errors.department = 'Department is required.'
  if (!v.employment_type) errors.employment_type = 'Choose an employment type.'
  if (!v.date_of_joining) errors.date_of_joining = 'Date of joining is required.'
  return errors
}

export function buildCreatePayload(values: FormValues): EmployeeCreate {
  const v = normalise(values)
  return {
    employee_id: v.employee_id,
    first_name: v.first_name,
    last_name: v.last_name,
    work_email: v.work_email,
    phone_number: v.phone_number || null,
    job_title: v.job_title,
    department: v.department,
    employment_type: v.employment_type as EmploymentType,
    employment_status: v.employment_status,
    date_of_joining: v.date_of_joining,
    manager_id: v.manager_id || null,
  }
}

/** Only the fields that differ from the saved employee (PATCH semantics). */
export function buildPatchPayload(values: FormValues, original: Employee): EmployeeUpdate {
  const next = buildCreatePayload(values)
  const prev = buildCreatePayload(toFormValues(original))
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof EmployeeCreate)[]) {
    if (next[key] !== prev[key]) patch[key] = next[key]
  }
  return patch as EmployeeUpdate
}

/**
 * Turns an ApiError into per-field messages plus an optional general message.
 * Rule-based errors arrive as plain text, so we match on keywords to find the input.
 */
export function mapApiError(error: unknown): { fields: FieldErrors; general: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, general: 'Something went wrong. Please try again.' }

  const fields: FieldErrors = {}
  const known = new Set(Object.keys(emptyValues))
  for (const [name, message] of Object.entries(error.fieldErrors)) {
    if (known.has(name)) fields[name as keyof FormValues] = message
  }
  if (Object.keys(fields).length > 0) return { fields, general: null }

  const text = error.message.toLowerCase()
  if (error.status === 409 && text.includes('employee id')) return { fields: { employee_id: error.message }, general: null }
  if (error.status === 409 && text.includes('email')) return { fields: { work_email: error.message }, general: null }
  if (error.status === 422 && text.includes('manager')) return { fields: { manager_id: error.message }, general: null }
  return { fields: {}, general: error.message }
}
