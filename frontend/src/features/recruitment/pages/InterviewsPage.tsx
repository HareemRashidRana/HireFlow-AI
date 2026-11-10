import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { InterviewCalendar } from '../components/InterviewCalendar'
import { InterviewFilters } from '../components/InterviewFilters'
import { InterviewStats } from '../components/InterviewStats'
import { InterviewStatusBadge } from '../components/InterviewStatusBadge'
import { InterviewTable } from '../components/InterviewTable'
import { ScheduleInterviewDialog } from '../components/ScheduleInterviewDialog'
import { activeFilterCount, emptyFilters } from '../lib/interviewFilters'
import type { InterviewFilterValues } from '../lib/interviewFilters'
import { addDays, dateKey, formatRange, startOfWeek, weekRange } from '../lib/interviews'

const PAGE_SIZE = 10

function localStartOfDay(day: string): string | undefined {
  if (!day) return undefined
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

export function InterviewsPage() {
  const [tab, setTab] = useState<'calendar' | 'list'>('calendar')
  const [filters, setFilters] = useState<InterviewFilterValues>(emptyFilters)
  const [page, setPage] = useState(1)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [scheduling, setScheduling] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [todayKey] = useState(() => dateKey(new Date()))

  const changeFilters = (next: InterviewFilterValues) => {
    setFilters(next)
    setPage(1)
  }

  const listParams = useMemo(
    () => ({
      q: filters.q.trim() || undefined,
      status: filters.status,
      interview_type: filters.type,
      interviewer_id: filters.mine ? 'me' : undefined,
      starts_from: localStartOfDay(filters.from),
      starts_to: filters.to ? localStartOfDay(addDaysText(filters.to)) : undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    [filters, page],
  )
  const list = useQuery((s) => interviewsApi.list(listParams, s), `interviews-list-${JSON.stringify(listParams)}-${refresh}`, tab === 'list')
  const week = useQuery(
    (s) => interviewsApi.list({ ...weekRange(weekStart), page_size: 100 }, s),
    `interviews-week-${weekStart.toISOString()}-${refresh}`,
    tab === 'calendar',
  )
  const upcoming = useQuery((s) => interviewsApi.list({ starts_from: new Date().toISOString(), page_size: 12 }, s), `interviews-upcoming-${refresh}`)

  const open = (upcoming.data?.items ?? []).filter((i) => i.status === 'scheduled' || i.status === 'confirmed').slice(0, 5)
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.page_size)) : 1
  const changed = () => setRefresh((n) => n + 1)

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Interviews</h1>
          <p className="mt-1 text-sm text-slate-500">Schedule, track and give feedback on interviews. Scheduling never changes an application's stage.</p>
        </div>
        <Button onClick={() => setScheduling(true)}>
          <PlusIcon className="size-4" /> Schedule interview
        </Button>
      </div>

      <div className="space-y-6">
        <InterviewStats refreshKey={refresh} />

        <Card>
          <CardHeader title="Upcoming" />
          {upcoming.loading && !upcoming.data ? (
            <p className="flex items-center gap-2 px-5 py-4 text-sm text-slate-500 sm:px-6">
              <Spinner className="size-4" /> Loading…
            </p>
          ) : upcoming.error && !upcoming.data ? (
            <p role="alert" className="px-5 py-4 text-sm text-rose-600 sm:px-6">
              Couldn't load upcoming interviews.{' '}
              <button type="button" onClick={upcoming.reload} className="font-medium underline">
                Retry
              </button>
            </p>
          ) : open.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500 sm:px-6">Nothing coming up. Scheduled interviews appear here.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {open.map((i) => (
                <li key={i.id}>
                  <Link to={`/recruitment/interviews/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-lavender-50/60 sm:px-6">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-navy-900">
                        {i.title}: {i.application.candidate.first_name} {i.application.candidate.last_name}
                      </span>
                      <span className="block text-xs text-slate-500">{formatRange(i)}</span>
                    </span>
                    <InterviewStatusBadge status={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div role="tablist" aria-label="Interview views" className="flex gap-2">
          {(['calendar', 'list'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === t ? 'bg-navy-900 text-white' : 'border border-slate-200 bg-white text-navy-900 hover:bg-lavender-50'}`}
            >
              {t === 'calendar' ? 'Calendar' : 'All interviews'}
            </button>
          ))}
        </div>

        {tab === 'calendar' ? (
          week.error && !week.data ? (
            <Card>
              <ErrorState title="Couldn't load the calendar" message={week.error.message} onRetry={week.reload} />
            </Card>
          ) : (
            <Card className="p-5 sm:p-6">
              <InterviewCalendar
                weekStart={weekStart}
                today={todayKey}
                items={week.data?.items ?? []}
                loading={week.loading}
                onPrev={() => setWeekStart((w) => addDays(w, -7))}
                onNext={() => setWeekStart((w) => addDays(w, 7))}
                onToday={() => setWeekStart(startOfWeek(new Date()))}
              />
            </Card>
          )
        ) : (
          <Card>
            <InterviewFilters values={filters} onChange={changeFilters} />
            {list.loading && !list.data ? (
              <p className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
                <Spinner /> Loading interviews…
              </p>
            ) : list.error && !list.data ? (
              <ErrorState title="Couldn't load interviews" message={list.error.message} onRetry={list.reload} />
            ) : list.data && list.data.items.length === 0 ? (
              <EmptyState
                icon={<CalendarIcon className="size-7" />}
                title={activeFilterCount(filters) > 0 ? 'No interviews match' : 'No interviews yet'}
                description={activeFilterCount(filters) > 0 ? 'Try clearing a filter.' : 'Schedule the first interview from an application or with the button above.'}
                action={activeFilterCount(filters) > 0 ? <Button variant="secondary" onClick={() => changeFilters(emptyFilters)}>Clear filters</Button> : undefined}
              />
            ) : list.data ? (
              <>
                <InterviewTable items={list.data.items} />
                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  <span>
                    {list.data.total} interview{list.data.total === 1 ? '' : 's'}, in start-time order
                  </span>
                  <span className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                      <ChevronLeftIcon className="size-4" />
                    </Button>
                    Page {page} of {pages}
                    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                      <ChevronRightIcon className="size-4" />
                    </Button>
                  </span>
                </div>
              </>
            ) : null}
          </Card>
        )}
      </div>

      <ScheduleInterviewDialog open={scheduling} onClose={() => setScheduling(false)} onCreated={changed} />
    </>
  )
}

/** The day after `day`, so a "to" date includes the whole of that day. */
function addDaysText(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}
