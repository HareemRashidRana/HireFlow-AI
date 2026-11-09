import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { candidatesApi } from '../../../api/candidates'
import { useAuth } from '../../../auth/useAuth'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { ChevronLeftIcon, ChevronRightIcon, ContactIcon, PlusIcon, SearchIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import type { CandidateSource, RetentionFilter } from '../../../types/candidate'
import { CandidateFilters } from '../components/CandidateFilters'
import { CandidateTable } from '../components/CandidateTable'
import { candidateSources } from '../lib/candidateOptions'

const PAGE_SIZE = 10

export function CandidatesPage() {
  const { can } = useAuth()
  const canWrite = can('recruitment:write')
  const [params, setParams] = useSearchParams()

  // Filters live in the URL (so reload and links work), EXCEPT the search text: it is usually a
  // person's name or email, and personal data should not end up in the address bar or history.
  const rawSource = params.get('source') ?? ''
  const source = (candidateSources as string[]).includes(rawSource) ? (rawSource as CandidateSource) : ''
  const rawRetention = params.get('retention') ?? ''
  const retention: RetentionFilter | '' =
    rawRetention === 'expiring' || rawRetention === 'expired' ? rawRetention : ''
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

  // A new search starts again from page 1 (but a deep link to page 2 must keep working).
  const previousQ = useRef(q)
  useEffect(() => {
    if (previousQ.current !== q) {
      previousQ.current = q
      update({ page: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const key = JSON.stringify({ q, source, retention, page })
  const { data, error, loading, reload } = useQuery(
    (signal) => candidatesApi.list({ q, source, retention, page, page_size: PAGE_SIZE }, signal),
    key,
  )

  const hasActiveFilters = Boolean(q || source || retention)
  const clearFilters = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = data?.items ?? []
  const firstLoad = loading && !data

  const addLink = (
    <Link to="/recruitment/candidates/new" className={buttonClasses('primary')}>
      <PlusIcon className="size-4" /> Add candidate
    </Link>
  )

  return (
    <>
      <PageHeader
        title="Candidates"
        description={
          canWrite ? 'People who may join your team. Kept separate from your employees.' : 'People who may join your team.'
        }
        actions={canWrite ? addLink : undefined}
      />

      <Card className="overflow-hidden">
        <CandidateFilters
          search={search}
          source={source}
          retention={retention}
          onSearchChange={setSearch}
          onFilterChange={(k, v) => update({ [k]: v, page: '' })}
          onClear={clearFilters}
          hasActiveFilters={hasActiveFilters || search !== ''}
        />

        {firstLoad && (
          <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
            <Spinner /> Loading candidates…
          </div>
        )}

        {!firstLoad && error && !data && (
          <ErrorState title="Couldn't load candidates" message={error.message} onRetry={reload} />
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
                  title="No candidates match your filters"
                  description="Try a different search term or clear the filters."
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<ContactIcon className="size-7" />}
                  title="No candidates yet"
                  description={
                    canWrite ? 'Add your first candidate to start building your talent pool.' : 'No candidates have been added yet.'
                  }
                  action={canWrite ? addLink : undefined}
                />
              )
            ) : (
              <>
                <CandidateTable candidates={items} />
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
