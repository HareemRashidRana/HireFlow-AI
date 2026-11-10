// Mirrors backend/app/schemas/resume.py. A ResumeRead is file metadata only: the server never
// sends the file's text, a storage key or a path in a list/detail response.

import type { StaffSummary } from './application'

export type ResumeStatus = 'pending' | 'processing' | 'parsed' | 'no_text' | 'failed' | 'removed'
export type Confidence = 'high' | 'medium' | 'low'

export interface Resume {
  id: string
  candidate_id: string
  application_id: string | null
  version_number: number
  original_filename: string
  extension: 'pdf' | 'docx'
  mime_type: string
  size_bytes: number
  status: ResumeStatus
  parse_error_code: string | null
  text_chars: number | null
  is_active: boolean
  created_at: string
  uploaded_by: StaffSummary | null
  parsed_at: string | null
  reviewed_at: string | null
  reviewed_by: StaffSummary | null
  file_removed_at: string | null
  reviewed: boolean
}

export interface ResumeList {
  items: Resume[]
  total: number
  page: number
  page_size: number
}

export interface ParsedField {
  value: string | null
  confidence: Confidence | null
}

export interface ParsedEducation {
  degree: string | null
  field: string | null
  institution: string | null
  start_year: number | null
  end_year: number | null
  confidence: Confidence | null
}

export interface ParsedExperience {
  title: string | null
  company: string | null
  start: string | null
  end: string | null
  current: boolean
  months: number | null
  date_precision: string | null
  confidence: Confidence | null
}

export interface ParsedResume {
  parser_version: number
  name: ParsedField
  email: ParsedField
  phone: ParsedField
  skills: { values: string[]; confidence: Confidence | null; source: string | null }
  education: ParsedEducation[]
  experience: ParsedExperience[]
  total_experience_months: number | null
  total_experience_confidence: Confidence | null
  sections_found: string[]
  warnings: string[]
}

export interface ReviewedEducation {
  institution: string | null
  degree: string | null
  field: string | null
  start_year: number | null
  end_year: number | null
}

export interface ReviewedExperience {
  title: string | null
  company: string | null
  start: string | null
  end: string | null
  current: boolean
}

export interface ReviewedResume {
  name: string | null
  email: string | null
  phone: string | null
  skills: string[]
  education: ReviewedEducation[]
  experience: ReviewedExperience[]
}

export interface ResumeParsed {
  resume: Resume
  parsed: ParsedResume | null
  reviewed: ReviewedResume | null
}
