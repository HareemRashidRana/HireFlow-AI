import { interviewsApi } from '../../../api/interviews'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import { eventLabels } from '../lib/interviews'

/** Scheduling history: when things changed and by whom. Times and statuses only, never free text. */
export function InterviewHistory({ interviewId, refreshKey }: { interviewId: string; refreshKey: string }) {
  const { data, error, loading, reload } = useQuery((s) => interviewsApi.history(interviewId, s), `interview-history-${interviewId}-${refreshKey}`)
  if (loading && !data)
    return (
      <p className="flex items-center gap-2 px-5 py-4 text-sm text-slate-500 sm:px-6">
        <Spinner className="size-4" /> Loading…
      </p>
    )
  if (error && !data)
    return (
      <p role="alert" className="px-5 py-4 text-sm text-rose-600 sm:px-6">
        Couldn't load the history.{' '}
        <button type="button" onClick={reload} className="font-medium underline">
          Retry
        </button>
      </p>
    )
  return (
    <ol aria-label="Interview history" className="space-y-3 px-5 py-4 sm:px-6">
      {(data ?? []).map((e) => (
        <li key={e.id} className="text-sm">
          <span className="font-medium text-navy-900">{eventLabels[e.event_type] ?? e.event_type}</span>
          <span className="text-xs text-slate-500">
            {' '}
            · {formatDateTime(e.created_at)}
            {e.actor ? ` · ${e.actor.email}` : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
