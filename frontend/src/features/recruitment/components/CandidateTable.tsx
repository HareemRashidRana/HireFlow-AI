import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../../../components/ui/Avatar'
import { formatShortDate } from '../../../lib/format'
import type { CandidateListItem } from '../../../types/candidate'
import { candidateSourceLabels } from '../lib/candidateOptions'
import { RetentionBadge } from './RetentionBadge'

const detailPath = (c: CandidateListItem) => `/recruitment/candidates/${c.id}`
const initials = (c: CandidateListItem) => `${c.first_name[0] ?? ''}${c.last_name[0] ?? ''}`.toUpperCase()
const name = (c: CandidateListItem) => `${c.first_name} ${c.last_name}`
const role = (c: CandidateListItem) =>
  [c.current_title, c.current_company].filter(Boolean).join(' · ') || null

const none = <span className="text-slate-400">—</span>

export function CandidateTable({ candidates }: { candidates: CandidateListItem[] }) {
  const navigate = useNavigate()

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
              <th className="px-6 py-3 font-medium">Candidate</th>
              <th className="px-4 py-3 font-medium">Current role</th>
              <th className="px-4 py-3 font-medium max-xl:hidden">Location</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Retention</th>
              <th className="px-6 py-3 font-medium max-xl:hidden">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {candidates.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(detailPath(c))}
                className="cursor-pointer transition-colors hover:bg-lavender-50/60"
              >
                <td className="px-6 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar initials={initials(c)} />
                    <div className="min-w-0">
                      <Link
                        to={detailPath(c)}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate font-medium text-navy-900 hover:text-lavender-600"
                      >
                        {name(c)}
                      </Link>
                      <span className="block truncate text-xs text-slate-500">{c.email}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-slate-700">{role(c) ?? none}</td>
                <td className="px-4 py-3.5 text-slate-700 max-xl:hidden">{c.location ?? none}</td>
                <td className="px-4 py-3.5 text-slate-700">{candidateSourceLabels[c.source]}</td>
                <td className="px-4 py-3.5">
                  <RetentionBadge retainUntil={c.retain_until} />
                </td>
                <td className="px-6 py-3.5 whitespace-nowrap text-slate-600 max-xl:hidden">
                  {formatShortDate(c.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {candidates.map((c) => (
          <li key={c.id}>
            <Link to={detailPath(c)} className="block p-4 hover:bg-lavender-50/60">
              <div className="flex items-start gap-3">
                <Avatar initials={initials(c)} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-navy-900">{name(c)}</span>
                  <span className="block truncate text-xs text-slate-500">{role(c) ?? c.email}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">{candidateSourceLabels[c.source]}</span>
                <RetentionBadge retainUntil={c.retain_until} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
