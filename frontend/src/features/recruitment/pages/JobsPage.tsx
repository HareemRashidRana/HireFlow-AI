import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { jobsApi } from '../../../api/jobs'
import { useAuth } from '../../../auth/useAuth'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import {
  BriefcaseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
} from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import type { EmploymentType } from '../../../types/employee'
import type { JobStatus } from '../../../types/job'
import { JobFilters } from '../components/JobFilters'
import { JobTable } from '../components/JobTable'
import { jobStatuses } from '../lib/jobStatus'

const PAGE_SIZE = 10

export function JobsPage() {
  const { can } = useAuth()
  const canWrite = can('recruitment:write')
  const [params, setParams] = useSearchParams()

  // The URL is the source of truth for filters, so reload / back / shared links all work.
  const q = params.get('q') ?? ''
  const rawStatus = params.get('status') ?? ''
  const status = (jobStatuses as string[]).includes(rawStatus) ? (rawStatus as JobStatus) : ''
  const type = params.get('type') ?? ''
  const department = params.get('department') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)

  const [search, setSearch] = useState(q)
  const debouncedSearch = useDebounce(search.trim(), 300)

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

  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch, page: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const key = JSON.stringify({ q, status, type, department, page })
  const { data, error, loading, reload } = useQuery(
    (signal) =>
      jobsApi.list(
        { q, status, employment_type: type as EmploymentType | '', department, page, page_size: PAGE_SIZE },
        signal,
      ),
    key,
  )

  // Department names for the filter dropdown (jobs and employees combined).
  const departmentsQuery = useQuery((signal) => jobsApi.departments(signal), 'departments')
  const departments = departmentsQuery.data ?? []

  const hasActiveFilters = Boolean(q || status || type || department)
  const clearFilters = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = data?.items ?? []
  const firstLoad = loading && !data

  const newJobLink = (
    <Link to="/recruitment/jobs/new" className={buttonClasses('primary')}>
      <PlusIcon className="size-4" /> New job
    </Link>
  )

  return (
    <>
      <PageHeader
        title="Jobs"
        description={canWrite ? 'Create, publish and track your open positions.' : 'Browse your open positions.'}
        actions={canWrite ? newJobLink : undefined}
      />

      <Card className="overflow-hidden">
        <JobFilters
          filters={{ search, status, type, department }}
          departments={departments}
          counts={data?.status_counts ?? null}
          onSearchChange={setSearch}
          onFilterChange={(k, v) => update({ [k]: v, page: '' })}
          onClear={clearFilters}
          hasActiveFilters={hasActiveFilters || search !== ''}
        />

        {firstLoad && (
          <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
            <Spinner /> Loading jobs…
          </div>
        )}

        {!firstLoad && error && !data && (
          <ErrorState title="Couldn't load jobs" message={error.message} onRetry={reload} />
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
              hasActiveFilters ? (
                <EmptyState
                  icon={<SearchIcon className="size-7" />}
                  title="No jobs match your filters"
                  description="Try a different search term or clear the filters."
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<BriefcaseIcon className="size-7" />}
                  title="No jobs yet"
                  description={
                    canWrite
                      ? 'Create your first job posting to start building your pipeline.'
                      : 'No jobs have been created yet.'
                  }
                  action={canWrite ? newJobLink : undefined}
                />
              )
            ) : (
              <>
                <JobTable jobs={items} />
                <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:px-6">
                  <span>
                    Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + items.length} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page <= 1}
                      onClick={() => update({ page: String(page - 1) })}
                    >
                      <ChevronLeftIcon className="size-4" /> Previous
                    </Button>
                    <span className="px-1 text-xs">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page >= totalPages}
                      onClick={() => update({ page: String(page + 1) })}
                    >
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
