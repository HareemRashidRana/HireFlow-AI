import { formatDateTime } from '../../../lib/format'
import type { Assessment, Criterion, ScreeningReview } from '../../../types/screening'
import { barPercent, formatFigure, freshnessLabels, judgementShort, adjustmentReasonLabels } from '../lib/coverage'

/** One assessment, shown neutrally: numbers and plain labels, no colour judgements, no verdicts. */
export function CoverageDetail({ assessment: a }: { assessment: Assessment }) {
  const tone =
    a.freshness.state === 'current'
      ? 'bg-lavender-100 text-lavender-700'
      : 'bg-slate-100 text-slate-700'
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-navy-900">Assessment #{a.assessment_number}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{freshnessLabels[a.freshness.state]}</span>
        <span className="text-xs text-slate-500">
          {formatDateTime(a.created_at)}
          {a.requested_by ? ` by ${a.requested_by.email}` : ''} · methodology {a.scoring_version}
          {a.resume.version_number !== null ? ` · resume version ${a.resume.version_number}` : ''}
        </span>
      </div>

      {a.freshness.state === 'outdated' && (
        <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">This assessment is outdated.</p>
          <ul className="mt-1 list-disc pl-5">
            {a.freshness.reason_texts.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-1">It still shows the result as it was. Assess again to compare with the current inputs; the earlier result is kept.</p>
        </div>
      )}
      {a.scrubbed && (
        <div role="note" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          The resume-derived details of this assessment were removed
          {a.scrub_reason === 'anonymized' ? ' when the candidate was anonymized' : ' when the resume was deleted'}. Only the
          numbers are kept.
        </div>
      )}

      <div>
        {a.status === 'scored' && a.total_score !== null ? (
          <>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Requirements Coverage</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-navy-900">
              {formatFigure(a.total_score)} <span className="text-base font-normal text-slate-500">/ 100</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Based on {a.assessed_weight} of 100 weight. Advisory only.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Requirements Coverage</p>
            <p className="mt-1 text-lg font-semibold text-navy-900">No figure calculated</p>
            <p className="mt-1 text-sm text-slate-600">{a.explanation}</p>
          </>
        )}
      </div>

      <ul className="space-y-4">
        {a.criteria.map((c) => (
          <CriterionRow key={c.key} criterion={c} />
        ))}
      </ul>

      {a.experience && (
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p>
            <span className="font-medium text-navy-900">Dated experience (context only):</span> {a.experience.dated_text}
            {a.experience.approximate ? ' (approximate: some dates were years only)' : ''}, from {a.experience.positions_counted} of{' '}
            {a.experience.positions_total} position{a.experience.positions_total === 1 ? '' : 's'}.
          </p>
          <p className="mt-1 text-xs text-slate-500">{a.experience.note}</p>
        </div>
      )}

      {a.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
          {a.warnings.map((w) => (
            <li key={w.code}>{w.text}</li>
          ))}
        </ul>
      )}

      <details className="text-sm text-slate-700">
        <summary className="cursor-pointer font-medium text-navy-900">Limitations</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {a.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>

      {a.reviews.length > 0 && (
        <section aria-label="Reviews">
          <h4 className="text-sm font-semibold text-navy-900">Reviews by staff</h4>
          <ul className="mt-2 space-y-3">
            {a.reviews.map((r) => (
              <ReviewItem key={r.id} review={r} original={a.total_score} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CriterionRow({ criterion: c }: { criterion: Criterion }) {
  const listed = c.evidence?.filter((e) => e.status === 'listed') ?? []
  const notListed = c.evidence?.filter((e) => e.status === 'not listed') ?? []
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-navy-900">{c.label}</h4>
        <span className="text-xs text-slate-500">
          {c.status === 'assessed' ? `weight ${formatFigure(c.effective_weight ?? 0)}% of the figure` : `nominal weight ${c.nominal_weight}%`}
        </span>
      </div>
      {c.status === 'assessed' ? (
        <>
          <p className="mt-1 text-sm text-slate-700">
            {c.listed} of {c.total} listed in the reviewed resume
            {c.points !== null ? ` · ${formatFigure(c.points)} points` : ''}
          </p>
          <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-lavender-500" style={{ width: `${barPercent(c.listed, c.total)}%` }} />
          </div>
          {c.evidence ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-lavender-700">Show which skills</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Listed ({listed.length})</p>
                  <ul className="mt-1 space-y-0.5">
                    {listed.map((e) => (
                      <li key={e.requirement} className="[overflow-wrap:anywhere]">
                        {e.requirement}
                        {e.matched_via === 'alias' && e.matched_text && (
                          <span className="text-xs text-slate-500"> (resume says "{e.matched_text}", a known alternative name)</span>
                        )}
                      </li>
                    ))}
                    {listed.length === 0 && <li className="text-slate-400">None</li>}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Not listed ({notListed.length})</p>
                  <ul className="mt-1 space-y-0.5">
                    {notListed.map((e) => (
                      <li key={e.requirement} className="[overflow-wrap:anywhere]">
                        {e.requirement}
                      </li>
                    ))}
                    {notListed.length === 0 && <li className="text-slate-400">None</li>}
                  </ul>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">"Not listed" only means the reviewed resume does not name it. Resumes are incomplete.</p>
            </details>
          ) : (
            <p className="mt-2 text-xs text-slate-500">The skill-by-skill details were removed.</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">{c.reason}</p>
      )}
    </li>
  )
}

function ReviewItem({ review: r, original }: { review: ScreeningReview; original: number | null }) {
  return (
    <li className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <p>
        <span className="font-medium text-navy-900">{judgementShort[r.judgement]}</span>
        <span className="text-xs text-slate-500">
          {' '}
          · {r.reviewer ? r.reviewer.email : 'a former user'} · {formatDateTime(r.created_at)}
        </span>
      </p>
      {r.adjusted_total !== null && r.adjustments && (
        <p className="mt-1">
          Adjusted figure: <strong>{formatFigure(r.adjusted_total)}</strong>
          {original !== null ? ` (original ${formatFigure(original)}, unchanged)` : ''}. Counted as covered:{' '}
          {r.adjustments.join(', ')}
          {r.adjustment_reason ? ` (${adjustmentReasonLabels[r.adjustment_reason]})` : ''}.
        </p>
      )}
      {r.scrubbed && <p className="mt-1 text-xs text-slate-500">The note and adjustment details were removed.</p>}
      {r.note && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.note}</p>}
    </li>
  )
}
