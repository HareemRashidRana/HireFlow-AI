import { useState } from 'react'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { Feedback, FeedbackOverview, RatingScale } from '../../../types/interview'

const AREAS: { key: keyof Feedback; label: string }[] = [
  { key: 'overall_rating', label: 'Overall' },
  { key: 'technical_rating', label: 'Technical' },
  { key: 'communication_rating', label: 'Communication' },
  { key: 'problem_solving_rating', label: 'Problem solving' },
]
const TEXTS: { key: keyof Feedback; label: string }[] = [
  { key: 'overall_feedback', label: 'Overall feedback' },
  { key: 'technical_notes', label: 'Technical notes' },
  { key: 'role_notes', label: 'Role notes' },
  { key: 'strengths', label: 'Strengths' },
  { key: 'concerns', label: 'Areas for further discussion' },
]

function Revisions({ interviewId, feedbackId }: { interviewId: string; feedbackId: string }) {
  const { data, error, loading, reload } = useQuery((s) => interviewsApi.revisions(interviewId, feedbackId, s), `rev-${feedbackId}`)
  if (loading && !data)
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Spinner className="size-4" /> Loading…
      </p>
    )
  if (error && !data)
    return (
      <p role="alert" className="text-xs text-rose-600">
        Couldn't load the earlier versions.{' '}
        <button type="button" onClick={reload} className="font-medium underline">
          Retry
        </button>
      </p>
    )
  return (
    <ul className="space-y-2">
      {(data ?? []).map((r) => (
        <li key={r.version} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p className="font-medium text-navy-900">
            Version {r.version} (replaced {formatDateTime(r.created_at)}
            {r.edited_by ? ` by ${r.edited_by.email}` : ''})
          </p>
          <p className="text-slate-500">Reason for the change: {r.edit_reason ?? 'not given'}</p>
          <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            Overall rating {String(r.snapshot.overall_rating ?? 'none')}: {String(r.snapshot.overall_feedback ?? '')}
          </p>
        </li>
      ))}
    </ul>
  )
}

function Item({ interviewId, f, scale }: { interviewId: string; f: Feedback; scale: RatingScale | null }) {
  const [showRevisions, setShowRevisions] = useState(false)
  const label = (n: number | null) => (n === null ? 'not rated' : `${n}${scale ? ` · ${scale.scale.find((s) => s.value === n)?.label ?? ''}` : ''}`)
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-navy-900">{f.is_mine ? 'You' : (f.interviewer?.email ?? 'A former user')}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.status === 'submitted' ? 'bg-lavender-100 text-lavender-700' : 'bg-slate-100 text-slate-600'}`}>
          {f.status === 'submitted' ? 'Submitted' : 'Draft (only you can see it)'}
        </span>
        {f.status === 'submitted' && f.version > 1 && <span className="text-xs text-slate-500">version {f.version}</span>}
        {f.submitted_at && <span className="text-xs text-slate-500">{formatDateTime(f.submitted_at)}</span>}
      </div>
      {f.scrubbed ? (
        <p className="mt-2 text-xs text-slate-500">The written feedback was removed. Only the ratings are kept.</p>
      ) : null}
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {AREAS.map((a) => (
          <div key={a.label} className="flex justify-between gap-3">
            <dt className="text-slate-500">{a.label}</dt>
            <dd className="text-navy-900">{label(f[a.key] as number | null)}</dd>
          </div>
        ))}
      </dl>
      {TEXTS.map((t) =>
        f[t.key] ? (
          <div key={t.label} className="mt-3">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t.label}</p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-700 [overflow-wrap:anywhere]">{String(f[t.key])}</p>
          </div>
        ) : null,
      )}
      {f.is_mine && f.private_notes && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-800">Your private notes: only you can see these</p>
          <p className="mt-0.5 text-sm whitespace-pre-wrap text-amber-900 [overflow-wrap:anywhere]">{f.private_notes}</p>
        </div>
      )}
      {f.status === 'submitted' && f.version > 1 && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" aria-expanded={showRevisions} onClick={() => setShowRevisions((v) => !v)}>
            {showRevisions ? 'Hide earlier versions' : 'Show earlier versions'}
          </Button>
          {showRevisions && <Revisions interviewId={interviewId} feedbackId={f.id} />}
        </div>
      )}
    </li>
  )
}

/** What this person is allowed to read. There are no averages and no ranking of people. */
export function FeedbackSummary({ overview, scale }: { overview: FeedbackOverview; scale: RatingScale | null }) {
  const { items, can_view_all, submitted_count, pending_interviewers } = overview
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {submitted_count} of {submitted_count + pending_interviewers.length} interviewer{submitted_count + pending_interviewers.length === 1 ? '' : 's'}{' '}
        {submitted_count === 1 ? 'has' : 'have'} submitted feedback.
        {!can_view_all && ' You can read your own feedback; HR and administrators can read everyone’s.'}
      </p>
      {pending_interviewers.length > 0 && (
        <p className="text-xs text-slate-500">Still to submit: {pending_interviewers.map((p) => p.email).join(', ')}</p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{can_view_all ? 'No feedback has been submitted yet.' : 'You have not written any feedback yet.'}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((f) => (
            <Item key={f.id} interviewId={overview.interview_id} f={f} scale={scale} />
          ))}
        </ul>
      )}
    </div>
  )
}
