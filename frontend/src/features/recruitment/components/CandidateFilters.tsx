import { SearchIcon } from '../../../components/ui/icons'
import type { CandidateSource, RetentionFilter } from '../../../types/candidate'
import { candidateSourceLabels, candidateSources, retentionFilterLabels } from '../lib/candidateOptions'

interface Props {
  search: string
  source: CandidateSource | ''
  retention: RetentionFilter | ''
  onSearchChange: (value: string) => void
  onFilterChange: (key: 'source' | 'retention', value: string) => void
  onClear: () => void
  hasActiveFilters: boolean
}

const selectClasses =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-navy-900 shadow-sm hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none'

export function CandidateFilters({
  search,
  source,
  retention,
  onSearchChange,
  onFilterChange,
  onClear,
  hasActiveFilters,
}: Props) {
  return (
    <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_12rem_14rem]">
      <div className="relative sm:col-span-2 xl:col-span-1">
        <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name, email, role or company"
          aria-label="Search candidates"
          autoComplete="off"
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

      <select
        aria-label="Filter by retention"
        value={retention}
        onChange={(e) => onFilterChange('retention', e.target.value)}
        className={selectClasses}
      >
        <option value="">Any retention date</option>
        <option value="expiring">{retentionFilterLabels.expiring}</option>
        <option value="expired">{retentionFilterLabels.expired}</option>
      </select>
    </div>
  )
}
