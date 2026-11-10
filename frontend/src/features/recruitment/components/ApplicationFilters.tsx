import { SearchIcon } from '../../../components/ui/icons'
import type { Job } from '../../../types/job'
import type { StaffSummary } from '../../../types/application'
import type { CandidateSource } from '../../../types/candidate'
import { candidateSourceLabels, candidateSources } from '../lib/candidateOptions'

export type FilterKey = 'job' | 'recruiter' | 'source' | 'from' | 'to'

interface Props {
  search: string
  job: string
  recruiter: string
  source: CandidateSource | ''
  from?: string
  to?: string
  jobs: Pick<Job, 'id' | 'title'>[]
  recruiters: StaffSummary[]
  /** The board has no date filters. */
  showDates?: boolean
  onSearchChange: (value: string) => void
  onFilterChange: (key: FilterKey, value: string) => void
  onClear: () => void
  hasActiveFilters: boolean
  /** How many filters (including the search box) are in effect, for the indicator. */
  activeCount?: number
}

const selectClasses =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-navy-900 shadow-sm hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none'

export function ApplicationFilters({
  search,
  job,
  recruiter,
  source,
  from = '',
  to = '',
  jobs,
  recruiters,
  showDates = true,
  onSearchChange,
  onFilterChange,
  onClear,
  hasActiveFilters,
  activeCount,
}: Props) {
  return (
    <div
      role="search"
      aria-label="Filters"
      className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <div className="relative sm:col-span-2 xl:col-span-4">
        <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search candidate name, email or job title"
          aria-label="Search applications"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-24 pl-11 text-sm shadow-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none"
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="absolute top-1.5 right-1.5 h-8 rounded-lg px-2.5 text-xs font-medium text-lavender-600 hover:bg-lavender-100"
          >
            Clear{activeCount ? ` (${activeCount})` : ''}
          </button>
        )}
      </div>

      <select aria-label="Filter by job" value={job} onChange={(e) => onFilterChange('job', e.target.value)} className={selectClasses}>
        <option value="">All jobs</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by recruiter"
        value={recruiter}
        onChange={(e) => onFilterChange('recruiter', e.target.value)}
        className={selectClasses}
      >
        <option value="">Any recruiter</option>
        {recruiters.map((r) => (
          <option key={r.id} value={r.id}>
            {r.email}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by source"
        value={source}
        onChange={(e) => onFilterChange('source', e.target.value)}
        className={selectClasses}
      >
        <option value="">All sources</option>
        {candidateSources.map((s) => (
          <option key={s} value={s}>
            {candidateSourceLabels[s]}
          </option>
        ))}
      </select>

      {showDates && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            aria-label="Applied from"
            value={from}
            max={to || undefined}
            onChange={(e) => onFilterChange('from', e.target.value)}
            className={selectClasses}
          />
          <input
            type="date"
            aria-label="Applied to"
            value={to}
            min={from || undefined}
            onChange={(e) => onFilterChange('to', e.target.value)}
            className={selectClasses}
          />
        </div>
      )}
    </div>
  )
}
