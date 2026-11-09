import { formatDate } from '../../../lib/format'
import { retentionState } from '../lib/retention'

const styles = {
  ok: 'bg-slate-100 text-slate-600 ring-slate-200',
  expiring: 'bg-amber-50 text-amber-700 ring-amber-200',
  expired: 'bg-rose-50 text-rose-700 ring-rose-200',
} as const

/** Where a candidate stands against their retention date. Takes `today` so it can be tested. */
export function RetentionBadge({ retainUntil, today }: { retainUntil: string; today?: Date }) {
  const state = retentionState(retainUntil, today)
  const label =
    state.kind === 'expired'
      ? 'Past retention date'
      : state.kind === 'expiring'
        ? `Review in ${state.daysLeft} ${state.daysLeft === 1 ? 'day' : 'days'}`
        : `Until ${formatDate(retainUntil)}`
  return (
    <span
      title={`Retention date: ${formatDate(retainUntil)}`}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${styles[state.kind]}`}
    >
      {label}
    </span>
  )
}
