import { ApiError } from '../../../api/errors'
import type {
  Candidate,
  CandidateCreate,
  CandidateSource,
  CandidateUpdate,
  ConsentBasis,
} from '../../../types/candidate'
import { todayIso } from './retention'

/** Form state: everything is a string so inputs stay controlled. */
export interface CandidateFormValues {
  first_name: string
  last_name: string
  email: string
  phone: string
  location: string
  current_title: string
  current_company: string
  source: CandidateSource | ''
  consent_basis: ConsentBasis | ''
  consent_basis_note: string
  consent_date: string
}

export type CandidateFieldErrors = Partial<Record<keyof CandidateFormValues, string>>

/** Nothing about the legal basis is pre-selected: staff must choose it deliberately. */
export function emptyCandidateValues(today: string = todayIso()): CandidateFormValues {
  return {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    location: '',
    current_title: '',
    current_company: '',
    source: '',
    consent_basis: '',
    consent_basis_note: '',
    consent_date: today,
  }
}

export function toCandidateFormValues(c: Candidate): CandidateFormValues {
  return {
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone ?? '',
    location: c.location ?? '',
    current_title: c.current_title ?? '',
    current_company: c.current_company ?? '',
    source: c.source,
    consent_basis: c.consent_basis,
    consent_basis_note: c.consent_basis_note ?? '',
    consent_date: c.consent_date,
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/

/** Client-side checks that mirror the server's rules (the server stays the authority). */
export function validateCandidate(values: CandidateFormValues, today: string = todayIso()): CandidateFieldErrors {
  const e: CandidateFieldErrors = {}
  const first = values.first_name.trim()
  const last = values.last_name.trim()
  if (!first) e.first_name = 'First name is required.'
  else if (first.length > 100) e.first_name = 'At most 100 characters.'
  if (!last) e.last_name = 'Last name is required.'
  else if (last.length > 100) e.last_name = 'At most 100 characters.'

  if (!EMAIL_RE.test(values.email.trim())) e.email = 'Enter a valid email address.'

  const phone = values.phone.trim()
  if (phone && !PHONE_RE.test(phone)) e.phone = 'Enter a valid phone number (digits, spaces, +, -, brackets).'

  for (const key of ['location', 'current_title', 'current_company'] as const) {
    if (values[key].trim().length > 150) e[key] = 'At most 150 characters.'
  }

  if (!values.source) e.source = 'Choose where this candidate came from.'
  if (!values.consent_basis) e.consent_basis = 'Choose the basis for holding their details.'

  const note = values.consent_basis_note.trim()
  if (values.consent_basis === 'other') {
    if (!note) e.consent_basis_note = 'Explain the basis when you choose "Other".'
    else if (note.length > 200) e.consent_basis_note = 'At most 200 characters.'
  }

  if (!values.consent_date) e.consent_date = 'Enter the date the basis was established.'
  else if (values.consent_date > today) e.consent_date = 'The date cannot be in the future.'
  return e
}

const orNull = (text: string): string | null => text.trim() || null

export function buildCandidateCreatePayload(values: CandidateFormValues): CandidateCreate {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    email: values.email.trim().toLowerCase(),
    phone: orNull(values.phone),
    location: orNull(values.location),
    current_title: orNull(values.current_title),
    current_company: orNull(values.current_company),
    source: values.source as CandidateSource,
    consent_basis: values.consent_basis as ConsentBasis,
    // An explanation only belongs to "other"; never send a stale one for another basis.
    consent_basis_note: values.consent_basis === 'other' ? orNull(values.consent_basis_note) : null,
    consent_date: values.consent_date,
  }
}

/** Only the fields that differ from the saved candidate (PATCH semantics). */
export function buildCandidatePatchPayload(values: CandidateFormValues, original: Candidate): CandidateUpdate {
  const next = buildCandidateCreatePayload(values)
  const prev = buildCandidateCreatePayload(toCandidateFormValues(original))
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof CandidateCreate)[]) {
    if (next[key] !== prev[key]) patch[key] = next[key]
  }
  return patch as CandidateUpdate
}

const FIELD_NAMES = new Set(Object.keys(emptyCandidateValues('')))

export const DUPLICATE_EMAIL_MESSAGE = 'A candidate with this email already exists'

/** Turns an ApiError into per-field messages plus an optional general message. */
export function mapCandidateApiError(error: unknown): { fields: CandidateFieldErrors; general: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, general: 'Something went wrong. Please try again.' }

  const fields: CandidateFieldErrors = {}
  for (const [name, message] of Object.entries(error.fieldErrors)) {
    if (FIELD_NAMES.has(name) && !(name in fields)) fields[name as keyof CandidateFormValues] = message
  }
  if (Object.keys(fields).length > 0) return { fields, general: null }

  const text = error.message.toLowerCase()
  if (error.status === 409 && text.includes('email')) return { fields: { email: error.message }, general: null }
  if (error.status === 422 && (text.includes('basis') || text.includes('explain')))
    return { fields: { consent_basis_note: error.message }, general: null }
  return { fields: {}, general: error.message }
}
