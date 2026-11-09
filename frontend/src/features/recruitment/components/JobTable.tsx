import { Link, useNavigate } from 'react-router-dom'
import { employmentTypeLabels, formatShortDate, fullName } from '../../../lib/format'
import type { Job } from '../../../types/job'
import { JobStatusBadge } from './JobStatusBadge'

const posted = (job: Job) => (job.opened_at ? formatShortDate(job.opened_at) : 'Not published')
const detailPath = (job: Job) => `/recruitment/jobs/${job.id}`

export function JobTable({ jobs }: { jobs: Job[] }) {
  const navigate = useNavigate()

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
              <th className="px-6 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium max-xl:hidden">Openings</th>
              <th className="px-4 py-3 font-medium max-xl:hidden">Hiring manager</th>
              <th className="px-6 py-3 font-medium max-lg:hidden">Posted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <tr
                key={job.id}
                onClick={() => navigate(detailPath(job))}
                className="cursor-pointer transition-colors hover:bg-lavender-50/60"
              >
                <td className="px-6 py-3.5">
                  <Link
                    to={detailPath(job)}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium text-navy-900 hover:text-lavender-600"
                  >
                    {job.title}
                  </Link>
                  <span className="block truncate text-xs text-slate-500">{job.location}</span>
                </td>
                <td className="px-4 py-3.5 text-slate-700">{job.department}</td>
                <td className="px-4 py-3.5 text-slate-700">{employmentTypeLabels[job.employment_type]}</td>
                <td className="px-4 py-3.5">
                  <JobStatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3.5 text-slate-700 max-xl:hidden">{job.openings}</td>
                <td className="px-4 py-3.5 text-slate-700 max-xl:hidden">
                  {job.hiring_manager ? fullName(job.hiring_manager) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-6 py-3.5 whitespace-nowrap text-slate-600 max-lg:hidden">{posted(job)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link to={detailPath(job)} className="block p-4 hover:bg-lavender-50/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate font-medium text-navy-900">{job.title}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {job.department} · {job.location}
                  </span>
                </div>
                <JobStatusBadge status={job.status} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {employmentTypeLabels[job.employment_type]} · {job.openings}{' '}
                {job.openings === 1 ? 'opening' : 'openings'}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
