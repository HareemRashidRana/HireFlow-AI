import type { Candidate, CandidateList, CandidateListItem } from '../types/candidate'
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

// ---------- candidates ----------


/** "YYYY-MM-DD" for today plus/minus n days, in local time (matches how the UI reads dates). */
export function isoDaysFromToday(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'cand-1',
    first_name: 'Sana',
    last_name: 'Iqbal',
    email: 'sana.iqbal@example.com',
    phone: '+92 300 1234567',
    location: 'Lahore, Pakistan',
    current_title: 'Backend Developer',
    current_company: 'Acme Ltd',
    source: 'linkedin',
    consent_basis: 'legitimate_interest',
    consent_basis_note: null,
    consent_date: '2026-10-01',
    last_activity_at: '2026-11-01T09:00:00Z',
    retain_until: isoDaysFromToday(200),
    anonymized_at: null,
    created_at: '2026-11-01T09:00:00Z',
    updated_at: '2026-11-02T09:00:00Z',
    ...overrides,
  }
}

export function makeCandidateItem(overrides: Partial<CandidateListItem> = {}): CandidateListItem {
  return {
    id: 'cand-1',
    first_name: 'Sana',
    last_name: 'Iqbal',
    email: 'sana.iqbal@example.com',
    location: 'Lahore, Pakistan',
    current_title: 'Backend Developer',
    current_company: 'Acme Ltd',
    source: 'linkedin',
    last_activity_at: '2026-11-01T09:00:00Z',
    retain_until: isoDaysFromToday(200),
    created_at: '2026-11-01T09:00:00Z',
    ...overrides,
  }
}

export function makeCandidateList(
  items: CandidateListItem[],
  overrides: Partial<CandidateList> = {},
): CandidateList {
  return { items, total: items.length, page: 1, page_size: 10, ...overrides }
}
