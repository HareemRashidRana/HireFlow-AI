import type {
  ApplicationScreening,
  Assessment,
  AssessmentSummary,
  Criterion,
  JobScreening,
  JobScreeningItem,
  Methodology,
} from '../types/screening'

const staff = { id: 'user-recruiter', email: 'recruiter@example.com', role: 'recruiter' as const }

export function makeCriteria(): Criterion[] {
  return [
    {
      key: 'required_skills',
      label: 'Required skills',
      nominal_weight: 80,
      effective_weight: 80,
      status: 'assessed',
      reason_code: null,
      reason: null,
      listed: 1,
      total: 3,
      points: 26.7,
      evidence: [
        { requirement: 'JavaScript', status: 'listed', matched_text: 'JS', matched_via: 'alias' },
        { requirement: 'Docker', status: 'not listed', matched_text: null, matched_via: null },
        { requirement: 'Go', status: 'not listed', matched_text: null, matched_via: null },
      ],
    },
    {
      key: 'preferred_skills',
      label: 'Preferred skills',
      nominal_weight: 20,
      effective_weight: 20,
      status: 'assessed',
      reason_code: null,
      reason: null,
      listed: 1,
      total: 1,
      points: 20,
      evidence: [{ requirement: 'React', status: 'listed', matched_text: 'React', matched_via: 'exact' }],
    },
  ]
}

export function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'asm-1',
    application_id: 'app-1',
    assessment_number: 1,
    created_at: '2026-11-10T09:00:00Z',
    requested_by: staff,
    scoring_version: 'coverage-1.0',
    alias_table_version: 'aliases-1',
    weights: { required_skills: 80, preferred_skills: 20 },
    job_requirements: { required: ['JavaScript', 'Docker', 'Go'], preferred: ['React'] },
    status: 'scored',
    total_score: 46.7,
    assessed_weight: 100,
    criteria: makeCriteria(),
    experience: {
      dated_months: 103,
      dated_text: '8 years 7 months',
      positions_total: 2,
      positions_counted: 2,
      positions_not_counted: 0,
      approximate: false,
      notes: [],
      note: 'Dated experience is shown for context only. It is not a relevance assessment and is not part of Requirements Coverage. Positions without usable dates are not included in this figure.',
    },
    warnings: [],
    explanation: 'Requirements Coverage is based on 100 of 100 weight (both skill groups). It is advisory and does not assess the candidate.',
    limitations: [
      'A skill that is not listed may still be one the person has: resumes are incomplete.',
      'A listed skill does not show how well it is known or how recently it was used.',
    ],
    resume: { version_number: 1, reviewed_at: '2026-11-09T09:00:00Z', still_exists: true },
    freshness: { state: 'current', reasons: [], reason_texts: [] },
    scrubbed: false,
    scrub_reason: null,
    reviews: [],
    unlisted_requirements: ['Docker', 'Go'],
    created: true,
    ...overrides,
  }
}

export function makeSummary(overrides: Partial<AssessmentSummary> = {}): AssessmentSummary {
  return {
    id: 'asm-1',
    assessment_number: 1,
    created_at: '2026-11-10T09:00:00Z',
    scoring_version: 'coverage-1.0',
    status: 'scored',
    total_score: 46.7,
    assessed_weight: 100,
    freshness: 'current',
    scrubbed: false,
    review_count: 0,
    requested_by: staff,
    ...overrides,
  }
}

export function makeScreening(overrides: Partial<ApplicationScreening> = {}): ApplicationScreening {
  return {
    application_id: 'app-1',
    readiness: { can_assess: true, blocker: null, blocker_text: null },
    job_requirements: { required: ['JavaScript', 'Docker', 'Go'], preferred: ['React'] },
    items: [],
    total: 0,
    ...overrides,
  }
}

export function makeJobItem(overrides: Partial<JobScreeningItem> = {}): JobScreeningItem {
  return {
    application_id: 'app-1',
    candidate_id: 'cand-1',
    candidate_name: 'Sana Iqbal',
    stage: 'applied',
    applied_at: '2026-11-03T09:00:00Z',
    state: 'not_assessed',
    blocker: null,
    assessment_count: 0,
    last_assessed_at: null,
    ...overrides,
  }
}

export function makeJobScreening(items: JobScreeningItem[], overrides: Partial<JobScreening> = {}): JobScreening {
  return { job_id: 'job-1', items, total: items.length, page: 1, page_size: 10, ...overrides }
}

export const methodology: Methodology = {
  name: 'Requirements Coverage',
  scoring_version: 'coverage-1.0',
  alias_table_version: 'aliases-1',
  summary: 'Requirements Coverage shows how many of the skills a job lists are also listed in a human-reviewed resume. It is advisory information for a person to interpret, not an assessment of the candidate.',
  weights: { required_skills: 80, preferred_skills: 20 },
  how_it_works: ['Only resume details that a person has reviewed and confirmed are used.', 'Required skills carry 80% of the weight and preferred skills 20%.'],
  limitations: ['A skill that is not listed may still be one the person has: resumes are incomplete.'],
  experience_note: 'Dated experience is shown for context only.',
  not_used: ['name, contact details, location', 'education, institutions, certifications'],
}
