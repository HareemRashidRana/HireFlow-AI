import type { CandidateSource, ConsentBasis } from '../../../types/candidate'

export const candidateSourceLabels: Record<CandidateSource, string> = {
  referral: 'Referral',
  linkedin: 'LinkedIn',
  job_board: 'Job board',
  agency: 'Agency',
  direct: 'Direct application',
  other: 'Other',
}

export const candidateSources = Object.keys(candidateSourceLabels) as CandidateSource[]

/** Consent is one possible basis, not the default: the user must choose deliberately. */
export const consentBasisLabels: Record<ConsentBasis, string> = {
  consent: 'Consent',
  legitimate_interest: 'Legitimate interest',
  pre_contract_steps: 'Steps before a contract',
  other: 'Other',
}

export const consentBases = Object.keys(consentBasisLabels) as ConsentBasis[]

/** Plain-language help, deliberately neutral (this is not legal advice). */
export const consentBasisHints: Record<ConsentBasis, string> = {
  consent: 'The candidate agreed to you keeping their details.',
  legitimate_interest: 'You have a genuine business reason to hold them, for example you approached them about a role.',
  pre_contract_steps: 'They applied or asked to be considered, so you need their details to assess them.',
  other: 'Some other basis. Say what it is in the explanation field.',
}

export const retentionFilterLabels = {
  expiring: 'Expiring within 30 days',
  expired: 'Past retention date',
} as const
