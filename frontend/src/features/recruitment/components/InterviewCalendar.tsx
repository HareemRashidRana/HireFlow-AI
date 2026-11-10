import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/ui/icons'
import type { Interview } from '../../../types/interview'
import { addDays, dateKey, dayLabel, groupByDay, timeOf, typeLabels } from '../lib/interviews'

interface Props {
  weekStart: Date
  /** "YYYY-MM-DD" of today in the browser's zone (passed in so rendering stays pure). */
  today: string
  items: Interview[]
  loading: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

/** A week at a time, built from the interview records the server returned: no sample data. */
export function InterviewCalendar({ weekStart, today, items, loading, onPrev, onNext, onToday }: Props) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const grouped = groupByDay(items)
  const label = `${dayLabel(dateKey(days[0]), { day: 'numeric', month: 'short' })} – ${dayLabel(dateKey(days[6]), { day: 'numeric', month: 'short', year: 'numeric' })}`
  return (
    <section aria-label="Interview calendar" aria-busy={loading}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-navy-900">Week of {label}</h2>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onPrev} aria-label="Previous week">
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={onToday}>
            Today
          </Button>
          <Button variant="secondary" size="sm" onClick={onNext} aria-label="Next week">
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((d) => {
          const key = dateKey(d)
          const list = grouped[key] ?? []
          return (
            <li
              key={key}
              aria-label={dayLabel(key, { weekday: 'long', day: 'numeric', month: 'long' })}
              className={`min-h-28 rounded-xl border p-3 ${key === today ? 'border-lavender-400 bg-lavender-50/60' : 'border-slate-200 bg-white'}`}
            >
              <p className="text-xs font-semibold text-slate-600">{dayLabel(key)}</p>
              {list.length === 0 ? (
                <p className="mt-2 text-xs text-slate-300">No interviews</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link
                        to={`/recruitment/interviews/${i.id}`}
                        className={`block rounded-lg border px-2 py-1.5 text-xs hover:border-lavender-400 ${
                          i.status === 'cancelled' || i.status === 'rescheduled'
                            ? 'border-slate-200 bg-slate-50 text-slate-400'
                            : 'border-lavender-200 bg-white text-navy-900'
                        }`}
                      >
                        <span className="block font-medium">
                          {timeOf(i.starts_local)}–{timeOf(i.ends_local)}
                          {i.status === 'cancelled' && ' · cancelled'}
                          {i.status === 'rescheduled' && ' · moved'}
                        </span>
                        <span className="block truncate">{i.application.candidate.first_name} {i.application.candidate.last_name}</span>
                        <span className="block truncate text-slate-500">
                          {typeLabels[i.interview_type]} · {i.application.job.title}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
