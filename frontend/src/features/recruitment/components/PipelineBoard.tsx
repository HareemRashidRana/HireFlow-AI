import { Link, useLocation } from 'react-router-dom'
import { Spinner } from '../../../components/ui/Spinner'
import { formatShortDate } from '../../../lib/format'
import type { ApplicationListItem, ApplicationStage, Board } from '../../../types/application'
import { allStages, stageLabels, stageStyles } from '../lib/applicationStages'
import { candidateSourceLabels } from '../lib/candidateOptions'
import { fromState } from '../lib/navContext'

/** Extra cards loaded with "Load more", per column. */
export interface ColumnExtra {
  items: ApplicationListItem[]
  /** Is there another page after the ones loaded so far? */
  hasMore: boolean
  loading: boolean
  error: string | null
}

interface Props {
  board: Board
  extra: Partial<Record<ApplicationStage, ColumnExtra>>
  onMove: (application: ApplicationListItem) => void
  onReopen: (application: ApplicationListItem) => void
  onLoadMore: (stage: ApplicationStage) => void
}

type Kind = 'active' | 'won' | 'closed'
const kindOf = (stage: ApplicationStage): Kind =>
  stage === 'hired' ? 'won' : stage === 'rejected' || stage === 'withdrawn' ? 'closed' : 'active'

const kindStyles: Record<Kind, { column: string; label: string }> = {
  active: { column: 'bg-slate-50 ring-slate-200/70', label: 'In progress' },
  won: { column: 'bg-emerald-50/70 ring-emerald-200', label: 'Successful' },
  closed: { column: 'bg-slate-100/80 ring-slate-200', label: 'Ended' },
}

function Card({
  a,
  onMove,
  onReopen,
}: { a: ApplicationListItem } & Pick<Props, 'onMove' | 'onReopen'>) {
  const location = useLocation()
  const state = fromState(location.pathname + location.search)
  const fullName = `${a.candidate.first_name} ${a.candidate.last_name}`
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Link
        to={`/recruitment/applications/${a.id}`}
        state={state}
        className="block truncate text-sm font-medium text-navy-900 hover:text-lavender-600"
        title={fullName}
      >
        {fullName}
      </Link>
      <p className="truncate text-xs text-slate-500" title={a.candidate.current_title ?? a.candidate.email}>
        {a.candidate.current_title ?? a.candidate.email}
      </p>
      <Link
        to={`/recruitment/jobs/${a.job.id}`}
        state={state}
        className="mt-2 block truncate text-xs font-medium text-slate-700 hover:text-lavender-600"
        title={a.job.title}
      >
        {a.job.title}
      </Link>
      <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
        <div className="flex justify-between gap-2">
          <dt className="sr-only">Applied</dt>
          <dd>Applied {formatShortDate(a.applied_at)}</dd>
          <dd className="truncate">{candidateSourceLabels[a.source]}</dd>
        </div>
        <div className="truncate">
          <dt className="sr-only">Recruiter</dt>
          <dd title={a.assigned_recruiter?.email}>
            {a.assigned_recruiter ? a.assigned_recruiter.email.split('@')[0] : 'Unassigned'}
          </dd>
        </div>
      </dl>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {a.allowed_stages.length > 0 && (
          <button
            type="button"
            onClick={() => onMove(a)}
            aria-label={`Move ${fullName}`}
            className="h-8 rounded-lg bg-lavender-50 px-3 text-xs font-medium text-lavender-700 ring-1 ring-lavender-200 ring-inset hover:bg-lavender-100"
          >
            Move…
          </button>
        )}
        {a.can_reopen && (
          <button
            type="button"
            onClick={() => onReopen(a)}
            aria-label={`Reopen ${fullName}`}
            className="h-8 rounded-lg px-3 text-xs font-medium text-slate-600 ring-1 ring-slate-200 ring-inset hover:bg-slate-50"
          >
            Reopen
          </button>
        )}
        <Link
          to={`/recruitment/candidates/${a.candidate.id}`}
          state={state}
          aria-label={`Profile of ${fullName}`}
          className="ml-auto inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-slate-500 hover:text-lavender-600"
        >
          Profile
        </Link>
      </div>
    </li>
  )
}

function Column({
  stage,
  board,
  extra,
  onMove,
  onReopen,
  onLoadMore,
}: { stage: ApplicationStage } & Props) {
  const column = board.columns[stage]
  const more = extra[stage]
  const items = [...column.items, ...(more?.items ?? [])]
  const remaining = Math.max(0, column.total - items.length)
  const hasMore = more ? more.hasMore : column.has_more
  const kind = kindOf(stage)
  return (
    <section
      aria-label={`${stageLabels[stage]} column`}
      className={`flex w-full shrink-0 flex-col rounded-2xl p-3 ring-1 ring-inset md:w-72 ${kindStyles[kind].column}`}
    >
      <h2 className="px-1 pb-3">
        <span className="flex items-center justify-between text-sm font-semibold text-navy-900">
          <span className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${stageStyles[stage].dot}`} aria-hidden="true" />
            {stageLabels[stage]}
          </span>
          <span
            aria-label={`${column.total} application${column.total === 1 ? '' : 's'}`}
            className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
          >
            {column.total}
          </span>
        </span>
        <span className="mt-0.5 block text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          {kindStyles[kind].label}
        </span>
      </h2>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
          No applications
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => (
            <Card key={a.id} a={a} onMove={onMove} onReopen={onReopen} />
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="mt-3 px-1 text-center text-xs text-slate-500" aria-live="polite">
          Showing {items.length} of {column.total}
        </p>
      )}
      {more?.error && (
        <p role="alert" className="mt-2 px-1 text-center text-xs text-rose-600">
          {more.error}
        </p>
      )}
      {(hasMore || (more?.error && remaining > 0)) && (
        <button
          type="button"
          onClick={() => onLoadMore(stage)}
          disabled={more?.loading}
          aria-label={`Load more ${stageLabels[stage]} applications`}
          className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white text-xs font-medium text-lavender-700 ring-1 ring-lavender-200 ring-inset hover:bg-lavender-50 disabled:opacity-60"
        >
          {more?.loading && <Spinner className="size-3.5" />}
          {more?.error ? 'Try again' : `Load ${Math.min(remaining, board.per_column_limit)} more`}
        </button>
      )}
    </section>
  )
}

/**
 * The whole pipeline, one column per stage: in progress, hired and ended. Small screens stack the
 * columns; larger ones scroll sideways. Each column shows its TRUE total and loads more cards on
 * request, so nothing is silently hidden. Moving an application is a button + dialog (no drag and
 * drop: it is not keyboard accessible and the server only allows one step at a time anyway).
 */
export function PipelineBoard(props: Props) {
  return (
    // `relative` matters: screen-reader-only labels are absolutely positioned, and without a
    // positioned scroll container they escape it and make the whole PAGE scroll sideways.
    <div className="relative flex flex-col gap-4 md:flex-row md:overflow-x-auto md:pb-3">
      {allStages.map((stage) => (
        <Column key={stage} stage={stage} {...props} />
      ))}
    </div>
  )
}
