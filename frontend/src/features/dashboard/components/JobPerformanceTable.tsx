import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyticsApi } from '../../../api/analytics'
import { Button } from '../../../components/ui/Button'
import { ErrorState } from '../../../components/ui/Feedback'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import type { AnalyticsParams, JobPerformance } from '../../../types/analytics'
import { formatPercent } from '../lib/dashboard'

const PAGE_SIZE = 8
const statusStyle: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-slate-100 text-slate-600',
  draft: 'bg-lavender-100 text-lavender-700',
  on_hold: 'bg-amber-50 text-amber-800',
}
const statusLabel = (s: string) => s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())

function Status({ value }: { value: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[value] ?? 'bg-slate-100 text-slate-600'}`}>{statusLabel(value)}</span>
}

function Row({ job }: { job: JobPerformance }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-6 py-3">
        <Link to={`/recruitment/jobs/${job.job_id}`} className="font-medium text-navy-900 hover:text-lavender-600">{job.title}</Link>
      </td>
      <td className="px-3 py-3 text-slate-600">{job.department}</td>
      <td className="px-3 py-3"><Status value={job.status} /></td>
      <td className="px-3 py-3 text-right tabular-nums">{job.applications}</td>
      <td className="px-3 py-3 text-right tabular-nums">{job.interviews}</td>
      <td className="px-3 py-3 text-right tabular-nums">{job.hired}</td>
      <td className="px-3 py-3 text-right tabular-nums">{job.rejected}</td>
      <td className="px-6 py-3 text-right tabular-nums">{formatPercent(job.conversion_rate)}</td>
    </tr>
  )
}

/**
 * One row per job, for applications received in the period. Has its own paging and retry. The
 * page mounts it with `key` = the filters, so new filters start again from page 1.
 */
export function JobPerformanceTable({ params }: { params: AnalyticsParams }) {
  const [page, setPage] = useState(1)
  const now = JSON.stringify(params)
  const { data, error, loading, reload } = useQuery(
    (s) => analyticsApi.jobs({ ...params, page, page_size: PAGE_SIZE }, s),
    `jobs-${now}-${page}`,
  )

  if (loading && !data)
    return (
      <p role="status" className="flex items-center gap-2 px-5 py-10 text-sm text-slate-500 sm:px-6">
        <Spinner className="size-4" /> Loading job performance…
      </p>
    )
  if (error && !data) return <ErrorState title="Couldn't load job performance" message={error.message} onRetry={reload} />
  if (!data || data.items.length === 0)
    return <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">No jobs match these filters.</p>

  const pages = Math.max(1, Math.ceil(data.total / data.page_size))
  return (
    <div aria-busy={loading}>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Applications, interviews and outcomes per job for this period</caption>
          <thead>
            <tr className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              <th scope="col" className="px-6 pb-2">Job</th>
              <th scope="col" className="px-3 pb-2">Department</th>
              <th scope="col" className="px-3 pb-2">Status</th>
              <th scope="col" className="px-3 pb-2 text-right">Applications</th>
              <th scope="col" className="px-3 pb-2 text-right">Interviews</th>
              <th scope="col" className="px-3 pb-2 text-right">Hired</th>
              <th scope="col" className="px-3 pb-2 text-right">Rejected</th>
              <th scope="col" className="px-6 pb-2 text-right">Conversion</th>
            </tr>
          </thead>
          <tbody>{data.items.map((j) => <Row key={j.job_id} job={j} />)}</tbody>
        </table>
      </div>
      <ul className="divide-y divide-slate-100 xl:hidden">
        {data.items.map((j) => (
          <li key={j.job_id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-2">
              <Link to={`/recruitment/jobs/${j.job_id}`} className="min-w-0 font-medium break-words text-navy-900">{j.title}</Link>
              <Status value={j.status} />
            </div>
            <p className="text-xs text-slate-500">{j.department}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {([['Applications', j.applications], ['Interviews', j.interviews], ['Hired', j.hired], ['Rejected', j.rejected]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-slate-500">{k}</dt><dd className="font-medium text-navy-900 tabular-nums">{v}</dd></div>
              ))}
              <div><dt className="text-slate-500">Conversion</dt><dd className="font-medium text-navy-900">{formatPercent(j.conversion_rate)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6">
        <span>{data.total} job{data.total === 1 ? '' : 's'}. Conversion is hired divided by applications received.</span>
        <span className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeftIcon className="size-4" /></Button>
          Page {page} of {pages}
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRightIcon className="size-4" /></Button>
        </span>
      </div>
    </div>
  )
}
