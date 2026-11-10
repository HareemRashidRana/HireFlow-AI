// Mirrors backend/app/schemas/interview.py. Nothing here scores, ranks or averages people, and
// candidate contact details are never part of an interview.

import type { UserRole } from './auth'

export type InterviewType = 'phone_screen' | 'technical' | 'behavioral' | 'hr_round' | 'panel' | 'final' | 'other'
export type InterviewMode = 'online' | 'in_person' | 'phone'
export type InterviewStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'rescheduled'
export type FeedbackState = 'none' | 'draft' | 'submitted'

export interface StaffRef {
  id: string
  email: string
  role: UserRole
}

export interface Interviewer extends StaffRef {
  feedback_status: FeedbackState
}

export interface Interview {
  id: string
  application: {
    id: string
    stage: string
    candidate: { id: string; first_name: string; last_name: string }
    job: { id: string; title: string }
  }
  title: string
  interview_type: InterviewType
  round_number: number
  mode: InterviewMode
  status: InterviewStatus
  starts_at: string
  ends_at: string
  timezone: string
  /** Wall-clock time in the interview's own zone, "YYYY-MM-DDTHH:MM". Display and edit with this. */
  starts_local: string
  ends_local: string
  utc_offset: string
  duration_minutes: number
  location: string | null
  meeting_url: string | null
  interviewers: Interviewer[]
  rescheduled_from_id: string | null
  rescheduled_to_id: string | null
  cancellation_reason: string | null
  cancelled_at: string | null
  completed_at: string | null
  created_by: StaffRef | null
  updated_by: StaffRef | null
  created_at: string
  updated_at: string
  scrubbed: boolean
  /** What THIS user may do next: the server decides, the UI never re-implements the rules. */
  allowed_actions: string[]
  my_feedback_status: FeedbackState | null
}

export interface InterviewList {
  items: Interview[]
  total: number
  page: number
  page_size: number
}

export interface InterviewParams {
  q?: string
  application_id?: string
  job_id?: string
  interviewer_id?: string
  status?: InterviewStatus | ''
  interview_type?: InterviewType | ''
  starts_from?: string
  starts_to?: string
  order?: 'asc' | 'desc'
  page?: number
  page_size?: number
}

export interface InterviewCreate {
  application_id: string
  title: string
  interview_type: InterviewType
  mode: InterviewMode
  starts_at: string
  ends_at: string
  timezone: string
  location: string | null
  meeting_url: string | null
  interviewer_ids: string[]
}

export interface InterviewUpdate {
  title?: string
  interview_type?: InterviewType
  mode?: InterviewMode
  location?: string | null
  meeting_url?: string | null
}

export interface RescheduleInput {
  starts_at: string
  ends_at: string
  timezone: string
  reason: string | null
  interviewer_ids?: string[]
}

export interface InterviewEvent {
  id: string
  event_type: string
  actor: StaffRef | null
  details: Record<string, unknown>
  created_at: string
}

export interface Feedback {
  id: string
  interview_id: string
  interviewer: StaffRef | null
  status: 'draft' | 'submitted'
  overall_rating: number | null
  technical_rating: number | null
  communication_rating: number | null
  problem_solving_rating: number | null
  overall_feedback: string | null
  technical_notes: string | null
  role_notes: string | null
  strengths: string | null
  concerns: string | null
  private_notes: string | null
  version: number
  submitted_at: string | null
  updated_at: string
  is_mine: boolean
  scrubbed: boolean
}

export interface FeedbackOverview {
  interview_id: string
  items: Feedback[]
  can_view_all: boolean
  submitted_count: number
  pending_interviewers: StaffRef[]
}

export interface FeedbackContent {
  overall_rating: number | null
  technical_rating: number | null
  communication_rating: number | null
  problem_solving_rating: number | null
  overall_feedback: string | null
  technical_notes: string | null
  role_notes: string | null
  strengths: string | null
  concerns: string | null
  private_notes: string | null
}

export interface Revision {
  version: number
  snapshot: Record<string, unknown>
  edit_reason: string | null
  edited_by: StaffRef | null
  created_at: string
}

export interface InterviewStats {
  total: number
  by_status: Record<InterviewStatus, number>
  upcoming: number
  next_7_days: number
  feedback_pending: number
  feedback_submitted: number
  upcoming_by_day: { date: string; count: number }[]
}

export interface RatingScale {
  scale: { value: number; label: string; description: string }[]
  areas: { key: string; label: string; required_to_submit: boolean }[]
}
