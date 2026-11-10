import { Button } from '../../../components/ui/Button'
import { formatShortDate } from '../../../lib/format'
import type { LeaveRequest } from '../../../types/workforce'
import { formatDays, formatRange } from '../lib/workforce'
import { StatusPill } from './Shared'

export type RowAction = 'approve' | 'reject' | 'withdraw' | 'cancel' | 'history'

const actionLabels: Record<string, string> = { approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw', cancel: 'Cancel leave' }

/**
 * Leave requests as a list. The buttons shown for each come from the server's `allowed_actions`, so
 * the screen never offers what the rules would refuse (for example approving your own request).
 */
export function LeaveRequestRows({
  items,
  showEmployee,
  busyId,
  onAction,
}: {
  items: LeaveRequest[]
  showEmployee: boolean
  busyId?: string | null
  onAction: (action: RowAction, request: LeaveRequest) => void
}) {
  return (
    <ul aria-label="Leave requests" className="divide-y divide-slate-100">
      {items.map((r) => (
        <li key={r.id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[1.1fr_1.3fr_6rem_8rem_auto] lg:items-center">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-navy-900">{showEmployee ? r.employee.name : r.leave_type.name}</span>
            <span className="block text-xs text-slate-500">
              {showEmployee ? `${r.leave_type.name}${r.leave_type.is_paid ? '' : ' (unpaid)'}` : `Requested ${formatShortDate(r.submitted_at)}`}
            </span>
          </span>
          <span className="min-w-0 text-sm text-slate-600">
            {formatRange(r.start_date, r.end_date)}
            {r.reason && <span className="mt-0.5 block truncate text-xs text-slate-500">&ldquo;{r.reason}&rdquo;</span>}
            {r.review_reason && (
              <span className="mt-0.5 block text-xs text-slate-500">
                {r.reviewer ? `${r.reviewer.email}: ` : ''}
                {r.review_reason}
              </span>
            )}
          </span>
          <span className="text-sm font-medium text-navy-900 tabular-nums">{formatDays(r.days)}</span>
          <span><StatusPill status={r.status} /></span>
          <span className="flex flex-wrap gap-2">
            {r.allowed_actions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'approve' ? 'primary' : a === 'reject' || a === 'cancel' ? 'secondary' : 'secondary'}
                loading={busyId === r.id && a === 'withdraw'}
                aria-label={`${actionLabels[a] ?? a}: ${r.employee.name}, ${formatRange(r.start_date, r.end_date)}`}
                onClick={() => onAction(a as RowAction, r)}
              >
                {actionLabels[a] ?? a}
              </Button>
            ))}
            <Button size="sm" variant="ghost" aria-label={`History: ${r.employee.name}, ${formatRange(r.start_date, r.end_date)}`} onClick={() => onAction('history', r)}>
              History
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}
