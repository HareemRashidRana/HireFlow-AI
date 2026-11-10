import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { applicationsApi } from '../../../api/applications'
import { jobsApi } from '../../../api/jobs'
import { useAuth } from '../../../auth/useAuth'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  KanbanIcon,
  PlusIcon,
  SearchIcon,
} from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import type { ApplicationStage } from '../../../types/application'
import type { CandidateSource } from '../../../types/candidate'
import { ApplicationFilters } from '../components/ApplicationFilters'
import type { FilterKey } from '../components/ApplicationFilters'
import { ApplicationTable } from '../components/ApplicationTable'
import { allStages, isValidStage, stageLabels } from '../lib/applicationStages'
import { candidateSources } from '../lib/candidateOptions'
import { countActiveFilters, sharedFilterQuery } from '../lib/navContext'

const PAGE_SIZE = 10
const DATE = /^\d{4}-\d{2}-\d{2}$/

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card className="px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  )
}

export function ApplicationsPage() {
  const { can } = useAuth()
  const canWrite = can('recruitment:write')
  const [params, setParams] = useSearchParams()

  // Filters live in the URL (ids, enums and dates only). The search text does not: it is usually a
  // person's name or email, and personal data should not end up in the address bar or history.
  const rawStage = params.get('stage') ?? ''
  const stage: ApplicationStage | '' = isValidStage(rawStage) ? rawStage : ''
  const job = params.get('job') ?? ''
  const recruiter = params.get('recruiter') ?? ''
  const rawSource = params.get('source') ?? ''
  const source = (candidateSources as string[]).includes(rawSource) ? (rawSource as CandidateSource) : ''
  const from = DATE.test(params.get('from') ?? '') ? (params.get('from') as string) : ''
  const to = DATE.test(params.get('to') ?? '') ? (params.get('to') as string) : ''
  const page = Math.max(1, Number(params.get('page')) || 1)

  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim(), 300)

  const update = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  const previousQ = useRef(q)
  useEffect(() => {
    if (previousQ.current !== q) {
      previousQ.current = q
      update({ page: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const key = JSON.stringify({ q, stage, job, recruiter, source, from, to, page })
  const { data, error, loading, reload } = useQuery(
    (signal) =>
      applicationsApi.list(
        {
          q,
          stage,
          job_id: job,
          recruiter_id: recruiter,
          source,
          applied_from: from,
          applied_to: to,
          page,
          page_size: PAGE_SIZE,
        },
        signal,
      ),
    key,
  )

  // Supporting data: failures here only leave the pickers empty, they never block the list.
  const summary = useQuery((signal) => applicationsApi.summary(signal), 'summary')
  const jobs = useQuery((signal) => jobsApi.list({ page_size: 100 }, signal), 'jobs')
  const recruiters = useQuery((signal) => applicationsApi.recruiters(signal), 'recruiters')

  const hasFilters = Boolean(q || stage || job || recruiter || source || from || to)
  const clearFilters = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = data?.items ?? []
  const firstLoad = loading && !data
  const counts = data?.stage_counts
  const allCount = counts ? allStages.reduce((n, s) => n + counts[s], 0) : 0

  const addLink = (
    <Link to="/recruitment/applications/new" className={buttonClasses('primary')}>
      <PlusIcon className="size-4" /> New application
    </Link>
  )

  const s = summary.data
  const inPipeline = s ? s.by_stage.applied + s.by_stage.screening + s.by_stage.shortlisted + s.by_stage.interview + s.by_stage.offer : 0

  return (
    <>
      <PageHeader
        title="Applications"
        description="Candidates applying to your open jobs, and where each one stands."
        actions={
          <>
            <Link
              to={`/recruitment/pipeline${sharedFilterQuery(params)}`}
              className={buttonClasses('secondary')}
            >
              <KanbanIcon className="size-4" /> Pipeline board
            </Link>
            {canWrite && addLink}
          </>
        }
      />

      {s && (
        <section aria-label="Recruitment overview" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Stat label="Total applications" value={s.total} />
          <Stat label="In the pipeline" value={inPipeline} hint="Applied to offer" />
          <Stat label="Hired" value={s.hired} />
          <Stat label="Open jobs with applicants" value={s.open_jobs_with_applications} />
        </section>
      )}

      <Card className="overflow-hidden">
        {/* Applications grouped by stage. The counts follow the filters below. */}
        <div role="tablist" aria-label="Filter by stage" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 pt-3">
          {[{ value: '' as const, label: 'All', count: allCount }, ...allStages.map((st) => ({ value: st, label: stageLabels[st], count: counts?.[st] ?? 0 }))].map(
            (tab) => {
              const active = stage === tab.value
              return (
                <button
                  key={tab.value || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => update({ stage: tab.value, page: '' })}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'border-lavender-500 text-navy-900'
                      : 'border-transparent text-slate-500 hover:text-navy-900'
                  }`}
                >
                  {tab.label} <span className="ml-1 text-xs text-slate-400">{counts ? tab.count : ''}</span>
                </button>
              )
            },
          )}
        </div>

        <ApplicationFilters
          search={search}
          job={job}
          recruiter={recruiter}
          source={source}
          from={from}
          to={to}
          jobs={jobs.data?.items ?? []}
          recruiters={recruiters.data ?? []}
          onSearchChange={setSearch}
          onFilterChange={(k: FilterKey, v) => update({ [k]: v, page: '' })}
          onClear={clearFilters}
          hasActiveFilters={hasFilters || search !== ''}
          activeCount={countActiveFilters({ stage, job, recruiter, source, from, to }, search !== '')}
        />

        {firstLoad && (
          <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
            <Spinner /> Loading applications…
          </div>
        )}

        {!firstLoad && error && !data && (
          <ErrorState title="Couldn't load applications" message={error.message} onRetry={reload} />
        )}

        {!firstLoad && data && (
          <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {error && (
              <div className="flex items-center justify-between bg-rose-50 px-6 py-3 text-sm text-rose-700">
                {error.message}
                <Button size="sm" variant="secondary" onClick={reload}>
                  Retry
                </Button>
              </div>
            )}

            {items.length === 0 ? (
              hasFilters ? (
                <EmptyState
                  icon={<SearchIcon className="size-7" />}
                  title="No applications match your filters"
                  description="Try a different search term or clear the filters."
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<ClipboardIcon className="size-7" />}
                  title="No applications yet"
                  description={
                    canWrite
                      ? 'Add a candidate to one of your open jobs to start their application.'
                      : 'No applications have been created yet.'
                  }
                  action={canWrite ? addLink : undefined}
                />
              )
            ) : (
              <>
                <ApplicationTable applications={items} />
                <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:px-6">
                  <span>
                    Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + items.length} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                      <ChevronLeftIcon className="size-4" /> Previous
                    </Button>
                    <span className="px-1 text-xs">
                      Page {page} of {totalPages}
                    </span>
                    <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
                      Next <ChevronRightIcon className="size-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </>
  )
}
