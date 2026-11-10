import { Input, Select } from '../../../components/ui/Field'
import type { InterviewStatus, InterviewType } from '../../../types/interview'
import { activeFilterCount, emptyFilters } from '../lib/interviewFilters'
import type { InterviewFilterValues } from '../lib/interviewFilters'
import { interviewStatuses, interviewTypes, statusLabels, typeLabels } from '../lib/interviews'

interface Props {
  values: InterviewFilterValues
  onChange: (next: InterviewFilterValues) => void
}

/** Search and narrow the list. There is deliberately no sort or filter by any rating. */
export function InterviewFilters({ values, onChange }: Props) {
  const set = <K extends keyof InterviewFilterValues>(key: K, value: InterviewFilterValues[K]) => onChange({ ...values, [key]: value })
  const count = activeFilterCount(values)
  return (
    <form role="search" aria-label="Filter interviews" onSubmit={(e) => e.preventDefault()} className="space-y-3 border-b border-slate-100 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Input label="Search" type="search" value={values.q} placeholder="Interview, candidate or job" onChange={(e) => set('q', e.target.value)} />
        </div>
        <Select label="Status" value={values.status} onChange={(e) => set('status', e.target.value as InterviewStatus | '')}>
          <option value="">All statuses</option>
          {interviewStatuses.map((s) => (
            <option key={s} value={s}>{statusLabels[s]}</option>
          ))}
        </Select>
        <Select label="Type" value={values.type} onChange={(e) => set('type', e.target.value as InterviewType | '')}>
          <option value="">All types</option>
          {interviewTypes.map((t) => (
            <option key={t} value={t}>{typeLabels[t]}</option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1">
          <Input label="From" type="date" value={values.from} onChange={(e) => set('from', e.target.value)} />
          <Input label="To" type="date" value={values.to} min={values.from || undefined} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-navy-900">
          <input type="checkbox" checked={values.mine} onChange={(e) => set('mine', e.target.checked)} className="size-4 accent-lavender-600" />
          Only interviews I am on
        </label>
        {count > 0 && (
          <button type="button" onClick={() => onChange(emptyFilters)} className="text-sm font-medium text-lavender-700 underline">
            Clear {count} filter{count === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </form>
  )
}
