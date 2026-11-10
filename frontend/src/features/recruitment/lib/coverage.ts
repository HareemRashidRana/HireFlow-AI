import type { AdjustmentReason, Freshness, Judgement, JobScreeningState, ReviewInput } from '../../../types/screening'

export const PRODUCT_NAME = 'Requirements Coverage'
export const NOTE_MAX = 1000

/** Always shown with a result: what this is, and what it is not. */
export const ADVISORY_TEXT =
  "Requirements Coverage compares the skills a job lists with the skills in a reviewed resume. It is advisory information for a person to interpret. It is not an assessment of the candidate, and it never changes the application's stage."

export const freshnessLabels: Record<Freshness, string> = {
  current: 'Current',
  outdated: 'Outdated',
  scrubbed: 'Resume details removed',
}

export const jobStateLabels: Record<JobScreeningState, string> = {
  not_assessed: 'Not assessed',
  current: 'Current assessment',
  outdated: 'Outdated assessment',
  scrubbed: 'Details removed',
  cannot_assess: 'Cannot assess yet',
}

export const judgementLabels: Record<Judgement, string> = {
  agree: 'I agree with this comparison',
  disagree: 'I disagree with this comparison',
  unsure: "I'm not sure",
}

export const judgementShort: Record<Judgement, string> = {
  agree: 'Agrees',
  disagree: 'Disagrees',
  unsure: 'Not sure',
}

export const adjustmentReasonLabels: Record<AdjustmentReason, string> = {
  evidenced_elsewhere: 'Shown elsewhere in the resume',
  equivalent_skill: 'An equivalent skill is listed',
  resume_incomplete: 'The resume is incomplete',
  other: 'Other reason',
}

export const formatFigure = (value: number): string => value.toFixed(1)

export interface ReviewDraft {
  judgement: Judgement | null
  adjustments: string[]
  reason: AdjustmentReason | ''
  note: string
}

export interface ReviewDraftErrors {
  judgement?: string
  reason?: string
  note?: string
}

export function validateReviewDraft(draft: ReviewDraft): ReviewDraftErrors {
  const errors: ReviewDraftErrors = {}
  if (draft.judgement === null) errors.judgement = 'Choose one of the options.'
  if (draft.adjustments.length > 0 && draft.reason === '') errors.reason = 'Choose a reason for the adjustment.'
  if (draft.note.trim().length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} characters.`
  return errors
}

export function toReviewInput(draft: ReviewDraft): ReviewInput {
  return {
    judgement: draft.judgement as Judgement,
    adjustments: draft.adjustments,
    adjustment_reason: draft.adjustments.length > 0 && draft.reason !== '' ? draft.reason : null,
    note: draft.note.trim() || null,
  }
}

/** Percentage of the bar to fill for one criterion (clamped; a bar is decoration, the numbers say it). */
export function barPercent(listed: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((listed / total) * 100)))
}
