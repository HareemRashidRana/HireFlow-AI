import type { EmploymentType } from '../../../types/employee'
import type { JobStatus } from '../../../types/job'
import { employmentTypeLabels } from '../../../lib/format'
import { jobStatusLabels } from '../lib/jobStatus'

const styles: Record<JobStatus, { badge: string; dot: string }> = {
  open: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  draft: { badge: 'bg-lavender-100 text-lavender-700 ring-lavender-200', dot: 'bg-lavender-500' },
  on_hold: { badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  closed: { badge: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = styles[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${s.badge}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {jobStatusLabels[status]}
    </span>
  )
}

export function JobTypeText({ type }: { type: EmploymentType }) {
  return <span>{employmentTypeLabels[type]}</span>
}
