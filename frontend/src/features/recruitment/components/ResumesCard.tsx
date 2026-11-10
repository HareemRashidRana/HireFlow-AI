import { useState } from 'react'
import { resumesApi } from '../../../api/resumes'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatShortDate } from '../../../lib/format'
import { saveFile } from '../../../lib/download'
import type { Resume, ResumeStatus } from '../../../types/resume'
import { describeParseProblem, formatBytes, statusLabels } from '../lib/resumes'
import { DeleteResumeDialog } from './DeleteResumeDialog'
import { ResumeReviewDialog } from './ResumeReviewDialog'
import { ResumeUpload } from './ResumeUpload'

const statusTone: Record<ResumeStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  processing: 'bg-slate-100 text-slate-700',
  parsed: 'bg-emerald-50 text-emerald-700',
  no_text: 'bg-amber-50 text-amber-800',
  failed: 'bg-rose-50 text-rose-700',
  removed: 'bg-slate-100 text-slate-500',
}

interface Props {
  candidateId: string
  /** An anonymized candidate keeps no resumes and cannot receive new ones. */
  anonymized: boolean
}

/** Resume history for one candidate: upload, download, review what was read, make active, delete. */
export function ResumesCard({ candidateId, anonymized }: Props) {
  const { can } = useAuth()
  const toast = useToast()
  const canManage = can('resumes:manage')
  const canDelete = can('resumes:delete')
  const { data, error, loading, reload } = useQuery((s) => resumesApi.list(candidateId, s), `resumes-${candidateId}`, canManage)
  const [busy, setBusy] = useState<string | null>(null) // "<resume id>:<action>"
  const [reviewing, setReviewing] = useState<Resume | null>(null)
  const [deleting, setDeleting] = useState<Resume | null>(null)

  if (!canManage) return null

  const run = async (resume: Resume, action: string, work: () => Promise<string | void>) => {
    if (busy) return
    setBusy(`${resume.id}:${action}`)
    try {
      const message = await work()
      if (message) toast.success(message)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const items = (data?.items ?? []).filter((r) => r.status !== 'removed')

  return (
    <Card>
      <CardHeader title="Resumes" />
      <div className="space-y-5 p-5 sm:p-6">
        {anonymized ? (
          <p className="text-sm text-slate-500">This candidate was anonymized, so no resumes are kept.</p>
        ) : (
          <ResumeUpload candidateId={candidateId} onUploaded={reload} />
        )}

        {loading && !data ? (
          <p className="text-sm text-slate-500">Loading resumes…</p>
        ) : error && !data ? (
          <p role="alert" className="text-sm text-rose-600">
            Couldn't load resumes.{' '}
            <button type="button" onClick={reload} className="font-medium underline">
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">No resumes uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {items.map((r) => {
              const problem = describeParseProblem(r.status, r.parse_error_code)
              const mine = (action: string) => busy === `${r.id}:${action}`
              const canRetry = r.status === 'failed' || r.status === 'no_text' || r.status === 'pending'
              return (
                <li key={r.id} className="space-y-2 px-4 py-3.5" aria-label={`Resume version ${r.version_number}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 text-sm font-medium text-navy-900 [overflow-wrap:anywhere]">{r.original_filename}</span>
                    <span className="text-xs text-slate-500">v{r.version_number}</span>
                    {r.is_active && (
                      <span className="rounded-full bg-lavender-100 px-2 py-0.5 text-xs font-medium text-lavender-700">Active</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[r.status]}`}>{statusLabels[r.status]}</span>
                    {r.reviewed && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Reviewed</span>}
                  </div>
                  <p className="text-xs text-slate-500">
                    {r.extension.toUpperCase()} · {formatBytes(r.size_bytes)} · uploaded {formatShortDate(r.created_at)}
                    {r.uploaded_by ? ` by ${r.uploaded_by.email}` : ''}
                  </p>
                  {problem && <p className="text-xs text-amber-800">{problem}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={mine('download')}
                      aria-label={`Download ${r.original_filename}`}
                      onClick={() =>
                        void run(r, 'download', async () => {
                          const file = await resumesApi.download(r.id)
                          saveFile(file.blob, file.filename)
                        })
                      }
                    >
                      Download
                    </Button>
                    {r.status === 'parsed' && (
                      <Button variant="secondary" size="sm" aria-label={`Review details of version ${r.version_number}`} onClick={() => setReviewing(r)}>
                        {r.reviewed ? 'Review again' : 'Review details'}
                      </Button>
                    )}
                    {canRetry && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={mine('retry')}
                        aria-label={`Read version ${r.version_number} again`}
                        onClick={() => void run(r, 'retry', async () => { await resumesApi.parse(r.id); return 'Finished reading the file.' })}
                      >
                        Read again
                      </Button>
                    )}
                    {!r.is_active && !anonymized && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={mine('activate')}
                        aria-label={`Make version ${r.version_number} the active resume`}
                        onClick={() => void run(r, 'activate', async () => { await resumesApi.activate(r.id); return `Version ${r.version_number} is now the active resume.` })}
                      >
                        Make active
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-rose-600 hover:!bg-rose-50"
                        aria-label={`Delete version ${r.version_number}`}
                        onClick={() => setDeleting(r)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ResumeReviewDialog resume={reviewing} onClose={() => setReviewing(null)} onSaved={reload} />
      {canDelete && (
        <DeleteResumeDialog
          resume={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            toast.success('Resume deleted.')
            reload()
          }}
        />
      )}
    </Card>
  )
}
