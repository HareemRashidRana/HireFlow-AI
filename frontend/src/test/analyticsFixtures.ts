import type { FilterOptions, JobPerformanceList, Overview, TrendPoint } from '../types/analytics'

const stages = ['applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']

export const points = (n = 7, over: (i: number) => Partial<TrendPoint> = () => ({})): TrendPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    bucket_start: `2026-03-${String(i + 1).padStart(2, '0')}`,
    applications: 0,
    interviews: 0,
    hires: 0,
    ...over(i),
  }))

export function makeOverview(over: Partial<Overview> = {}): Overview {
  return {
    period: {
      start: '2026-03-01', end: '2026-03-07', timezone: 'Asia/Karachi', granularity: 'day',
      job_id: null, department: null, generated_at: '2026-03-07T12:00:00Z',
    },
    kpis: {
      total_employees: 42, active_employees: 40, total_candidates: 120, open_jobs: 5, closed_jobs: 3,
      upcoming_interviews: 4, total_applications: 20, hires: 2, completed_interviews: 6,
    },
    funnel: stages.map((stage, i) => ({ stage, count: [8, 4, 2, 1, 1, 2, 1, 1][i] })),
    trends: points(7, (i) => ({ applications: i, interviews: i % 3, hires: i === 4 ? 2 : 0 })),
    interviews: { scheduled: 2, confirmed: 2, completed: 6, cancelled: 1, rescheduled: 1, by_type: { technical: 7, hr_round: 3 } },
    sources: [
      { source: 'referral', label: 'Referral', count: 9 },
      { source: 'linkedin', label: 'LinkedIn', count: 6 },
      { source: 'other', label: 'Other', count: 5 },
    ],
    time_to_hire: { average_days: 12.5, hires_measured: 2, hires_without_date: 0 },
    recent_activity: [
      { application_id: 'app-1', event: 'stage_changed', to_stage: 'screening', job_title: 'Backend Engineer', at: '2026-03-07T09:00:00Z' },
      { application_id: 'app-2', event: 'hired', to_stage: 'hired', job_title: 'Designer', at: '2026-03-06T09:00:00Z' },
    ],
    ...over,
  }
}

export const emptyOverview = (): Overview =>
  makeOverview({
    kpis: {
      total_employees: 0, active_employees: 0, total_candidates: 0, open_jobs: 0, closed_jobs: 0,
      upcoming_interviews: 0, total_applications: 0, hires: 0, completed_interviews: 0,
    },
    funnel: stages.map((stage) => ({ stage, count: 0 })),
    trends: points(7),
    interviews: { scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, rescheduled: 0, by_type: {} },
    sources: [],
    time_to_hire: { average_days: null, hires_measured: 0, hires_without_date: 0 },
    recent_activity: [],
  })

export const makeJobs = (over: Partial<JobPerformanceList> = {}): JobPerformanceList => ({
  items: [
    { job_id: 'job-1', title: 'Backend Engineer', department: 'Engineering', status: 'open', applications: 12, interviews: 5, hired: 2, rejected: 3, conversion_rate: 0.1667 },
    { job_id: 'job-2', title: 'Quiet Role', department: 'Sales', status: 'closed', applications: 0, interviews: 0, hired: 0, rejected: 0, conversion_rate: null },
  ],
  total: 2, page: 1, page_size: 8,
  ...over,
})

export const options: FilterOptions = {
  jobs: [
    { id: 'job-1', title: 'Backend Engineer', department: 'Engineering', status: 'open' },
    { id: 'job-2', title: 'Quiet Role', department: 'Sales', status: 'closed' },
  ],
  departments: ['Engineering', 'Sales'],
}
