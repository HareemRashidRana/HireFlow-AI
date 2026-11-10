import type { FilterOptions } from '../../../types/analytics'
import { Button } from '../../../components/ui/Button'
import { controlClasses } from '../../../components/ui/fieldStyles'
import { presetLabels, rangeProblem } from '../lib/dashboard'
import type { DashboardFilterValues, Preset } from '../lib/dashboard'

const fieldClasses = controlClasses(false)
const labelClass = 'mb-1 block text-xs font-medium text-slate-600'

/** Every control here changes what the dashboard requests. Nothing is decorative. */
export function DashboardFilters({
  values,
  options,
  onChange,
  onReset,
  dirty,
}: {
  values: DashboardFilterValues
  options: FilterOptions | null
  onChange: (next: DashboardFilterValues) => void
  onReset: () => void
  dirty: boolean
}) {
  const set = (patch: Partial<DashboardFilterValues>) => onChange({ ...values, ...patch })
  const problem = values.preset === 'custom' ? rangeProblem(values.start, values.end) : null
  const jobs = (options?.jobs ?? []).filter((j) => !values.department || j.department === values.department)
  return (
    <form role="search" aria-label="Dashboard filters" onSubmit={(e) => e.preventDefault()} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="dash-range" className={labelClass}>Period</label>
          <select id="dash-range" className={fieldClasses} value={values.preset} onChange={(e) => set({ preset: e.target.value as Preset })}>
            {(Object.keys(presetLabels) as Preset[]).map((p) => <option key={p} value={p}>{presetLabels[p]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dash-dept" className={labelClass}>Department</label>
          <select
            id="dash-dept"
            className={fieldClasses}
            value={values.department}
            onChange={(e) => {
              const department = e.target.value
              const stillValid = !values.job_id || !department || options?.jobs.find((j) => j.id === values.job_id)?.department === department
              set({ department, job_id: stillValid ? values.job_id : '' })
            }}
          >
            <option value="">All departments</option>
            {(options?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="dash-job" className={labelClass}>Job</label>
          <select id="dash-job" className={fieldClasses} value={values.job_id} onChange={(e) => set({ job_id: e.target.value })}>
            <option value="">All jobs</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        {values.preset === 'custom' && (
          <>
            <div>
              <label htmlFor="dash-from" className={labelClass}>From</label>
              <input id="dash-from" type="date" className={fieldClasses} value={values.start} onChange={(e) => set({ start: e.target.value })} />
            </div>
            <div>
              <label htmlFor="dash-to" className={labelClass}>To</label>
              <input id="dash-to" type="date" className={fieldClasses} value={values.end} onChange={(e) => set({ end: e.target.value })} />
            </div>
          </>
        )}
      </div>
      {problem && <p role="alert" className="mt-3 text-sm text-rose-600">{problem}</p>}
      {dirty && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onReset}>Reset filters</Button>
        </div>
      )}
    </form>
  )
}
