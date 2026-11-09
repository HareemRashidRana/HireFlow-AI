import { SearchIcon } from '../../../components/ui/icons'
import { employmentTypeLabels, employmentTypes } from '../../../lib/format'
import type { JobStatus } from '../../../types/job'
import { jobStatusLabels, jobStatuses } from '../lib/jobStatus'

export interface JobFilterValues {
  search: string
  status: JobStatus | ''
  type: string
  department: string
}

interface Props {
  filters: JobFilterValues
  departments: string[]
  /** Jobs per status under the current filters (ignoring the status itself). */
  counts: Record<JobStatus, number> | null
  onSearchChange: (value: string) => void
  onFilterChange: (key: 'status' | 'type' | 'department', value: string) => void
  onClear: () => void
  hasActiveFilters: boolean
}

const selectClasses =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-navy-900 shadow-sm hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none'

export function JobFilters({
  filters,
  departments,
  counts,
  onSearchChange,
  onFilterChange,
  onClear,
  hasActiveFilters,
}: Props) {
  const all = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null
  const tabs: { value: JobStatus | ''; label: string; count: number | null }[] = [
    { value: '', label: 'All', count: all },
    ...jobStatuses.map((s) => ({ value: s, label: jobStatusLabels[s], count: counts ? counts[s] : null })),
  ]

  return (
    <div className="border-b border-slate-100">
      <div role="group" aria-label="Filter by status" className="flex gap-1 overflow-x-auto px-4 pt-3">
        {tabs.map((tab) => {
          const active = filters.status === tab.value
          return (
            <button
              key={tab.value || 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange('status', tab.value)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-lavender-100 text-lavender-700' : 'text-slate-500 hover:bg-slate-50 hover:text-navy-900'
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    active ? 'bg-white text-lavender-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_12rem_12rem]">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-5 text-slate-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search title, department or location"
            aria-label="Search jobs"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-16 pl-11 text-sm shadow-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none"
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClear}
              className="absolute top-1.5 right-1.5 h-8 rounded-lg px-2.5 text-xs font-medium text-lavender-600 hover:bg-lavender-100"
            >
              Clear
            </button>
          )}
        </div>

        <select
          aria-label="Filter by employment type"
          value={filters.type}
          onChange={(e) => onFilterChange('type', e.target.value)}
          className={selectClasses}
        >
          <option value="">All types</option>
          {employmentTypes.map((t) => (
            <option key={t} value={t}>
              {employmentTypeLabels[t]}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by department"
          value={filters.department}
          onChange={(e) => onFilterChange('department', e.target.value)}
          className={selectClasses}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
