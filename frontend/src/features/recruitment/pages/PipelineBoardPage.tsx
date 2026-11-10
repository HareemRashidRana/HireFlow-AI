import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { applicationsApi } from '../../../api/applications'
import { jobsApi } from '../../../api/jobs'
import { useAuth } from '../../../auth/useAuth'
import { PageHeader } from '../../../components/layout/PageHeader'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { ClipboardIcon, PlusIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import type { ApplicationListItem, ApplicationStage, Board } from '../../../types/application'
import type { CandidateSource } from '../../../types/candidate'
import { ApplicationFilters } from '../components/ApplicationFilters'
import type { FilterKey } from '../components/ApplicationFilters'
import { PipelineBoard } from '../components/PipelineBoard'
import type { ColumnExtra } from '../components/PipelineBoard'
import { ReopenDialog } from '../components/ReopenDialog'
import { StageChangeDialog } from '../components/StageChangeDialog'
import { cleanFilterValue, countActiveFilters, sharedFilterQuery } from '../lib/navContext'

type MoreColumn = ColumnExtra & { nextPage: number }

/** Extra pages of cards, valid only for the ONE board response they were loaded on top of. */
interface MoreState {
  board: Board
  columns: Partial<Record<ApplicationStage, MoreColumn>>
}

export function PipelineBoardPage() {
  const { can } = useAuth()
  const canWrite = can('recruitment:write')
  const [params, setParams] = useSearchParams()

  // Same filter names and rules as the Applications list, so the two views stay consistent. The
  // search text is NOT in the URL: it is usually a person's name or email.
  const job = cleanFilterValue('job', params.get('job'))
  const recruiter = cleanFilterValue('recruiter', params.get('recruiter'))
  const source = cleanFilterValue('source', params.get('source')) as CandidateSource | ''
  const from = cleanFilterValue('from', params.get('from'))
  const to = cleanFilterValue('to', params.get('to'))
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

  const filters = { q, job_id: job, recruiter_id: recruiter, source, applied_from: from, applied_to: to }
  const key = JSON.stringify(filters)
  const { data, error, loading, reload } = useQuery((signal) => applicationsApi.board(filters, signal), key)
  const jobs = useQuery((signal) => jobsApi.list({ page_size: 100 }, signal), 'jobs')
  const recruiters = useQuery((signal) => applicationsApi.recruiters(signal), 'recruiters')

  // "Load more" pages. They belong to ONE board response: when the board reloads (a filter changed,
  // an application moved) they are dropped, so a card can never show twice or in the wrong column.
  const [more, setMore] = useState<MoreState | null>(null)
  const activeMore: Partial<Record<ApplicationStage, MoreColumn>> =
    more && data && more.board === data ? more.columns : {}

  const loadMore = async (stage: ApplicationStage) => {
    if (!data) return
    const current = activeMore[stage]
    const page = current?.nextPage ?? 2
    const set = (patch: Partial<MoreColumn>) =>
      setMore((prev) => {
        const base = prev && prev.board === data ? prev.columns : {}
        const col: MoreColumn = base[stage] ?? {
          items: [],
          hasMore: data.columns[stage].has_more,
          loading: false,
          error: null,
          nextPage: 2,
        }
        return { board: data, columns: { ...base, [stage]: { ...col, ...patch } } }
      })
    set({ loading: true, error: null })
    try {
      const result = await applicationsApi.boardColumn(stage, {
        ...filters,
        page,
        page_size: data.per_column_limit,
      })
      const known = new Set([...data.columns[stage].items, ...(current?.items ?? [])].map((a) => a.id))
      set({
        items: [...(current?.items ?? []), ...result.items.filter((a) => !known.has(a.id))],
        hasMore: result.has_more,
        nextPage: page + 1,
        loading: false,
      })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Couldn't load more applications." })
    }
  }

  const [moving, setMoving] = useState<ApplicationListItem | null>(null)
  const [reopening, setReopening] = useState<ApplicationListItem | null>(null)

  const hasFilters = Boolean(q || job || recruiter || source || from || to)
  const clear = () => {
    setSearch('')
    setParams({}, { replace: true })
  }
  const total = data ? Object.values(data.columns).reduce((n, c) => n + c.total, 0) : 0
  const firstLoad = loading && !data

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Every application, by stage. Applications move one step at a time."
        actions={
          <>
            <Link
              to={`/recruitment/applications${sharedFilterQuery(params)}`}
              className={buttonClasses('secondary')}
            >
              <ClipboardIcon className="size-4" /> List view
            </Link>
            {canWrite && (
              <Link to="/recruitment/applications/new" className={buttonClasses('primary')}>
                <PlusIcon className="size-4" /> New application
              </Link>
            )}
          </>
        }
      />

      <Card className="mb-6 overflow-hidden">
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
          onFilterChange={(k: FilterKey, v) => update({ [k]: v })}
          onClear={clear}
          hasActiveFilters={hasFilters || search !== ''}
          activeCount={countActiveFilters({ job, recruiter, source, from, to }, search !== '')}
        />
        {data && (
          <p className="px-5 py-2.5 text-xs text-slate-500" aria-live="polite">
            {total} application{total === 1 ? '' : 's'}
            {hasFilters ? `${total === 1 ? ' matches' : ' match'} the current filters` : ' in the pipeline'}
          </p>
        )}
      </Card>

      {firstLoad && (
        <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
          <Spinner /> Loading the pipeline…
        </div>
      )}

      {!firstLoad && error && !data && (
        <Card>
          <ErrorState title="Couldn't load the pipeline" message={error.message} onRetry={reload} />
        </Card>
      )}

      {data && total === 0 && (
        <Card>
          <EmptyState
            icon={<ClipboardIcon className="size-7" />}
            title={hasFilters ? 'No applications match your filters' : 'No applications yet'}
            description={
              hasFilters
                ? 'Try a different search term or clear the filters.'
                : 'Applications appear here once a candidate is added to a job.'
            }
          />
        </Card>
      )}

      {data && total > 0 && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error.message}
              <button type="button" onClick={reload} className="font-medium underline">
                Retry
              </button>
            </div>
          )}
          <PipelineBoard
            board={data}
            extra={activeMore}
            onMove={setMoving}
            onReopen={setReopening}
            onLoadMore={(stage) => void loadMore(stage)}
          />
        </div>
      )}

      <StageChangeDialog application={moving} onClose={() => setMoving(null)} onChanged={reload} onStale={reload} />
      <ReopenDialog application={reopening} onClose={() => setReopening(null)} onChanged={reload} onStale={reload} />
    </>
  )
}
