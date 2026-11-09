import { employmentStatusLabels } from '../../../lib/format'
import type { EmploymentStatus } from '../../../types/employee'

const styles: Record<EmploymentStatus, { badge: string; dot: string }> = {
  active: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  inactive: { badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  terminated: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
}

export function StatusBadge({ status }: { status: EmploymentStatus }) {
  const s = styles[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${s.badge}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {employmentStatusLabels[status]}
    </span>
  )
}

export function TypeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-lavender-100 px-2.5 py-1 text-xs font-medium text-lavender-700 ring-1 ring-lavender-200 ring-inset">
      {label}
    </span>
  )
}
