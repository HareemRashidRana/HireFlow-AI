import { useState } from 'react'
import { Link } from 'react-router-dom'
import { screeningApi } from '../../../api/screening'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { useQuery } from '../../../hooks/useQuery'
import { formatShortDate } from '../../../lib/format'
import { PRODUCT_NAME, jobStateLabels } from '../lib/coverage'

const PAGE_SIZE = 10

/**
 * Which applicants have a Requirements Coverage assessment, and whether it is current. It shows the
 * STATE only: no figure, no ordering by anything but the application date, and no filtering.
 */
export function JobCoverageOverview({ jobId }: { jobId: string }) {
  const { can } = useAuth()
  const allowed = can('screening:use')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useQuery(
    (s) => screeningApi.forJob(jobId, page, PAGE_SIZE, s),
    `coverage-job-${jobId}-${page}`,
    allowed,
  )
  if (!allowed) return null
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <Card>
      <CardHeader title={`${PRODUCT_NAME} status`} />
      <div className="p-5 sm:p-6">
        <p className="text-xs text-slate-500">
          Applicants are listed by application date. Only the status of each assessment is shown here, never a figure.
          Open an application to see its assessment.
        </p>
        {loading && !data ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : error && !data ? (
          <p role="alert" className="mt-4 text-sm text-rose-600">
            Couldn't load the status.{' '}
            <button type="button" onClick={reload} className="font-medium underline">
              Retry
            </button>
          </p>
        ) : data && data.items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No applications for this job yet.</p>
        ) : data ? (
          <>
            <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {data.items.map((i) => (
                <li key={i.application_id}>
                  <Link
                    to={`/recruitment/applications/${i.application_id}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-lavender-50/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-navy-900">{i.candidate_name}</span>
                      <span className="block text-xs text-slate-500">Applied {formatShortDate(i.applied_at)}</span>
                    </span>
                    <span className="text-xs text-slate-600">
                      {jobStateLabels[i.state]}
                      {i.assessment_count > 1 ? ` (${i.assessment_count} assessments)` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page} of {pages}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Card>
  )
}
