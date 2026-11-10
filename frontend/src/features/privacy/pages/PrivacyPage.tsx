import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { privacyApi } from '../../../api/privacy'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { ChevronLeftIcon, ChevronRightIcon, ShieldIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatDate } from '../../../lib/format'
import type { RetentionItem, RetentionStatus } from '../../../types/privacy'
import { consentBasisLabels } from '../../recruitment/lib/candidateOptions'
import { AnonymizeDialog } from '../components/AnonymizeDialog'
import type { AnonymizeTarget } from '../components/AnonymizeDialog'
import { AuditList } from '../components/AuditList'
import { ExportDialog } from '../components/ExportDialog'
import type { ExportTarget } from '../components/ExportDialog'
import { PurgeDialog } from '../components/PurgeDialog'

const PAGE_SIZE = 10
const STATUSES: { value: RetentionStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'expired', label: 'Past retention' },
  { value: 'anonymized', label: 'Anonymized' },
]

const badge: Record<RetentionItem['status'], { label: string; cls: string }> = {
  active: { label: 'Within retention', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  expiring: { label: 'Expiring soon', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  expired: { label: 'Past retention', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  anonymized: { label: 'Anonymized', cls: 'bg-lavender-100 text-lavender-700 ring-lavender-200' },
}

function StatusBadge({ status }: { status: RetentionItem['status'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${badge[status].cls}`}
    >
      {badge[status].label}
    </span>
  )
}

function Tile({ label, value, hint, onClick, active }: { label: string; value: number; hint?: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</span>
      <span className="mt-1 block text-2xl font-semibold text-navy-900">{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </>
  )
  const cls = `rounded-2xl border bg-white px-4 py-3 text-left shadow-card sm:px-5 sm:py-4 ${active ? 'border-lavender-400 ring-2 ring-lavender-100' : 'border-slate-200/80'}`
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${cls} hover:border-lavender-300`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function PrivacyPage() {
  const [params, setParams] = useSearchParams()
  // Only non-sensitive state lives in the URL: which tab, which status, which page.
  const tab = params.get('tab') === 'audit' ? 'audit' : 'retention'
  const rawStatus = params.get('status') ?? 'all'
  const status: RetentionStatus = STATUSES.some((s) => s.value === rawStatus) ? (rawStatus as RetentionStatus) : 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)

  const update = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  const { data, error, loading, reload } = useQuery(
    (signal) => privacyApi.retention({ status, page, page_size: PAGE_SIZE }, signal),
    JSON.stringify({ status, page }),
    tab === 'retention',
  )

  const [anonymizing, setAnonymizing] = useState<AnonymizeTarget | null>(null)
  const [exporting, setExporting] = useState<ExportTarget | null>(null)
  const [purging, setPurging] = useState(false)

  const s = data?.summary
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const pick = (value: RetentionStatus) => update({ status: value === 'all' ? '' : value, page: '' })

  return (
    <>
      <PageHeader
        title="Privacy and retention"
        description={
          s
            ? `Candidate data is kept for ${s.retention_months} months after their last meaningful activity. Review what is due, export or anonymize it, and see who has accessed it.`
            : 'Review candidate retention, export or anonymize data, and see who has accessed it.'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setExporting({ kind: 'bulk' })}>
              Export candidates
            </Button>
            <Button variant="secondary" onClick={() => setPurging(true)}>
              Review expired
            </Button>
          </>
        }
      />

      <div role="tablist" aria-label="Privacy sections" className="mb-6 flex gap-1 border-b border-slate-200">
        {(['retention', 'audit'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => update({ tab: t === 'audit' ? 'audit' : '', status: '', page: '' })}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === t ? 'border-lavender-500 text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-900'
            }`}
          >
            {t === 'retention' ? 'Retention' : 'Audit log'}
          </button>
        ))}
      </div>

      {tab === 'audit' && (
        <Card className="overflow-hidden">
          <AuditList pageSize={15} />
        </Card>
      )}

      {tab === 'retention' && (
        <>
          {s && (
            <section aria-label="Retention overview" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <Tile label="Expiring soon" value={s.expiring} hint={`Within ${s.expiring_window_days} days`} onClick={() => pick('expiring')} active={status === 'expiring'} />
              <Tile label="Past retention" value={s.expired} hint="Due for review" onClick={() => pick('expired')} active={status === 'expired'} />
              <Tile label="Anonymized" value={s.anonymized} onClick={() => pick('anonymized')} active={status === 'anonymized'} />
              <Tile label="Eligible for deletion" value={s.purge_eligible} hint="Expired, no applications" />
            </section>
          )}

          <Card className="overflow-hidden">
            <div role="tablist" aria-label="Filter by retention status" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 pt-3">
              {STATUSES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  role="tab"
                  aria-selected={status === st.value}
                  onClick={() => pick(st.value)}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${
                    status === st.value ? 'border-lavender-500 text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-900'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {loading && !data && (
              <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
                <Spinner /> Loading retention data…
              </div>
            )}
            {error && !data && <ErrorState title="Couldn't load retention data" message={error.message} onRetry={reload} />}

            {data && (
              <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                {error && (
                  <div role="alert" className="flex items-center justify-between bg-rose-50 px-6 py-3 text-sm text-rose-700">
                    {error.message}
                    <Button size="sm" variant="secondary" onClick={reload}>
                      Retry
                    </Button>
                  </div>
                )}
                {data.items.length === 0 ? (
                  <EmptyState
                    icon={<ShieldIcon className="size-7" />}
                    title="Nobody here"
                    description={status === 'all' ? 'There are no candidates yet.' : 'No candidates are in this group.'}
                  />
                ) : (
                  <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium tracking-wide text-slate-500 uppercase">
                            <th className="px-4 py-3 font-medium xl:px-6">Candidate</th>
                            <th className="px-3 py-3 font-medium xl:px-4">Retention</th>
                            <th className="px-3 py-3 font-medium max-xl:hidden">Legal basis</th>
                            <th className="px-3 py-3 font-medium">Applications</th>
                            <th className="px-4 py-3 text-right font-medium xl:px-6">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.items.map((c) => (
                            <Row key={c.id} c={c} onExport={setExporting} onAnonymize={setAnonymizing} />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <ul className="divide-y divide-slate-100 md:hidden">
                      {data.items.map((c) => (
                        <li key={c.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link to={`/recruitment/candidates/${c.id}`} className="block truncate font-medium text-navy-900">
                                {c.first_name} {c.last_name}
                              </Link>
                              <span className="block truncate text-xs text-slate-500">{c.email}</span>
                            </div>
                            <StatusBadge status={c.status} />
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Until {formatDate(c.retain_until)} · {c.application_count} application{c.application_count === 1 ? '' : 's'}
                          </p>
                          <Actions c={c} onExport={setExporting} onAnonymize={setAnonymizing} />
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:px-6">
                      <span>{data.total} candidate{data.total === 1 ? '' : 's'}</span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                          <ChevronLeftIcon className="size-4" /> Previous
                        </Button>
                        <span className="px-1 text-xs">
                          Page {page} of {totalPages}
                        </span>
                        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
                          Next <ChevronRightIcon className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <AnonymizeDialog candidate={anonymizing} onClose={() => setAnonymizing(null)} onDone={reload} />
      <ExportDialog target={exporting} onClose={() => setExporting(null)} />
      <PurgeDialog open={purging} onClose={() => setPurging(false)} onDone={reload} />
    </>
  )
}

interface ActionProps {
  c: RetentionItem
  onExport: (t: ExportTarget) => void
  onAnonymize: (t: AnonymizeTarget) => void
}

function Actions({ c, onExport, onAnonymize }: ActionProps) {
  const name = `${c.first_name} ${c.last_name}`
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="secondary" aria-label={`Export ${name}`} onClick={() => onExport({ kind: 'one', id: c.id, label: name })}>
        Export
      </Button>
      {c.status !== 'anonymized' && (
        <Button size="sm" variant="secondary" aria-label={`Anonymize ${name}`} onClick={() => onAnonymize({ id: c.id, first_name: c.first_name, last_name: c.last_name })}>
          Anonymize
        </Button>
      )}
    </div>
  )
}

function Row({ c, onExport, onAnonymize }: ActionProps) {
  return (
    <tr>
      <td className="px-4 py-3.5 xl:px-6">
        <div className="flex items-center gap-3">
          <Avatar initials={`${c.first_name[0] ?? ''}${c.last_name[0] ?? ''}`.toUpperCase()} />
          <div className="min-w-0">
            <Link to={`/recruitment/candidates/${c.id}`} className="block truncate font-medium text-navy-900 hover:text-lavender-600">
              {c.first_name} {c.last_name}
            </Link>
            <span className="block max-w-48 truncate text-xs text-slate-500">{c.email}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-3.5 xl:px-4">
        <StatusBadge status={c.status} />
        <span className="mt-1 block text-xs text-slate-500">
          {c.anonymized_at ? `Anonymized ${formatDate(c.anonymized_at.slice(0, 10))}` : `Until ${formatDate(c.retain_until)}`}
        </span>
      </td>
      <td className="px-3 py-3.5 text-slate-700 max-xl:hidden">
        {consentBasisLabels[c.consent_basis]}
        <span className="block text-xs text-slate-500">since {formatDate(c.consent_date)}</span>
      </td>
      <td className="px-3 py-3.5 text-slate-700">{c.application_count}</td>
      <td className="px-4 py-3.5 xl:px-6">
        <Actions c={c} onExport={onExport} onAnonymize={onAnonymize} />
      </td>
    </tr>
  )
}
