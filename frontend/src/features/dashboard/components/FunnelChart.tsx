import type { FunnelStage } from '../../../types/analytics'
import { percentOf, stageLabels } from '../lib/dashboard'

const CLOSED = new Set(['hired', 'rejected', 'withdrawn'])
const BAR: Record<string, string> = { hired: 'bg-emerald-500', rejected: 'bg-rose-400', withdrawn: 'bg-slate-400' }

/**
 * Where applications are NOW (not how far they ever got), for those received in the period. Every
 * application is in exactly one row, so the rows add up to the total. Bars start at zero.
 */
export function FunnelChart({ funnel }: { funnel: FunnelStage[] }) {
  const total = funnel.reduce((n, f) => n + f.count, 0)
  const max = Math.max(...funnel.map((f) => f.count), 0)
  if (total === 0) return <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">No applications were received in this period.</p>
  return (
    <div className="p-5 sm:p-6">
      <ul aria-label="Applications by current stage" className="space-y-3">
        {funnel.map((f) => (
          <li key={f.stage} className="grid grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_6rem]">
            <span className="text-slate-600">{stageLabels[f.stage] ?? f.stage}</span>
            <span aria-hidden="true" className="h-3 overflow-hidden rounded-full bg-slate-100">
              <span
                className={`block h-full rounded-full ${BAR[f.stage] ?? 'bg-lavender-500'}`}
                style={{ width: `${max > 0 ? (f.count / max) * 100 : 0}%` }}
              />
            </span>
            <span className="text-right font-medium text-navy-900 tabular-nums">
              {f.count}
              <span className="ml-1.5 text-xs font-normal text-slate-500">{percentOf(f.count, total)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">
        {total} application{total === 1 ? '' : 's'} received in this period, each counted once at its current stage.
        {' '}Hired, rejected and withdrawn are final outcomes ({funnel.filter((f) => CLOSED.has(f.stage)).reduce((n, f) => n + f.count, 0)} so far).
      </p>
    </div>
  )
}
