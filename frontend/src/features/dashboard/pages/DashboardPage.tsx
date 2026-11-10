import { useMemo, useState } from 'react'
import { analyticsApi } from '../../../api/analytics'
import { useAuth } from '../../../auth/useAuth'
import { roleLabels } from '../../../auth/permissions'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import type { AnalyticsParams } from '../../../types/analytics'
import { DashboardFilters } from '../components/DashboardFilters'
import { InterviewPanel, RecentActivity, SourcePanel, TimeToHirePanel } from '../components/BreakdownPanels'
import { FunnelChart } from '../components/FunnelChart'
import { JobPerformanceTable } from '../components/JobPerformanceTable'
import { KpiCards, KpiSkeleton } from '../components/KpiCards'
import { TrendChart } from '../components/TrendChart'
import { WorkforcePanel } from '../components/WorkforcePanel'
import { browserZone, longDay, presetLabels, presetRange, rangeProblem } from '../lib/dashboard'
import type { DashboardFilterValues } from '../lib/dashboard'

const initial = (): DashboardFilterValues => ({ preset: '30d', start: '', end: '', job_id: '', department: '' })

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** The HR dashboard: real recruitment numbers from /analytics, refreshed whenever a filter changes. */
export function DashboardPage() {
  const { user, can } = useAuth()
  const [filters, setFilters] = useState<DashboardFilterValues>(initial)
  const [timezone] = useState(browserZone)
  const [today] = useState(() => new Date())
  const [hello] = useState(greeting)

  const problem = filters.preset === 'custom' ? rangeProblem(filters.start, filters.end) : null
  const params: AnalyticsParams = useMemo(() => {
    const range = filters.preset === 'custom' ? { start: filters.start, end: filters.end } : presetRange(filters.preset, today)
    return { ...range, timezone, job_id: filters.job_id || undefined, department: filters.department || undefined }
  }, [filters, timezone, today])
  const key = JSON.stringify(params)

  const options = useQuery((s) => analyticsApi.filterOptions(s), 'analytics-options')
  const overview = useQuery((s) => analyticsApi.overview(params, s), `overview-${key}`, problem === null)

  const data = overview.data
  const periodText = data ? `${longDay(data.period.start)} to ${longDay(data.period.end)}` : presetLabels[filters.preset]
  const dirty = JSON.stringify(filters) !== JSON.stringify(initial())

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          {hello}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Recruitment overview for {user ? roleLabels[user.role] : 'your team'}
          {user ? ` (${user.email})` : ''}. Every figure comes from your live HireFlow records.
        </p>
      </div>

      <div className="space-y-6">
        <DashboardFilters values={filters} options={options.data} onChange={setFilters} onReset={() => setFilters(initial())} dirty={dirty} />

        {problem ? null : overview.error && !data ? (
          <Card>
            <ErrorState title="Couldn't load the dashboard" message={overview.error.message} onRetry={overview.reload} />
          </Card>
        ) : !data ? (
          <>
            <KpiSkeleton />
            <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="size-4" /> Loading the dashboard…
            </p>
          </>
        ) : (
          <div aria-busy={overview.loading} className={overview.loading ? 'space-y-6 opacity-70 transition-opacity' : 'space-y-6'}>
            {overview.error && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                Couldn&apos;t refresh these figures, so the previous ones are still shown.{' '}
                <Button variant="secondary" size="sm" onClick={overview.reload}>Retry</Button>
              </p>
            )}
            <p className="text-xs text-slate-500">
              Showing {periodText} ({data.period.timezone}). Figures marked &ldquo;Right now&rdquo; ignore the period.
            </p>
            <KpiCards kpis={data.kpis} period="This period" />

            {can('workforce:manage') && <WorkforcePanel />}

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Recruitment funnel" />
                <FunnelChart funnel={data.funnel} />
              </Card>
              <Card>
                <CardHeader title="Applications, interviews and hires" />
                <TrendChart points={data.trends} granularity={data.period.granularity} />
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader title="Interviews" />
                <InterviewPanel data={data.interviews} upcoming={data.kpis.upcoming_interviews} />
              </Card>
              <Card>
                <CardHeader title="Where applications come from" />
                <SourcePanel sources={data.sources} />
              </Card>
              <Card>
                <CardHeader title="Time to hire" />
                <TimeToHirePanel data={data.time_to_hire} />
              </Card>
            </div>

            <Card>
              <CardHeader title="Job performance" />
              <JobPerformanceTable key={key} params={params} />
            </Card>

            <Card>
              <CardHeader title="Recent recruitment activity" />
              <RecentActivity items={data.recent_activity} />
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
