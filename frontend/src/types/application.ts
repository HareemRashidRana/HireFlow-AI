// Mirrors backend/app/schemas/application.py.
// An application connects ONE candidate to ONE job. It is never deleted: it is hiring history.

import type { UserRole } from './auth'
import type { CandidateSource } from './candidate'
import type { EmploymentType } from './employee'
import type { JobStatus } from './job'

export type ApplicationStage =
  | 'applied'
  | 'screening'
  | 'shortlisted'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn'

export type ApplicationEventType =
  | 'created'
  | 'stage_changed'
  | 'assigned'
  | 'rejected'
  | 'withdrawn'
  | 'hired'
  | 'reopened'
  | 'notes_updated'

/** A staff login, by email only. Never includes anything secret. */
export interface StaffSummary {
  id: string
  email: string
  role: UserRole
}

export interface CandidateSummary {
  id: string
  first_name: string
  last_name: string
  email: string
}

export interface CandidateDetailSummary extends CandidateSummary {
  phone: string | null
  location: string | null
  current_title: string | null
  current_company: string | null
  retain_until: string
}

export interface JobSummary {
  id: string
  title: string
  department: string
  status: JobStatus
}

export interface JobDetailSummary extends JobSummary {
  location: string
  employment_type: EmploymentType
}

export interface ApplicationEvent {
  id: string
  event_type: ApplicationEventType
  from_value: string | null
  to_value: string | null
  note: string | null
  actor: StaffSummary | null
  created_at: string
}

interface ApplicationBase {
  id: string
  stage: ApplicationStage
  source: CandidateSource
  assigned_recruiter: StaffSummary | null
  applied_at: string
  stage_changed_at: string
  /** What the signed-in user may do next. Computed by the server: the UI never re-derives it. */
  allowed_stages: ApplicationStage[]
  can_reopen: boolean
}

export interface ApplicationListItem extends ApplicationBase {
  candidate: CandidateSummary
  job: JobSummary
}

export interface Application extends ApplicationBase {
  candidate: CandidateDetailSummary
  job: JobDetailSummary
  internal_notes: string | null
  created_at: string
  updated_at: string
  events: ApplicationEvent[]
}

export interface ApplicationList {
  items: ApplicationListItem[]
  total: number
  page: number
  page_size: number
  stage_counts: Record<ApplicationStage, number>
}

export interface BoardColumn {
  total: number
  items: ApplicationListItem[]
}

export interface Board {
  columns: Record<ApplicationStage, BoardColumn>
  per_column_limit: number
}

export interface ApplicationSummary {
  total: number
  by_stage: Record<ApplicationStage, number>
  hired: number
  open_jobs_with_applications: number
  recent: {
    id: string
    candidate_name: string
    job_title: string
    stage: ApplicationStage
    applied_at: string
  }[]
}

export interface ApplicationCreate {
  candidate_id: string
  job_id: string
  source?: CandidateSource
  internal_notes?: string | null
}

/** PATCH body: assignment and notes only. The stage has its own endpoint. */
export interface ApplicationUpdate {
  assigned_recruiter_id?: string | null
  internal_notes?: string | null
}

export interface ApplicationListParams {
  q?: string
  job_id?: string
  candidate_id?: string
  stage?: ApplicationStage | ''
  recruiter_id?: string
  source?: CandidateSource | ''
  applied_from?: string
  applied_to?: string
  page?: number
  page_size?: number
}

export interface BoardParams {
  q?: string
  job_id?: string
  recruiter_id?: string
  source?: CandidateSource | ''
}
