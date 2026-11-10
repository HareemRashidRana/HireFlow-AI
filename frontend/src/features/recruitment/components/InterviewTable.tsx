import { Link } from 'react-router-dom'
import type { Interview } from '../../../types/interview'
import { formatRange, modeLabels, typeLabels } from '../lib/interviews'
import { InterviewStatusBadge } from './InterviewStatusBadge'

/** One row per interview, in start-time order as the server returned them. */
export function InterviewTable({ items }: { items: Interview[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">When</th>
              <th scope="col" className="px-3 py-3 font-medium">Interview</th>
              <th scope="col" className="px-3 py-3 font-medium">Candidate</th>
              <th scope="col" className="px-3 py-3 font-medium">Interviewers</th>
              <th scope="col" className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((i) => (
              <tr key={i.id} className="hover:bg-lavender-50/50">
                <td className="px-5 py-3 whitespace-nowrap text-slate-700">{formatRange(i)}</td>
                <td className="px-3 py-3">
                  <Link to={`/recruitment/interviews/${i.id}`} className="font-medium text-navy-900 hover:text-lavender-600">
                    {i.title}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {typeLabels[i.interview_type]} · round {i.round_number} · {modeLabels[i.mode]}
                  </span>
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {i.application.candidate.first_name} {i.application.candidate.last_name}
                  <span className="block text-xs text-slate-500">{i.application.job.title}</span>
                </td>
                <td className="px-3 py-3 text-xs text-slate-600">{i.interviewers.map((x) => x.email).join(', ')}</td>
                <td className="px-5 py-3">
                  <InterviewStatusBadge status={i.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-slate-100 md:hidden">
        {items.map((i) => (
          <li key={i.id}>
            <Link to={`/recruitment/interviews/${i.id}`} className="block space-y-1 px-5 py-4 hover:bg-lavender-50/50">
              <span className="flex items-start justify-between gap-3">
                <span className="font-medium text-navy-900">{i.title}</span>
                <InterviewStatusBadge status={i.status} />
              </span>
              <span className="block text-sm text-slate-700">
                {i.application.candidate.first_name} {i.application.candidate.last_name} · {i.application.job.title}
              </span>
              <span className="block text-xs text-slate-500">{formatRange(i)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
