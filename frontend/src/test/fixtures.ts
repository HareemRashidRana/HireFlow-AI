import type {
  Application,
  ApplicationList,
  ApplicationListItem,
  ApplicationStage,
  Board,
  StaffSummary,
} from '../types/application'
import type { Candidate, CandidateList, CandidateListItem } from '../types/candidate'
import type { AuthUser, UserRole } from '../types/auth'
import type { Job, JobList, JobStatus } from '../types/job'
import type { ParsedResume, Resume } from '../types/resume'

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

// ---------- applications ----------

export function makeStaff(overrides: Partial<StaffSummary> = {}): StaffSummary {
  return { id: 'staff-1', email: 'rana@example.com', role: 'recruiter', ...overrides }
}

export function makeApplicationItem(overrides: Partial<ApplicationListItem> = {}): ApplicationListItem {
  return {
    id: 'app-1',
    stage: 'applied',
    source: 'linkedin',
    assigned_recruiter: null,
    applied_at: '2026-11-03T09:00:00Z',
    stage_changed_at: '2026-11-03T09:00:00Z',
    allowed_stages: ['screening', 'rejected', 'withdrawn'],
    can_reopen: false,
    candidate: {
      id: 'cand-1',
      first_name: 'Sana',
      last_name: 'Iqbal',
      email: 'sana.iqbal@example.com',
      current_title: 'Backend Developer',
    },
    job: { id: 'job-1', title: 'Senior Backend Engineer', department: 'Engineering', status: 'open' },
    ...overrides,
  }
}

export function makeApplicationList(
  items: ApplicationListItem[],
  overrides: Partial<ApplicationList> = {},
): ApplicationList {
  const counts = emptyStageCounts()
  for (const a of items) counts[a.stage]++
  return { items, total: items.length, page: 1, page_size: 10, stage_counts: counts, ...overrides }
}

export function emptyStageCounts(): Record<ApplicationStage, number> {
  return { applied: 0, screening: 0, shortlisted: 0, interview: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 }
}

export function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    ...makeApplicationItem(),
    candidate: {
      id: 'cand-1',
      first_name: 'Sana',
      last_name: 'Iqbal',
      email: 'sana.iqbal@example.com',
      phone: '+92 300 1234567',
      location: 'Lahore, Pakistan',
      current_title: 'Backend Developer',
      current_company: 'Acme Ltd',
      retain_until: isoDaysFromToday(200),
    },
    job: {
      id: 'job-1',
      title: 'Senior Backend Engineer',
      department: 'Engineering',
      status: 'open',
      location: 'Lahore, Pakistan',
      employment_type: 'full_time',
    },
    internal_notes: null,
    created_at: '2026-11-03T09:00:00Z',
    updated_at: '2026-11-03T09:00:00Z',
    events: [
      {
        id: 'ev-1',
        event_type: 'created',
        from_value: null,
        to_value: 'applied',
        note: null,
        actor: makeStaff({ id: 'user-admin', email: 'admin@example.com', role: 'admin' }),
        created_at: '2026-11-03T09:00:00Z',
      },
    ],
    ...overrides,
  }
}

export function makeBoard(items: ApplicationListItem[], perColumnLimit = 25): Board {
  const columns = {} as Board['columns']
  for (const stage of Object.keys(emptyStageCounts()) as ApplicationStage[]) {
    const inStage = items.filter((a) => a.stage === stage)
    columns[stage] = {
      total: inStage.length,
      items: inStage,
      page: 1,
      page_size: perColumnLimit,
      has_more: false,
    }
  }
  return { columns, per_column_limit: perColumnLimit }
}

// ---------- resumes ----------

export function makeResume(overrides: Partial<Resume> = {}): Resume {
  return {
    id: 'res-1',
    candidate_id: 'cand-1',
    application_id: null,
    version_number: 1,
    original_filename: 'sana-iqbal-cv.pdf',
    extension: 'pdf',
    mime_type: 'application/pdf',
    size_bytes: 120_000,
    status: 'parsed',
    parse_error_code: null,
    text_chars: 2400,
    is_active: true,
    created_at: '2026-11-05T09:00:00Z',
    uploaded_by: { id: 'user-recruiter', email: 'recruiter@example.com', role: 'recruiter' },
    parsed_at: '2026-11-05T09:00:01Z',
    reviewed_at: null,
    reviewed_by: null,
    file_removed_at: null,
    reviewed: false,
    ...overrides,
  }
}

export function makeParsed(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    parser_version: 1,
    name: { value: 'Sana Iqbal', confidence: 'high' },
    email: { value: 'sana.iqbal@example.com', confidence: 'high' },
    phone: { value: '+92 300 1234567', confidence: 'medium' },
    skills: { values: ['Python', 'SQL'], confidence: 'medium', source: 'skills_section' },
    education: [{ degree: 'BSc', field: 'Computer Science', institution: 'LUMS', start_year: 2014, end_year: 2018, confidence: 'medium' }],
    experience: [{ title: 'Backend Developer', company: 'Acme Ltd', start: '2020-01', end: null, current: true, months: 70, date_precision: 'month', confidence: 'high' }],
    total_experience_months: 70,
    total_experience_confidence: 'medium',
    sections_found: ['skills', 'education', 'experience'],
    warnings: [],
    ...overrides,
  }
}
