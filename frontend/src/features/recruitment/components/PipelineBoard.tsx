import { Link } from 'react-router-dom'
import { formatShortDate } from '../../../lib/format'
import type { ApplicationListItem, ApplicationStage, Board } from '../../../types/application'
import { closedStages, pipelineStages, stageLabels, stageStyles } from '../lib/applicationStages'

interface Props {
  board: Board
  /** Opens the stage-change dialog for this application. */
  onMove: (application: ApplicationListItem) => void
  onReopen: (application: ApplicationListItem) => void
}

function Card({ a, onMove, onReopen }: { a: ApplicationListItem } & Pick<Props, 'onMove' | 'onReopen'>) {
  const fullName = `${a.candidate.first_name} ${a.candidate.last_name}`
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Link
        to={`/recruitment/applications/${a.id}`}
        className="block truncate text-sm font-medium text-navy-900 hover:text-lavender-600"
        title={fullName}
      >
        {fullName}
      </Link>
      <p className="truncate text-xs text-slate-500" title={a.candidate.email}>
        {a.candidate.email}
      </p>
      <p className="mt-2 truncate text-xs font-medium text-slate-700" title={a.job.title}>
        {a.job.title}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Applied {formatShortDate(a.applied_at)}
        {a.assigned_recruiter ? (
          <>
            {' · '}
            <span title={a.assigned_recruiter.email}>{a.assigned_recruiter.email.split('@')[0]}</span>
          </>
        ) : (
          ' · Unassigned'
        )}
      </p>
      {(a.allowed_stages.length > 0 || a.can_reopen) && (
        <div className="mt-2.5 flex gap-2">
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
        </div>
      )}
    </li>
  )
}

function Column({
  stage,
  board,
  onMove,
  onReopen,
}: { stage: ApplicationStage; board: Board } & Pick<Props, 'onMove' | 'onReopen'>) {
  const column = board.columns[stage]
  const hidden = column.total - column.items.length
  return (
    <section
      aria-label={`${stageLabels[stage]} column`}
      className="flex w-full shrink-0 flex-col rounded-2xl bg-slate-50 p-3 md:w-72"
    >
      <h2 className="flex items-center justify-between px-1 pb-3 text-sm font-semibold text-navy-900">
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
      </h2>
      {column.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
          No applications
        </p>
      ) : (
        <ul className="space-y-2.5">
          {column.items.map((a) => (
            <Card key={a.id} a={a} onMove={onMove} onReopen={onReopen} />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-3 px-1 text-center text-xs text-slate-500">
          Showing {column.items.length} of {column.total}. Use the Applications list to see the rest.
        </p>
      )}
    </section>
  )
}

/**
 * The pipeline, one column per stage. On small screens the columns stack; on larger ones they scroll
 * sideways. Moving an application is a button + dialog (no drag and drop), and the server decides
 * which moves are offered and re-checks each one.
 */
export function PipelineBoard({ board, onMove, onReopen }: Props) {
  const closedTotal = closedStages.reduce((n, s) => n + board.columns[s].total, 0)
  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:overflow-x-auto md:pb-3">
        {pipelineStages.map((stage) => (
          <Column key={stage} stage={stage} board={board} onMove={onMove} onReopen={onReopen} />
        ))}
      </div>

      <details className="group mt-6 rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-navy-900 marker:hidden">
          Closed applications{' '}
          <span className="font-normal text-slate-500">
            ({board.columns.rejected.total} rejected · {board.columns.withdrawn.total} withdrawn)
          </span>
          <span className="sr-only">{closedTotal} in total. Press to show or hide.</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-slate-100 p-4 md:flex-row">
          {closedStages.map((stage) => (
            <Column key={stage} stage={stage} board={board} onMove={onMove} onReopen={onReopen} />
          ))}
        </div>
      </details>
    </>
  )
}
