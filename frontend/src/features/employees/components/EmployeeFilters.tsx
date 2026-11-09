import { SearchIcon } from '../../../components/ui/icons'
import {
  employmentStatuses,
  employmentStatusLabels,
  employmentTypeLabels,
  employmentTypes,
} from '../../../lib/format'

export interface Filters {
  search: string
  status: string
  type: string
  department: string
}

interface Props {
  filters: Filters
  departments: string[]
  onSearchChange: (value: string) => void
  onFilterChange: (key: 'status' | 'type' | 'department', value: string) => void
  onClear: () => void
  hasActiveFilters: boolean
}

const selectClasses =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-navy-900 shadow-sm hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none'

export function EmployeeFilters({
  filters,
  departments,
  onSearchChange,
  onFilterChange,
  onClear,
  hasActiveFilters,
}: Props) {
  return (
    <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3 xl:grid-cols-[1fr_repeat(3,10rem)]">
      <div className="relative sm:col-span-3 xl:col-span-1">
        <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-5 text-slate-400" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name, email or ID"
          aria-label="Search employees"
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
        aria-label="Filter by status"
        value={filters.status}
        onChange={(e) => onFilterChange('status', e.target.value)}
        className={selectClasses}
      >
        <option value="">All statuses</option>
        {employmentStatuses.map((s) => (
          <option key={s} value={s}>
            {employmentStatusLabels[s]}
          </option>
        ))}
      </select>

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
  )
}
