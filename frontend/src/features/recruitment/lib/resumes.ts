import type {
  Confidence,
  ParsedResume,
  ResumeStatus,
  ReviewedEducation,
  ReviewedExperience,
  ReviewedResume,
} from '../../../types/resume'

/** Must match the server's default limit (RESUME_MAX_BYTES). The server re-checks everything. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024
export const ACCEPTED_EXTENSIONS = ['pdf', 'docx'] as const
export const ACCEPT_ATTRIBUTE = '.pdf,.docx'

/** Early, friendly feedback only: the server validates the file's real content. Null means "looks fine". */
export function validateResumeFile(file: { name: string; size: number }): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) return 'Only PDF and DOCX files can be uploaded.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > MAX_RESUME_BYTES) return `This file is too large. The limit is ${formatBytes(MAX_RESUME_BYTES)}.`
  return null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export const statusLabels: Record<ResumeStatus, string> = {
  pending: 'Waiting to be read',
  processing: 'Being read…',
  parsed: 'Read',
  no_text: 'No readable text',
  failed: 'Could not be read',
  removed: 'File removed',
}

/** Why a file could not be read, in words a recruiter can act on. Falls back to a generic line. */
export const parseErrorMessages: Record<string, string> = {
  ocr_unavailable: 'This looks like a scanned image, so there is no text to read. Scanned documents are not read automatically.',
  encrypted: 'This file is password-protected, so it could not be read.',
  corrupt: 'This file appears to be damaged and could not be opened.',
  file_missing: 'The stored file is missing.',
  parser_error: 'The text could not be read from this file.',
}

export function describeParseProblem(status: ResumeStatus, code: string | null): string | null {
  if (status !== 'failed' && status !== 'no_text') return null
  return (code && parseErrorMessages[code]) || parseErrorMessages[status === 'no_text' ? 'ocr_unavailable' : 'parser_error']
}

export const confidenceLabels: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence: please check',
}

export function formatMonths(months: number | null): string {
  if (months === null) return 'Not found'
  const y = Math.floor(months / 12)
  const m = months % 12
  const parts = [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : '']
  return parts.filter(Boolean).join(' ') || 'Less than a month'
}

// ---- review form <-> API ----------------------------------------------------------------------

export interface ReviewFormValues {
  name: string
  email: string
  phone: string
  skills: string[]
  education: { institution: string; degree: string; field: string; start_year: string; end_year: string }[]
  experience: { title: string; company: string; start: string; end: string; current: boolean }[]
}

const s = (v: string | null | undefined) => v ?? ''

/**
 * The form starts from what a person already confirmed, else from what the parser found. Nothing
 * is invented: a field the parser did not find stays empty.
 */
export function initialReviewValues(parsed: ParsedResume | null, reviewed: ReviewedResume | null): ReviewFormValues {
  if (reviewed)
    return {
      name: s(reviewed.name),
      email: s(reviewed.email),
      phone: s(reviewed.phone),
      skills: [...reviewed.skills],
      education: reviewed.education.map((e) => ({
        institution: s(e.institution),
        degree: s(e.degree),
        field: s(e.field),
        start_year: e.start_year?.toString() ?? '',
        end_year: e.end_year?.toString() ?? '',
      })),
      experience: reviewed.experience.map((e) => ({
        title: s(e.title),
        company: s(e.company),
        start: s(e.start),
        end: s(e.end),
        current: e.current,
      })),
    }
  return {
    name: s(parsed?.name.value),
    email: s(parsed?.email.value),
    phone: s(parsed?.phone.value),
    skills: [...(parsed?.skills.values ?? [])],
    education: (parsed?.education ?? []).map((e) => ({
      institution: s(e.institution),
      degree: s(e.degree),
      field: s(e.field),
      start_year: e.start_year?.toString() ?? '',
      end_year: e.end_year?.toString() ?? '',
    })),
    experience: (parsed?.experience ?? []).map((e) => ({
      title: s(e.title),
      company: s(e.company),
      start: s(e.start),
      end: s(e.end),
      current: e.current,
    })),
  }
}

export type ReviewErrors = Partial<Record<'email' | 'phone' | 'name', string>> & { rows?: Record<string, string> }

const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateReview(v: ReviewFormValues): ReviewErrors {
  const errors: ReviewErrors = {}
  if (v.name.trim().length > 100) errors.name = 'Keep the name under 100 characters.'
  if (v.email.trim() && !EMAIL.test(v.email.trim())) errors.email = 'Enter a valid email address, or leave it empty.'
  if (v.phone.trim().length > 30) errors.phone = 'Keep the phone number under 30 characters.'
  const rows: Record<string, string> = {}
  v.experience.forEach((e, i) => {
    for (const k of ['start', 'end'] as const) {
      if (e[k].trim() && !DATE.test(e[k].trim())) rows[`experience-${i}-${k}`] = 'Use YYYY or YYYY-MM.'
    }
  })
  v.education.forEach((e, i) => {
    for (const k of ['start_year', 'end_year'] as const) {
      const t = e[k].trim()
      if (t && !(/^\d{4}$/.test(t) && +t >= 1950 && +t <= 2100)) rows[`education-${i}-${k}`] = 'Use a year from 1950 to 2100.'
    }
  })
  if (Object.keys(rows).length) errors.rows = rows
  return errors
}

export function hasReviewErrors(e: ReviewErrors): boolean {
  return Boolean(e.name || e.email || e.phone || (e.rows && Object.keys(e.rows).length))
}

const orNull = (t: string) => t.trim() || null

export function toReviewPayload(v: ReviewFormValues): ReviewedResume {
  const education: ReviewedEducation[] = v.education.map((e) => ({
    institution: orNull(e.institution),
    degree: orNull(e.degree),
    field: orNull(e.field),
    start_year: e.start_year.trim() ? Number(e.start_year) : null,
    end_year: e.end_year.trim() ? Number(e.end_year) : null,
  }))
  const experience: ReviewedExperience[] = v.experience.map((e) => ({
    title: orNull(e.title),
    company: orNull(e.company),
    start: orNull(e.start),
    end: e.current ? null : orNull(e.end),
    current: e.current,
  }))
  const seen = new Set<string>()
  const skills = v.skills
    .map((k) => k.trim())
    .filter((k) => {
      const key = k.toLowerCase()
      if (!k || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { name: orNull(v.name), email: orNull(v.email), phone: orNull(v.phone), skills, education, experience }
}
