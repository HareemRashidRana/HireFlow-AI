import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../../../components/ui/Avatar'
import { formatShortDate } from '../../../lib/format'
import type { ApplicationListItem } from '../../../types/application'
import { candidateSourceLabels } from '../lib/candidateOptions'
import { StageBadge } from './StageBadge'

const detailPath = (a: ApplicationListItem) => `/recruitment/applications/${a.id}`
const name = (a: ApplicationListItem) => `${a.candidate.first_name} ${a.candidate.last_name}`
const initials = (a: ApplicationListItem) =>
  `${a.candidate.first_name[0] ?? ''}${a.candidate.last_name[0] ?? ''}`.toUpperCase()

const none = <span className="text-slate-400">—</span>

export function ApplicationTable({ applications }: { applications: ApplicationListItem[] }) {
  const navigate = useNavigate()

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-3 font-medium xl:px-6">Candidate</th>
              <th className="px-3 py-3 font-medium xl:px-4">Job</th>
              <th className="px-3 py-3 font-medium xl:px-4">Stage</th>
              <th className="px-3 py-3 font-medium max-xl:hidden xl:px-4">Recruiter</th>
              <th className="px-3 py-3 font-medium max-xl:hidden xl:px-4">Source</th>
              <th className="px-4 py-3 font-medium xl:px-6">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {applications.map((a) => (
              <tr
                key={a.id}
                onClick={() => navigate(detailPath(a))}
                className="cursor-pointer transition-colors hover:bg-lavender-50/60"
              >
                <td className="px-4 py-3.5 xl:px-6">
                  <div className="flex items-center gap-3">
                    <Avatar initials={initials(a)} />
                    <div className="min-w-0">
                      <Link
                        to={detailPath(a)}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate font-medium text-navy-900 hover:text-lavender-600"
                      >
                        {name(a)}
                      </Link>
                      <span className="block truncate text-xs text-slate-500">{a.candidate.email}</span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3.5 text-slate-700 xl:px-4">
                  <span className="block max-w-36 truncate xl:max-w-56" title={a.job.title}>
                    {a.job.title}
                  </span>
                  <span className="block text-xs text-slate-500">{a.job.department}</span>
                </td>
                <td className="px-3 py-3.5 xl:px-4">
                  <StageBadge stage={a.stage} />
                </td>
                <td className="px-3 py-3.5 text-slate-700 max-xl:hidden xl:px-4">
                  {a.assigned_recruiter ? (
                    <span className="block max-w-44 truncate" title={a.assigned_recruiter.email}>
                      {a.assigned_recruiter.email}
                    </span>
                  ) : (
                    none
                  )}
                </td>
                <td className="px-3 py-3.5 text-slate-700 max-xl:hidden xl:px-4">{candidateSourceLabels[a.source]}</td>
                <td className="px-4 py-3.5 whitespace-nowrap text-slate-600 xl:px-6">{formatShortDate(a.applied_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {applications.map((a) => (
          <li key={a.id}>
            <Link to={detailPath(a)} className="block p-4 hover:bg-lavender-50/60">
              <div className="flex items-start gap-3">
                <Avatar initials={initials(a)} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-navy-900">{name(a)}</span>
                  <span className="block truncate text-xs text-slate-500">{a.job.title}</span>
                </div>
                <StageBadge stage={a.stage} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Applied {formatShortDate(a.applied_at)}
                {a.assigned_recruiter ? ` · ${a.assigned_recruiter.email}` : ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
