// Mirrors backend/app/schemas/candidate.py.
// Candidates are NOT employees: they have no link to the employees table.

export type CandidateSource = 'referral' | 'linkedin' | 'job_board' | 'agency' | 'direct' | 'other'
export type ConsentBasis = 'consent' | 'legitimate_interest' | 'pre_contract_steps' | 'other'
export type RetentionFilter = 'expiring' | 'expired'

export interface Candidate {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  location: string | null
  current_title: string | null
  current_company: string | null
  source: CandidateSource
  consent_basis: ConsentBasis
  consent_basis_note: string | null // required by the server when the basis is "other"
  consent_date: string // ISO date
  last_activity_at: string // ISO datetime
  retain_until: string // ISO date
  anonymized_at: string | null
  created_at: string
  updated_at: string
}

/** A lean directory row: no phone and no consent details. */
export interface CandidateListItem {
  id: string
  first_name: string
  last_name: string
  email: string
  location: string | null
  current_title: string | null
  current_company: string | null
  source: CandidateSource
  last_activity_at: string
  retain_until: string
  created_at: string
}

export interface CandidateList {
  items: CandidateListItem[]
  total: number
  page: number
  page_size: number
}

export interface CandidateCreate {
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  location?: string | null
  current_title?: string | null
  current_company?: string | null
  source: CandidateSource
  consent_basis: ConsentBasis
  consent_basis_note?: string | null
  consent_date: string
}

/** PATCH body: only the fields that changed. `null` clears the optional ones. */
export type CandidateUpdate = Partial<CandidateCreate>

export interface CandidateListParams {
  q?: string
  source?: CandidateSource | ''
  email?: string
  retention?: RetentionFilter | ''
  page?: number
  page_size?: number
}
