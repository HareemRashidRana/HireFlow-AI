import { formatDateTime } from '../../../lib/format'
import type { ApplicationEvent } from '../../../types/application'
import { describeEvent } from '../lib/applicationStages'

const dotFor: Record<ApplicationEvent['event_type'], string> = {
  created: 'bg-lavender-500',
  stage_changed: 'bg-lavender-400',
  assigned: 'bg-slate-400',
  rejected: 'bg-rose-500',
  withdrawn: 'bg-slate-400',
  hired: 'bg-emerald-500',
  reopened: 'bg-amber-500',
  notes_updated: 'bg-slate-300',
}

/**
 * The application's history, oldest first. Everything shown comes from the server as plain text
 * and is rendered as text (React escapes it), including staff-written notes.
 */
export function ApplicationTimeline({ events }: { events: ApplicationEvent[] }) {
  if (events.length === 0) {
    return <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">No history recorded yet.</p>
  }
  return (
    <ol aria-label="Application history" className="relative space-y-5 px-5 py-5 sm:px-6">
      <span className="absolute top-6 bottom-6 left-[1.6rem] w-px bg-slate-200 sm:left-[1.85rem]" aria-hidden="true" />
      {events.map((e) => (
        <li key={e.id} className="relative flex gap-4">
          <span
            className={`relative z-10 mt-1.5 size-3 shrink-0 rounded-full ring-4 ring-white ${dotFor[e.event_type]}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-navy-900">{describeEvent(e)}</p>
            {e.note && (
              <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm break-words whitespace-pre-wrap text-slate-600">
                {e.note}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
              {' · '}
              {e.actor ? e.actor.email : 'a removed user'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
