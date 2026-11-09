import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeCandidate } from '../../../test/fixtures'
import {
  DUPLICATE_EMAIL_MESSAGE,
  buildCandidateCreatePayload,
  buildCandidatePatchPayload,
  emptyCandidateValues,
  mapCandidateApiError,
  toCandidateFormValues,
  validateCandidate,
} from './candidateFormValues'
import type { CandidateFormValues } from './candidateFormValues'
import {
  candidateSourceLabels,
  candidateSources,
  consentBasisHints,
  consentBasisLabels,
  consentBases,
} from './candidateOptions'

const TODAY = '2026-03-15'
const valid: CandidateFormValues = {
  ...emptyCandidateValues(TODAY),
  first_name: 'Sana',
  last_name: 'Iqbal',
  email: 'sana@example.com',
  source: 'linkedin',
  consent_basis: 'legitimate_interest',
}
const withValues = (over: Partial<CandidateFormValues>): CandidateFormValues => ({ ...valid, ...over })
const errorsFor = (over: Partial<CandidateFormValues>) => validateCandidate(withValues(over), TODAY)

describe('the empty form', () => {
  it('pre-selects nothing about the legal basis or the source (consent is never assumed)', () => {
    const empty = emptyCandidateValues(TODAY)
    expect(empty.consent_basis).toBe('')
    expect(empty.source).toBe('')
    expect(empty.consent_basis_note).toBe('')
  })

  it('defaults the date to today', () => {
    expect(emptyCandidateValues(TODAY).consent_date).toBe(TODAY)
  })

  it('cannot be submitted as it stands', () => {
    const errors = validateCandidate(emptyCandidateValues(TODAY), TODAY)
    expect(Object.keys(errors).sort()).toEqual(['consent_basis', 'email', 'first_name', 'last_name', 'source'])
  })
})

describe('validateCandidate', () => {
  it('accepts the minimum valid form', () => {
    expect(validateCandidate(valid, TODAY)).toEqual({})
  })

  it('accepts a fully filled form', () => {
    expect(
      errorsFor({ phone: '+92 300 1234567', location: 'Lahore', current_title: 'Dev', current_company: 'Acme' }),
    ).toEqual({})
  })

  it.each(['', '   '])('requires a first and last name (%j)', (blank) => {
    expect(errorsFor({ first_name: blank }).first_name).toBeDefined()
    expect(errorsFor({ last_name: blank }).last_name).toBeDefined()
  })

  it('limits names to 100 characters', () => {
    expect(errorsFor({ first_name: 'x'.repeat(100) }).first_name).toBeUndefined()
    expect(errorsFor({ first_name: 'x'.repeat(101) }).first_name).toBeDefined()
    expect(errorsFor({ last_name: 'x'.repeat(101) }).last_name).toBeDefined()
  })

  it.each(['', 'nope', 'a@b', '@b.co', 'a b@c.co'])('rejects the email %j', (email) => {
    expect(errorsFor({ email }).email).toBeDefined()
  })

  it('accepts a valid email with surrounding spaces', () => {
    expect(errorsFor({ email: '  a@b.co  ' }).email).toBeUndefined()
  })

  it.each(['abc', '12', '++12345678', '12-ab-3456'])('rejects the phone %j', (phone) => {
    expect(errorsFor({ phone }).phone).toBeDefined()
  })

  it.each(['+92 300 1234567', '042 (1234) 567', '03001234567'])('accepts the phone %j', (phone) => {
    expect(errorsFor({ phone }).phone).toBeUndefined()
  })

  it('treats the phone as optional', () => {
    expect(errorsFor({ phone: '   ' }).phone).toBeUndefined()
  })

  it('limits optional text to 150 characters', () => {
    for (const key of ['location', 'current_title', 'current_company'] as const) {
      expect(errorsFor({ [key]: 'x'.repeat(150) })[key]).toBeUndefined()
      expect(errorsFor({ [key]: 'x'.repeat(151) })[key]).toBeDefined()
    }
  })

  it('requires a source and a basis', () => {
    expect(errorsFor({ source: '' }).source).toBeDefined()
    expect(errorsFor({ consent_basis: '' }).consent_basis).toBeDefined()
  })

  describe('the explanation for "other"', () => {
    it('is required when the basis is other', () => {
      expect(errorsFor({ consent_basis: 'other', consent_basis_note: '' }).consent_basis_note).toBeDefined()
      expect(errorsFor({ consent_basis: 'other', consent_basis_note: '   ' }).consent_basis_note).toBeDefined()
    })

    it('is accepted up to 200 characters', () => {
      expect(errorsFor({ consent_basis: 'other', consent_basis_note: 'x'.repeat(200) }).consent_basis_note).toBeUndefined()
      expect(errorsFor({ consent_basis: 'other', consent_basis_note: 'x'.repeat(201) }).consent_basis_note).toBeDefined()
    })

    it.each(['consent', 'legitimate_interest', 'pre_contract_steps'] as const)(
      'is not required for %s',
      (basis) => {
        expect(errorsFor({ consent_basis: basis, consent_basis_note: '' }).consent_basis_note).toBeUndefined()
      },
    )
  })

  describe('the basis date', () => {
    it('is required', () => {
      expect(errorsFor({ consent_date: '' }).consent_date).toBeDefined()
    })

    it('may be today or in the past', () => {
      expect(errorsFor({ consent_date: TODAY }).consent_date).toBeUndefined()
      expect(errorsFor({ consent_date: '2020-01-01' }).consent_date).toBeUndefined()
    })

    it('may not be in the future', () => {
      expect(errorsFor({ consent_date: '2026-03-16' }).consent_date).toMatch(/future/i)
    })
  })
})

describe('buildCandidateCreatePayload', () => {
  it('trims text, lowercases the email and uses null for blanks', () => {
    expect(
      buildCandidateCreatePayload(
        withValues({ first_name: ' Sana ', last_name: ' Iqbal ', email: '  Sana@EXAMPLE.com ', location: '  ' }),
      ),
    ).toEqual({
      first_name: 'Sana',
      last_name: 'Iqbal',
      email: 'sana@example.com',
      phone: null,
      location: null,
      current_title: null,
      current_company: null,
      source: 'linkedin',
      consent_basis: 'legitimate_interest',
      consent_basis_note: null,
      consent_date: TODAY,
    })
  })

  it('sends the explanation only for the "other" basis', () => {
    const other = buildCandidateCreatePayload(withValues({ consent_basis: 'other', consent_basis_note: ' Walk-in ' }))
    expect(other.consent_basis_note).toBe('Walk-in')
    // a stale explanation typed earlier must never be sent for a different basis
    const consent = buildCandidateCreatePayload(withValues({ consent_basis: 'consent', consent_basis_note: 'old text' }))
    expect(consent.consent_basis_note).toBeNull()
  })

  it('never contains data we do not collect', () => {
    const keys = Object.keys(buildCandidateCreatePayload(valid))
    for (const forbidden of ['date_of_birth', 'gender', 'nationality', 'photo', 'address', 'salary', 'national_id']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('toCandidateFormValues / buildCandidatePatchPayload', () => {
  it('round-trips a saved candidate without changes', () => {
    const candidate = makeCandidate({ consent_basis: 'other', consent_basis_note: 'Referred' })
    expect(buildCandidatePatchPayload(toCandidateFormValues(candidate), candidate)).toEqual({})
  })

  it('shows null fields as empty strings', () => {
    const values = toCandidateFormValues(makeCandidate({ phone: null, location: null, current_title: null, current_company: null }))
    expect(values).toMatchObject({ phone: '', location: '', current_title: '', current_company: '' })
  })

  it('sends only what changed', () => {
    const candidate = makeCandidate()
    const values = { ...toCandidateFormValues(candidate), location: 'Karachi', current_title: 'Lead' }
    expect(buildCandidatePatchPayload(values, candidate)).toEqual({ location: 'Karachi', current_title: 'Lead' })
  })

  it('ignores whitespace-only edits and email case', () => {
    const candidate = makeCandidate()
    const values = { ...toCandidateFormValues(candidate), first_name: ` ${candidate.first_name} `, email: candidate.email.toUpperCase() }
    expect(buildCandidatePatchPayload(values, candidate)).toEqual({})
  })

  it('sends null to clear optional fields', () => {
    const candidate = makeCandidate()
    const values = { ...toCandidateFormValues(candidate), phone: '', location: '' }
    expect(buildCandidatePatchPayload(values, candidate)).toEqual({ phone: null, location: null })
  })

  it('drops the old explanation when moving away from "other"', () => {
    const candidate = makeCandidate({ consent_basis: 'other', consent_basis_note: 'Walk-in' })
    const values = { ...toCandidateFormValues(candidate), consent_basis: 'consent' as const }
    expect(buildCandidatePatchPayload(values, candidate)).toEqual({ consent_basis: 'consent', consent_basis_note: null })
  })

  it('sends both the basis and its explanation when switching to "other"', () => {
    const candidate = makeCandidate()
    const values = { ...toCandidateFormValues(candidate), consent_basis: 'other' as const, consent_basis_note: 'Walk-in' }
    expect(buildCandidatePatchPayload(values, candidate)).toEqual({ consent_basis: 'other', consent_basis_note: 'Walk-in' })
  })
})

describe('mapCandidateApiError', () => {
  it('maps field validation errors onto their inputs', () => {
    const error = new ApiError('x', 422, { email: 'Bad', phone: 'Worse' })
    expect(mapCandidateApiError(error)).toEqual({ fields: { email: 'Bad', phone: 'Worse' }, general: null })
  })

  it('ignores unknown server fields', () => {
    expect(mapCandidateApiError(new ApiError('Please fix.', 422, { mystery: '?' })).general).toBe('Please fix.')
  })

  it('maps a duplicate email to the email field', () => {
    expect(DUPLICATE_EMAIL_MESSAGE).toBe('A candidate with this email already exists')
    expect(mapCandidateApiError(new ApiError(DUPLICATE_EMAIL_MESSAGE, 409))).toEqual({
      fields: { email: DUPLICATE_EMAIL_MESSAGE },
      general: null,
    })
  })

  it.each([
    "Explain the basis when you choose 'other'",
    "An explanation is only needed when the basis is 'other'",
  ])('maps the basis rule "%s" to the explanation field', (message) => {
    expect(mapCandidateApiError(new ApiError(message, 422)).fields.consent_basis_note).toBe(message)
  })

  it('shows anything else as a general message', () => {
    expect(mapCandidateApiError(new ApiError("This candidate's data was anonymized and can no longer be edited", 409)).general).toMatch(/anonymized/)
    expect(mapCandidateApiError(new Error('boom')).general).toMatch(/something went wrong/i)
  })
})

describe('options', () => {
  it('has a label for every source and every basis, and help text for every basis', () => {
    expect(candidateSources.map((s) => candidateSourceLabels[s])).toEqual([
      'Referral', 'LinkedIn', 'Job board', 'Agency', 'Direct application', 'Other',
    ])
    expect(consentBases.map((b) => consentBasisLabels[b])).toEqual([
      'Consent', 'Legitimate interest', 'Steps before a contract', 'Other',
    ])
    for (const basis of consentBases) expect(consentBasisHints[basis].length).toBeGreaterThan(10)
  })

  it('does not present consent as the default or the only option', () => {
    expect(consentBases).toHaveLength(4)
    expect(consentBases[0]).toBe('consent') // listed in a neutral order, but never pre-selected
    expect(emptyCandidateValues(TODAY).consent_basis).not.toBe('consent')
  })
})
