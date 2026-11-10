// Mirrors backend/app/schemas/analytics.py. Aggregates only: no names, emails or notes.

export type Granularity = 'day' | 'week' | 'month'

export interface Period {
  start: string
  end: string
  timezone: string
  granularity: Granularity
  job_id: string | null
  department: string | null
  generated_at: string
}

export interface Kpis {
  total_employees: number
  active_employees: number
  total_candidates: number
  open_jobs: number
  closed_jobs: number
  upcoming_interviews: number
  total_applications: number
  hires: number
  completed_interviews: number
}

export interface FunnelStage {
  stage: string
  count: number
}

export interface TrendPoint {
  bucket_start: string
  applications: number
  interviews: number
  hires: number
}

export interface InterviewBreakdown {
  scheduled: number
  confirmed: number
  completed: number
  cancelled: number
  rescheduled: number
  by_type: Record<string, number>
}

export interface SourceCount {
  source: string
  label: string
  count: number
}

export interface TimeToHire {
  average_days: number | null
  hires_measured: number
  hires_without_date: number
}

export interface Activity {
  application_id: string
  event: string
  to_stage: string | null
  job_title: string
  at: string
}

export interface Overview {
  period: Period
  kpis: Kpis
  funnel: FunnelStage[]
  trends: TrendPoint[]
  interviews: InterviewBreakdown
  sources: SourceCount[]
  time_to_hire: TimeToHire
  recent_activity: Activity[]
}

export interface JobPerformance {
  job_id: string
  title: string
  department: string
  status: string
  applications: number
  interviews: number
  hired: number
  rejected: number
  conversion_rate: number | null
}

export interface JobPerformanceList {
  items: JobPerformance[]
  total: number
  page: number
  page_size: number
}

export interface JobOption {
  id: string
  title: string
  department: string
  status: string
}

export interface FilterOptions {
  jobs: JobOption[]
  departments: string[]
}

/** What the dashboard asks for. Empty values are left out of the request. */
export interface AnalyticsParams {
  start?: string
  end?: string
  timezone?: string
  job_id?: string
  department?: string
}
