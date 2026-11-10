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
import type { ApplicationListItem } from '../../../types/application'
import type { CandidateSource } from '../../../types/candidate'
import { ApplicationFilters } from '../components/ApplicationFilters'
import type { FilterKey } from '../components/ApplicationFilters'
import { PipelineBoard } from '../components/PipelineBoard'
import { ReopenDialog } from '../components/ReopenDialog'
import { StageChangeDialog } from '../components/StageChangeDialog'
import { candidateSources } from '../lib/candidateOptions'

export function PipelineBoardPage() {
  const { can } = useAuth()
  const canWrite = can('recruitment:write')
  const [params, setParams] = useSearchParams()

  // As on the Applications page: ids and enums in the URL, never the search text.
  const job = params.get('job') ?? ''
  const recruiter = params.get('recruiter') ?? ''
  const rawSource = params.get('source') ?? ''
  const source = (candidateSources as string[]).includes(rawSource) ? (rawSource as CandidateSource) : ''
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

  const key = JSON.stringify({ q, job, recruiter, source })
  const { data, error, loading, reload } = useQuery(
    (signal) => applicationsApi.board({ q, job_id: job, recruiter_id: recruiter, source }, signal),
    key,
  )
  const jobs = useQuery((signal) => jobsApi.list({ page_size: 100 }, signal), 'jobs')
  const recruiters = useQuery((signal) => applicationsApi.recruiters(signal), 'recruiters')

  const [moving, setMoving] = useState<ApplicationListItem | null>(null)
  const [reopening, setReopening] = useState<ApplicationListItem | null>(null)

  const hasFilters = Boolean(q || job || recruiter || source)
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
            <Link to="/recruitment/applications" className={buttonClasses('secondary')}>
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
          jobs={jobs.data?.items ?? []}
          recruiters={recruiters.data ?? []}
          showDates={false}
          onSearchChange={setSearch}
          onFilterChange={(k: FilterKey, v) => update({ [k]: v })}
          onClear={clear}
          hasActiveFilters={hasFilters || search !== ''}
        />
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
            <div role="alert" className="mb-4 flex items-center justify-between rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error.message}
              <button type="button" onClick={reload} className="font-medium underline">
                Retry
              </button>
            </div>
          )}
          <PipelineBoard board={data} onMove={setMoving} onReopen={setReopening} />
        </div>
      )}

      <StageChangeDialog application={moving} onClose={() => setMoving(null)} onChanged={reload} onStale={reload} />
      <ReopenDialog application={reopening} onClose={() => setReopening(null)} onChanged={reload} onStale={reload} />
    </>
  )
}
