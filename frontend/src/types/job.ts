// Mirrors backend/app/schemas/job.py.

import type { EmploymentType } from './employee'

export type JobStatus = 'draft' | 'open' | 'on_hold' | 'closed'

export interface HiringManagerRef {
  id: string
  first_name: string
  last_name: string
  job_title: string
}

export interface Job {
  id: string
  title: string
  department: string
  location: string
  employment_type: EmploymentType
  description: string
  required_skills: string[]
  nice_to_have_skills: string[]
  min_experience_years: number | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  openings: number
  status: JobStatus
  hiring_manager_id: string | null
  hiring_manager: HiringManagerRef | null
  opened_at: string | null // first time the job was published
  closed_at: string | null
  created_at: string
  updated_at: string
}

/** New jobs are always created as drafts: status is changed through its own endpoint. */
export interface JobCreate {
  title: string
  department: string
  location: string
  employment_type: EmploymentType
  description?: string
  required_skills?: string[]
  nice_to_have_skills?: string[]
  min_experience_years?: number | null
  salary_min?: number | null
  salary_max?: number | null
  salary_currency?: string | null
  openings?: number
  hiring_manager_id?: string | null
}

/** PATCH body: only the fields that changed. `null` clears the optional ones. */
export type JobUpdate = Partial<JobCreate>

export interface JobList {
  items: Job[]
  total: number
  page: number
  page_size: number
  /** Jobs per status under the current filters, ignoring the status filter itself. */
  status_counts: Record<JobStatus, number>
}

export interface JobListParams {
  q?: string
  status?: JobStatus | ''
  department?: string
  employment_type?: EmploymentType | ''
  hiring_manager_id?: string
  page?: number
  page_size?: number
}
