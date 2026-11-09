import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { employeesApi } from '../../../api/employees'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon, UsersIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import { fullName } from '../../../lib/format'
import type { EmploymentStatus, EmploymentType } from '../../../types/employee'
import { DeleteEmployeeDialog } from '../components/DeleteEmployeeDialog'
import { EmployeeFilters } from '../components/EmployeeFilters'
import { EmployeeTable } from '../components/EmployeeTable'
import type { Employee } from '../../../types/employee'

const PAGE_SIZE = 10

export function EmployeesPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  // The URL is the source of truth for filters, so reload / back / shared links all work.
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
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
      employeesApi.list(
        {
          q,
          employment_status: status as EmploymentStatus | '',
          employment_type: type as EmploymentType | '',
          department,
          page,
          page_size: PAGE_SIZE,
        },
        signal,
      ),
    key,
  )

  // Remember every department we have seen so the dropdown doesn't shrink while filtering.
  const [seenDepartments, setSeenDepartments] = useState<string[]>([])
  useEffect(() => {
    if (!data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- accumulating options across responses
    setSeenDepartments((prev) => [...new Set([...prev, ...data.items.map((e) => e.department)])].sort())
  }, [data])
  const departments = useMemo(
    () => (department && !seenDepartments.includes(department) ? [...seenDepartments, department] : seenDepartments),
    [seenDepartments, department],
  )

  const [toDelete, setToDelete] = useState<Employee | null>(null)

  const hasActiveFilters = Boolean(q || status || type || department)
  const clearFilters = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = data?.items ?? []
  const firstLoad = loading && !data

  const handleDeleted = (e: Employee) => {
    toast.success(`${fullName(e)} was deleted.`)
    // If that was the last row on this page, step back one page.
    if (items.length === 1 && page > 1) update({ page: String(page - 1) })
    else reload()
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description="Browse, search and manage everyone in your organisation."
        actions={
          <Link to="/employees/new" className={buttonClasses('primary')}>
            <PlusIcon className="size-4" /> Add employee
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <EmployeeFilters
          filters={{ search, status, type, department }}
          departments={departments}
          onSearchChange={setSearch}
          onFilterChange={(k, v) => update({ [k]: v, page: '' })}
          onClear={clearFilters}
          hasActiveFilters={hasActiveFilters || search !== ''}
        />

        {firstLoad && (
          <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
            <Spinner /> Loading employees…
          </div>
        )}

        {!firstLoad && error && !data && (
          <ErrorState title="Couldn't load employees" message={error.message} onRetry={reload} />
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
                  title="No employees match your filters"
                  description="Try a different search term or clear the filters."
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<UsersIcon className="size-7" />}
                  title="No employees yet"
                  description="Add your first employee to start building your directory."
                  action={
                    <Link to="/employees/new" className={buttonClasses('primary')}>
                      <PlusIcon className="size-4" /> Add employee
                    </Link>
                  }
                />
              )
            ) : (
              <>
                <EmployeeTable employees={items} onDelete={setToDelete} />
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

      <DeleteEmployeeDialog employee={toDelete} onClose={() => setToDelete(null)} onDeleted={handleDeleted} />
    </>
  )
}
