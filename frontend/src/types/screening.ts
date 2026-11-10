// Mirrors backend/app/schemas/screening.py (Requirements Coverage).
// Nothing here ranks, recommends or labels a person, and no type carries a sort or filter.

import type { StaffSummary } from './application'

export type Freshness = 'current' | 'outdated' | 'scrubbed'
export type Judgement = 'agree' | 'disagree' | 'unsure'
export type AdjustmentReason = 'evidenced_elsewhere' | 'equivalent_skill' | 'resume_incomplete' | 'other'
export type Blocker = 'no_active_resume' | 'resume_not_reviewed' | 'candidate_anonymized'

export interface SkillEvidence {
  requirement: string
  status: 'listed' | 'not listed'
  matched_text: string | null
  matched_via: 'exact' | 'alias' | null
}

export interface Criterion {
  key: 'required_skills' | 'preferred_skills'
  label: string
  nominal_weight: number
  effective_weight: number | null
  status: 'assessed' | 'not_assessed'
  reason_code: string | null
  reason: string | null
  listed: number
  total: number
  points: number | null
  evidence: SkillEvidence[] | null // null once a privacy scrub removed it
}

export interface ExperienceContext {
  dated_months: number
  dated_text: string
  positions_total: number
  positions_counted: number
  positions_not_counted: number
  approximate: boolean
  notes: string[]
  note: string
}

export interface ScreeningReview {
  id: string
  judgement: Judgement
  adjustments: string[] | null
  adjustment_reason: AdjustmentReason | null
  adjusted_total: number | null
  note: string | null
  reviewer: StaffSummary | null
  created_at: string
  scrubbed: boolean
}

export interface Assessment {
  id: string
  application_id: string
  assessment_number: number
  created_at: string
  requested_by: StaffSummary | null
  scoring_version: string
  alias_table_version: string
  weights: Record<string, number>
  job_requirements: { required: string[]; preferred: string[] }
  status: 'scored' | 'unscored'
  total_score: number | null
  assessed_weight: number
  criteria: Criterion[]
  experience: ExperienceContext | null
  warnings: { code: string; text: string }[]
  explanation: string
  limitations: string[]
  resume: { version_number: number | null; reviewed_at: string | null; still_exists: boolean }
  freshness: { state: Freshness; reasons: string[]; reason_texts: string[] }
  scrubbed: boolean
  scrub_reason: string | null
  reviews: ScreeningReview[]
  unlisted_requirements: string[]
  created: boolean
}

export interface AssessmentSummary {
  id: string
  assessment_number: number
  created_at: string
  scoring_version: string
  status: 'scored' | 'unscored'
  total_score: number | null
  assessed_weight: number
  freshness: Freshness
  scrubbed: boolean
  review_count: number
  requested_by: StaffSummary | null
}

export interface ApplicationScreening {
  application_id: string
  readiness: { can_assess: boolean; blocker: Blocker | null; blocker_text: string | null }
  job_requirements: { required: string[]; preferred: string[] }
  items: AssessmentSummary[] // newest first
  total: number
}

export type JobScreeningState = 'not_assessed' | 'current' | 'outdated' | 'scrubbed' | 'cannot_assess'

export interface JobScreeningItem {
  application_id: string
  candidate_id: string
  candidate_name: string
  stage: string
  applied_at: string
  state: JobScreeningState
  blocker: Blocker | null
  assessment_count: number
  last_assessed_at: string | null
}

export interface JobScreening {
  job_id: string
  items: JobScreeningItem[] // always by application date
  total: number
  page: number
  page_size: number
}

export interface Methodology {
  name: string
  scoring_version: string
  alias_table_version: string
  summary: string
  weights: Record<string, number>
  how_it_works: string[]
  limitations: string[]
  experience_note: string
  not_used: string[]
}

export interface ReviewInput {
  judgement: Judgement
  adjustments: string[]
  adjustment_reason: AdjustmentReason | null
  note: string | null
}
