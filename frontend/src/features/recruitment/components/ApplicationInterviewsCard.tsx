import { useState } from 'react'
import { Link } from 'react-router-dom'
import { interviewsApi } from '../../../api/interviews'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatRange, typeLabels } from '../lib/interviews'
import { InterviewStatusBadge } from './InterviewStatusBadge'
import { ScheduleInterviewDialog } from './ScheduleInterviewDialog'

interface Props {
  applicationId: string
  /** "Sana Iqbal, Backend Engineer" */
  label: string
  /** Hired, rejected and withdrawn applications take no new interviews. */
  closed: boolean
}

/** The interviews of this application. Scheduling one never changes the application's stage. */
export function ApplicationInterviewsCard({ applicationId, label, closed }: Props) {
  const { can } = useAuth()
  const allowed = can('interviews:use')
  const [scheduling, setScheduling] = useState(false)
  const { data, error, loading, reload } = useQuery((s) => interviewsApi.forApplication(applicationId, s), `app-interviews-${applicationId}`, allowed)
  if (!allowed) return null

  return (
    <Card>
      <CardHeader
        title="Interviews"
        action={
          <Button size="sm" variant="secondary" disabled={closed} onClick={() => setScheduling(true)}>
            Schedule interview
          </Button>
        }
      />
      <div className="p-5 sm:p-6">
        {closed && <p className="mb-3 text-xs text-slate-500">This application is closed, so no new interviews can be scheduled.</p>}
        {loading && !data ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="size-4" /> Loading interviews…
          </p>
        ) : error && !data ? (
          <p role="alert" className="text-sm text-rose-600">
            Couldn't load interviews.{' '}
            <button type="button" onClick={reload} className="font-medium underline">
              Retry
            </button>
          </p>
        ) : data && data.items.length === 0 ? (
          <p className="text-sm text-slate-500">No interviews scheduled yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {(data?.items ?? []).map((i) => (
              <li key={i.id}>
                <Link to={`/recruitment/interviews/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-lavender-50/60">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-navy-900">{i.title}</span>
                    <span className="block text-xs text-slate-500">
                      {typeLabels[i.interview_type]} · round {i.round_number} · {formatRange(i)}
                    </span>
                  </span>
                  <InterviewStatusBadge status={i.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ScheduleInterviewDialog open={scheduling} onClose={() => setScheduling(false)} onCreated={reload} applicationId={applicationId} applicationLabel={label} />
    </Card>
  )
}
