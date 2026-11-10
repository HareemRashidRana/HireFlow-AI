import { useState } from 'react'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Textarea } from '../../../components/ui/Field'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { Feedback, FeedbackContent, Interview } from '../../../types/interview'
import { FEEDBACK_TEXT_MAX, cleanFeedback, emptyFeedback, validateFeedback } from '../lib/interviews'

interface Props {
  interview: Interview
  /** Your own feedback so far, if any. */
  mine: Feedback | null
  onSaved: () => void
}

const toContent = (f: Feedback | null): FeedbackContent =>
  f
    ? {
        overall_rating: f.overall_rating, technical_rating: f.technical_rating, communication_rating: f.communication_rating,
        problem_solving_rating: f.problem_solving_rating, overall_feedback: f.overall_feedback, technical_notes: f.technical_notes,
        role_notes: f.role_notes, strengths: f.strengths, concerns: f.concerns, private_notes: f.private_notes,
      }
    : emptyFeedback

type RatingKey = 'overall_rating' | 'technical_rating' | 'communication_rating' | 'problem_solving_rating'
type TextKey = 'overall_feedback' | 'technical_notes' | 'role_notes' | 'strengths' | 'concerns' | 'private_notes'

const textFields: { key: TextKey; label: string; hint?: string; rows?: number }[] = [
  { key: 'overall_feedback', label: 'Overall feedback', hint: 'Your own assessment, in your own words. Required to submit.', rows: 4 },
  { key: 'technical_notes', label: 'Technical notes (where relevant)' },
  { key: 'role_notes', label: 'Evaluation notes for this role' },
  { key: 'strengths', label: 'Strengths' },
  { key: 'concerns', label: 'Areas for further discussion' },
]

/**
 * Written by the interviewer, never generated. A draft can be saved any time; once submitted, a
 * change needs a reason and the earlier version is kept. Private notes are for the author only.
 */
export function FeedbackForm({ interview, mine, onSaved }: Props) {
  const toast = useToast()
  const scale = useQuery((s) => interviewsApi.ratingScale(s), 'rating-scale')
  const submitted = mine?.status === 'submitted'
  const [content, setContent] = useState<FeedbackContent>(() => toContent(mine))
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Partial<Record<keyof FeedbackContent | 'reason', string>>>({})
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const canSubmit = interview.allowed_actions.includes('submit_feedback')

  const set = (patch: Partial<FeedbackContent>) => {
    setContent((c) => ({ ...c, ...patch }))
    setErrors({})
    setServerError(null)
  }

  const run = async (mode: 'draft' | 'submit') => {
    const clean = cleanFeedback(content)
    const found = validateFeedback(clean, mode)
    const withReason: typeof errors = { ...found }
    if (submitted && !reason.trim()) withReason.reason = 'Say why you are changing it.'
    if (Object.keys(withReason).length > 0) return setErrors(withReason)
    setBusy(mode)
    setServerError(null)
    try {
      if (submitted) await interviewsApi.editFeedback(interview.id, clean, reason.trim())
      else if (mode === 'submit') await interviewsApi.submitFeedback(interview.id, clean)
      else await interviewsApi.saveDraft(interview.id, clean)
      toast.success(submitted ? 'Feedback updated. The earlier version is kept.' : mode === 'submit' ? 'Feedback submitted.' : 'Draft saved.')
      setReason('')
      onSaved()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save your feedback.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void run(submitted || canSubmit ? 'submit' : 'draft')
      }}
      className="space-y-5"
    >
      <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
        {submitted
          ? `You submitted this (version ${mine?.version}). Changing it needs a reason, and the earlier version stays on record.`
          : 'Write this yourself. A draft is only visible to you. Submitted feedback is visible to you, HR and administrators.'}
      </p>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-navy-900">Ratings</legend>
        {scale.loading && !scale.data ? (
          <p className="text-xs text-slate-500">Loading the rating scale…</p>
        ) : scale.error && !scale.data ? (
          <p role="alert" className="text-xs text-rose-600">
            Couldn't load the rating scale.{' '}
            <button type="button" onClick={scale.reload} className="font-medium underline">
              Retry
            </button>
          </p>
        ) : scale.data ? (
          <>
            <ol className="grid gap-1 text-xs text-slate-500 sm:grid-cols-5">
              {scale.data.scale.map((s) => (
                <li key={s.value}>
                  <strong className="text-slate-700">{s.value}. {s.label}</strong> {s.description}
                </li>
              ))}
            </ol>
            {scale.data.areas.map((a) => {
              const key = a.key as RatingKey
              return (
                <div key={a.key} role="radiogroup" aria-label={`${a.label} rating`} className="flex flex-wrap items-center gap-2">
                  <span className="w-36 text-sm text-navy-900">
                    {a.label}
                    {a.required_to_submit && <span className="ml-0.5 text-lavender-600">*</span>}
                  </span>
                  {scale.data!.scale.map((s) => (
                    <label key={s.value} className="cursor-pointer">
                      <input type="radio" name={a.key} className="peer sr-only" checked={content[key] === s.value} onChange={() => set({ [key]: s.value })} />
                      <span
                        title={s.label}
                        className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 text-sm font-medium peer-checked:border-lavender-500 peer-checked:bg-lavender-100 peer-checked:text-lavender-700 peer-focus-visible:ring-4 peer-focus-visible:ring-lavender-100"
                      >
                        {s.value}
                      </span>
                    </label>
                  ))}
                  {!a.required_to_submit && content[key] !== null && (
                    <button type="button" onClick={() => set({ [key]: null })} className="text-xs text-slate-500 underline">
                      clear
                    </button>
                  )}
                  {errors[key] && <span className="w-full text-xs font-medium text-rose-600">{errors[key]}</span>}
                </div>
              )
            })}
          </>
        ) : null}
      </fieldset>

      {textFields.map((f) => (
        <Textarea
          key={f.key}
          label={f.label}
          required={f.key === 'overall_feedback'}
          rows={f.rows ?? 3}
          maxLength={FEEDBACK_TEXT_MAX}
          value={content[f.key] ?? ''}
          error={errors[f.key]}
          hint={f.hint}
          onChange={(e) => set({ [f.key]: e.target.value })}
        />
      ))}
      <Textarea
        label="Private notes (only you can ever see these)"
        rows={3}
        maxLength={FEEDBACK_TEXT_MAX}
        value={content.private_notes ?? ''}
        error={errors.private_notes}
        hint="Not shown to HR, administrators or anyone else, and never kept in the edit history."
        onChange={(e) => set({ private_notes: e.target.value })}
      />

      {submitted && (
        <Textarea label="Why are you changing it?" required rows={2} maxLength={300} value={reason} error={errors.reason} onChange={(e) => { setReason(e.target.value); setErrors({}) }} />
      )}

      {serverError && <Alert>{serverError}</Alert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {!submitted && (
          <Button variant="secondary" loading={busy === 'draft'} onClick={() => void run('draft')}>
            Save draft
          </Button>
        )}
        {(submitted || canSubmit) && (
          <Button type="submit" loading={busy === 'submit'}>
            {submitted ? 'Save the change' : 'Submit feedback'}
          </Button>
        )}
      </div>
      {!submitted && !canSubmit && <p className="text-xs text-slate-500">You can submit once the interview has started. Until then, save a draft.</p>}
    </form>
  )
}
