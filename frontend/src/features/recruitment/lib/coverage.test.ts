import { describe, expect, it } from 'vitest'
import {
  ADVISORY_TEXT,
  NOTE_MAX,
  barPercent,
  formatFigure,
  freshnessLabels,
  jobStateLabels,
  judgementLabels,
  toReviewInput,
  validateReviewDraft,
} from './coverage'
import type { ReviewDraft } from './coverage'

const draft = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({ judgement: 'agree', adjustments: [], reason: '', note: '', ...over })

describe('validateReviewDraft', () => {
  it('needs a judgement', () => {
    expect(validateReviewDraft(draft({ judgement: null })).judgement).toBeTruthy()
    expect(validateReviewDraft(draft())).toEqual({})
  })

  it.each(['agree', 'disagree', 'unsure'] as const)('accepts %s', (j) => {
    expect(validateReviewDraft(draft({ judgement: j }))).toEqual({})
  })

  it('an adjustment needs a reason, and a reason alone is not an error here', () => {
    expect(validateReviewDraft(draft({ adjustments: ['Docker'] })).reason).toBeTruthy()
    expect(validateReviewDraft(draft({ adjustments: ['Docker'], reason: 'other' }))).toEqual({})
    expect(validateReviewDraft(draft({ reason: 'other' }))).toEqual({})
  })

  it('limits the note to 1000 characters, trimmed', () => {
    expect(validateReviewDraft(draft({ note: 'x'.repeat(NOTE_MAX) })).note).toBeUndefined()
    expect(validateReviewDraft(draft({ note: 'x'.repeat(NOTE_MAX + 1) })).note).toBeTruthy()
    expect(validateReviewDraft(draft({ note: ' ' + 'x'.repeat(NOTE_MAX) + ' ' })).note).toBeUndefined()
  })
})

describe('toReviewInput', () => {
  it('sends null for a blank note and for a reason without adjustments', () => {
    expect(toReviewInput(draft({ note: '   ', reason: 'other' }))).toEqual({
      judgement: 'agree', adjustments: [], adjustment_reason: null, note: null,
    })
  })

  it('keeps adjustments with their reason and trims the note', () => {
    expect(toReviewInput(draft({ adjustments: ['Docker'], reason: 'equivalent_skill', note: '  ok  ' }))).toEqual({
      judgement: 'agree', adjustments: ['Docker'], adjustment_reason: 'equivalent_skill', note: 'ok',
    })
  })
})

describe('formatting and wording', () => {
  it('shows one decimal', () => {
    expect(formatFigure(46.7)).toBe('46.7')
    expect(formatFigure(100)).toBe('100.0')
    expect(formatFigure(0)).toBe('0.0')
  })

  it.each([[0, 3, 0], [1, 3, 33], [3, 3, 100], [5, 3, 100], [-1, 3, 0], [1, 0, 0]])('barPercent(%d of %d) = %d', (a, b, c) => {
    expect(barPercent(a, b)).toBe(c)
  })

  it('every user-facing label avoids evaluative language about people', () => {
    const banned = /suitab|quality|recommend|\brank|\bbest\b|\bstrong\b|\bweak\b|\blacks?\b|unqualified|\bfit\b/i
    const all = [ADVISORY_TEXT, ...Object.values(freshnessLabels), ...Object.values(jobStateLabels), ...Object.values(judgementLabels)]
    for (const text of all) expect(text).not.toMatch(banned)
  })

  it('the advisory text says it is not an assessment of the candidate and never changes the stage', () => {
    expect(ADVISORY_TEXT).toMatch(/advisory/)
    expect(ADVISORY_TEXT).toMatch(/not an assessment of the candidate/)
    expect(ADVISORY_TEXT).toMatch(/never changes the application's stage/)
  })
})
