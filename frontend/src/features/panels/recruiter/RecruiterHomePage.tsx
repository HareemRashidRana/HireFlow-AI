import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyticsApi } from '../../../api/analytics'
import { interviewsApi } from '../../../api/interviews'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { FunnelChart } from '../../dashboard/components/FunnelChart'
import { browserZone, presetRange } from '../../dashboard/lib/dashboard'
import { PageHeader, Stat } from '../../workforce/components/Shared'
import { InterviewStatusBadge } from '../../recruitment/components/InterviewStatusBadge'
import { formatRange } from '../../recruitment/lib/interviews'

const links = [
  { to: '/recruitment/jobs', label: 'Job postings' },
  { to: '/recruitment/candidates', label: 'Candidates & resumes' },
  { to: '/recruitment/applications', label: 'Applications' },
  { to: '/recruitment/pipeline', label: 'Hiring pipeline' },
  { to: '/recruitment/interviews', label: 'Interviews' },
  { to: '/dashboard', label: 'Full recruitment analytics' },
]

/** Recruiter's landing page: the last 30 days of hiring, what is coming up, and the usual next steps. */
export function RecruiterHomePage() {
  const [params] = useState(() => ({ ...presetRange('30d', new Date()), timezone: browserZone() }))
  const [from] = useState(() => new Date().toISOString())
  const overview = useQuery((s) => analyticsApi.overview(params, s), 'recruiter-home-overview')
  const upcoming = useQuery((s) => interviewsApi.list({ starts_from: from, page_size: 12 }, s), 'recruiter-home-interviews')
  const next = (upcoming.data?.items ?? []).filter((i) => i.status === 'scheduled' || i.status === 'confirmed').slice(0, 5)
  const k = overview.data?.kpis

  return (
    <>
      <PageHeader title="Recruitment dashboard" subtitle="Your hiring over the last 30 days, and what is coming up." />
      <div className="space-y-6">
        {overview.error && !overview.data ? (
          <Card><ErrorState title="Couldn't load the numbers" message={overview.error.message} onRetry={overview.reload} /></Card>
        ) : !k ? (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading…</p>
        ) : (
          <dl aria-label="Recruitment figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open jobs" value={k.open_jobs} />
            <Stat label="New applications" value={k.total_applications} hint="Last 30 days" />
            <Stat label="Hires" value={k.hires} hint="Last 30 days" />
            <Stat label="Upcoming interviews" value={k.upcoming_interviews} />
          </dl>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Where applications are" />
            {overview.data ? <FunnelChart funnel={overview.data.funnel} /> : <p className="px-5 py-8 text-sm text-slate-500 sm:px-6">Loading…</p>}
          </Card>
          <Card>
            <CardHeader title="Next interviews" action={<Link to="/recruitment/interviews" className="text-sm font-medium text-lavender-700 underline">All interviews</Link>} />
            {upcoming.error && !upcoming.data ? (
              <ErrorState title="Couldn't load interviews" message={upcoming.error.message} onRetry={upcoming.reload} />
            ) : !upcoming.data ? (
              <p role="status" className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
            ) : next.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">No interviews are scheduled. Schedule one from an application.</p>
            ) : (
              <ul aria-label="Upcoming interviews" className="divide-y divide-slate-100">
                {next.map((i) => (
                  <li key={i.id}>
                    <Link to={`/recruitment/interviews/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-lavender-50/60 sm:px-6">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-navy-900">{i.title}: {i.application.candidate.first_name} {i.application.candidate.last_name}</span>
                        <span className="block text-xs text-slate-500">{formatRange(i)}</span>
                      </span>
                      <InterviewStatusBadge status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Go to" />
          <ul aria-label="Recruitment shortcuts" className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
            {links.map((l) => (
              <li key={l.to}><Link to={l.to} className="block px-5 py-3 text-sm font-medium text-navy-900 hover:bg-lavender-50/60 sm:px-6">{l.label}</Link></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
