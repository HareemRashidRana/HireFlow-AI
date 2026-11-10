import { useState } from 'react'
import { Link } from 'react-router-dom'
import { privacyApi } from '../../../api/privacy'
import { Button } from '../../../components/ui/Button'
import { EmptyState, ErrorState } from '../../../components/ui/Feedback'
import { ChevronLeftIcon, ChevronRightIcon, ShieldIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { AuditEventType } from '../../../types/privacy'
import { auditEventLabels, auditEventTypes, describeAudit } from '../lib/audit'

interface Props {
  /** Show one candidate's trail (compact), or everyone's with a type filter. */
  candidateId?: string
  pageSize?: number
}

const selectClasses =
  'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-navy-900 shadow-sm focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none'

/**
 * Who did what to candidate data, newest first. The trail holds no personal data, only ids, field
 * names and counts, so it is safe to show to HR and administrators.
 */
export function AuditList({ candidateId, pageSize = 10 }: Props) {
  const [page, setPage] = useState(1)
  const [type, setType] = useState<AuditEventType | ''>('')
  const { data, error, loading, reload } = useQuery(
    (signal) => privacyApi.audit({ candidate_id: candidateId, event_type: type, page, page_size: pageSize }, signal),
    JSON.stringify({ candidateId, type, page, pageSize }),
  )

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  return (
    <div>
      {!candidateId && (
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <select
            aria-label="Filter by event"
            value={type}
            onChange={(e) => {
              setType(e.target.value as AuditEventType | '')
              setPage(1)
            }}
            className={selectClasses}
          >
            <option value="">All events</option>
            {auditEventTypes.map((t) => (
              <option key={t} value={t}>
                {auditEventLabels[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
          <Spinner /> Loading audit history…
        </div>
      )}
      {error && !data && <ErrorState title="Couldn't load the audit history" message={error.message} onRetry={reload} />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={<ShieldIcon className="size-7" />}
          title="No audit events"
          description={type ? 'Nothing matches this filter.' : 'Nothing has been recorded yet.'}
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ol aria-label="Audit history" className="divide-y divide-slate-100">
            {data.items.map((e) => (
              <li key={e.id} className="px-4 py-3.5 sm:px-6">
                <p className="text-sm font-medium text-navy-900">{describeAudit(e)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
                  {' · '}
                  {e.actor ? e.actor.email : 'a removed user'}
                  {!candidateId && e.candidate_id && (
                    <>
                      {' · '}
                      {e.event_type === 'candidate_purged' || e.event_type === 'candidate_deleted' ? (
                        <span title="This candidate no longer exists">Candidate {e.candidate_id.slice(0, 8)}</span>
                      ) : (
                        <Link
                          to={`/recruitment/candidates/${e.candidate_id}`}
                          className="font-medium text-lavender-600 hover:underline"
                        >
                          Candidate {e.candidate_id.slice(0, 8)}
                        </Link>
                      )}
                    </>
                  )}
                  {e.request_id && <span className="text-slate-400"> · ref {e.request_id.slice(0, 8)}</span>}
                </p>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:px-6">
            <span>{data.total} event{data.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon className="size-4" /> Previous
              </Button>
              <span className="px-1 text-xs">
                Page {page} of {totalPages}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
