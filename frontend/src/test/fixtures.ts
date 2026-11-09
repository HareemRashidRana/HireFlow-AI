import type { AuthUser, UserRole } from '../types/auth'
import type { Job, JobList, JobStatus } from '../types/job'

export function makeUser(role: UserRole = 'recruiter', overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    role,
    is_active: true,
    must_change_password: false,
    employee_id: null,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    title: 'Senior Backend Engineer',
    department: 'Engineering',
    location: 'Lahore, Pakistan',
    employment_type: 'full_time',
    description: 'Build and maintain our HR platform.',
    required_skills: ['Python', 'SQL'],
    nice_to_have_skills: ['React'],
    min_experience_years: 3,
    salary_min: 200000,
    salary_max: 350000,
    salary_currency: 'PKR',
    openings: 2,
    status: 'draft',
    hiring_manager_id: null,
    hiring_manager: null,
    opened_at: null,
    closed_at: null,
    created_at: '2026-11-01T09:00:00Z',
    updated_at: '2026-11-02T09:00:00Z',
    ...overrides,
  }
}

export function makeJobList(
  items: Job[],
  overrides: Partial<JobList> = {},
): JobList {
  const counts: Record<JobStatus, number> = { draft: 0, open: 0, on_hold: 0, closed: 0 }
  for (const job of items) counts[job.status]++
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 10,
    status_counts: counts,
    ...overrides,
  }
}
