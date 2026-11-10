import { useState } from 'react'
import { screeningApi } from '../../../api/screening'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { useToast } from '../../../components/ui/Toast'
import type { AdjustmentReason, Assessment, Judgement } from '../../../types/screening'
import {
  NOTE_MAX,
  adjustmentReasonLabels,
  judgementLabels,
  toReviewInput,
  validateReviewDraft,
} from '../lib/coverage'
import type { ReviewDraft, ReviewDraftErrors } from '../lib/coverage'

interface Props {
  assessment: Assessment
  onSaved: () => void
}

const judgements: Judgement[] = ['agree', 'disagree', 'unsure']
const empty: ReviewDraft = { judgement: null, adjustments: [], reason: '', note: '' }

/**
 * A person's own judgement about this comparison. It is saved beside the result, never over it, and
 * it never changes the application. Notes are for staff only.
 */
export function CoverageReviewForm({ assessment, onSaved }: Props) {
  const toast = useToast()
  const [draft, setDraft] = useState<ReviewDraft>(empty)
  const [errors, setErrors] = useState<ReviewDraftErrors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const toggle = (requirement: string) =>
    setDraft((d) => ({
      ...d,
      adjustments: d.adjustments.includes(requirement)
        ? d.adjustments.filter((r) => r !== requirement)
        : [...d.adjustments, requirement],
    }))

  const submit = async () => {
    const found = validateReviewDraft(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setServerError(null)
    try {
      await screeningApi.review(assessment.id, toReviewInput(draft))
      toast.success('Your review was saved.')
      setDraft(empty)
      onSaved()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save your review.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="text-sm font-medium text-navy-900">Your judgement of this comparison</legend>
        <div className="mt-2 space-y-1.5">
          {judgements.map((j) => (
            <label key={j} className="flex cursor-pointer items-center gap-2.5 text-sm text-navy-900">
              <input
                type="radio"
                name="coverage-judgement"
                checked={draft.judgement === j}
                onChange={() => setDraft((d) => ({ ...d, judgement: j }))}
                className="size-4 accent-lavender-600"
              />
              {judgementLabels[j]}
            </label>
          ))}
        </div>
        {errors.judgement && <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.judgement}</p>}
      </fieldset>

      {assessment.unlisted_requirements.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium text-navy-900">Optional: requirements you can see are covered</legend>
          <p className="mt-1 text-xs text-slate-500">
            Marking one adds a separate, adjusted figure next to the original. The original result never changes.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {assessment.unlisted_requirements.map((r) => (
              <label
                key={r}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-navy-900"
              >
                <input
                  type="checkbox"
                  checked={draft.adjustments.includes(r)}
                  onChange={() => toggle(r)}
                  className="size-4 accent-lavender-600"
                />
                {r}
              </label>
            ))}
          </div>
          {draft.adjustments.length > 0 && (
            <div className="mt-3">
              <label htmlFor="coverage-reason" className="mb-1.5 block text-sm font-medium text-navy-800">
                Reason
              </label>
              <select
                id="coverage-reason"
                value={draft.reason}
                aria-invalid={!!errors.reason}
                onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value as AdjustmentReason | '' }))}
                className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-navy-900 shadow-sm sm:max-w-sm"
              >
                <option value="">Choose a reason…</option>
                {(Object.keys(adjustmentReasonLabels) as AdjustmentReason[]).map((k) => (
                  <option key={k} value={k}>
                    {adjustmentReasonLabels[k]}
                  </option>
                ))}
              </select>
              {errors.reason && <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.reason}</p>}
            </div>
          )}
        </fieldset>
      )}

      <div>
        <label htmlFor="coverage-note" className="mb-1.5 block text-sm font-medium text-navy-800">
          Note (optional)
        </label>
        <textarea
          id="coverage-note"
          value={draft.note}
          aria-invalid={!!errors.note}
          aria-describedby="coverage-note-hint"
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          rows={3}
          className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 shadow-sm"
        />
        <p id="coverage-note-hint" className="mt-1.5 text-xs text-slate-500">
          {draft.note.length}/{NOTE_MAX}. Visible to staff only and removed if the candidate is anonymized. Do not add
          sensitive personal details.
        </p>
        {errors.note && <p className="mt-1 text-xs font-medium text-rose-600">{errors.note}</p>}
      </div>

      {serverError && <Alert>{serverError}</Alert>}
      <Button type="submit" loading={busy}>
        Save my review
      </Button>
    </form>
  )
}
