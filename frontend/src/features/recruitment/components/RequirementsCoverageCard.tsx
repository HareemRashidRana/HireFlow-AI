import { useState } from 'react'
import { Link } from 'react-router-dom'
import { screeningApi } from '../../../api/screening'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { Alert } from '../../../components/ui/Feedback'
import { InfoIcon } from '../../../components/ui/icons'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatShortDate } from '../../../lib/format'
import { ADVISORY_TEXT, PRODUCT_NAME, formatFigure, freshnessLabels } from '../lib/coverage'
import { CoverageDetail } from './CoverageDetail'
import { CoverageMethodologyDialog } from './CoverageMethodologyDialog'
import { CoverageReviewForm } from './CoverageReviewForm'

interface Props {
  applicationId: string
  candidateId: string
}

/**
 * Requirements Coverage on the application page. It only ever reads and records: it does not touch
 * the application's stage, and the figure is not shown anywhere else in the product.
 */
export function RequirementsCoverageCard({ applicationId, candidateId }: Props) {
  const { can } = useAuth()
  const toast = useToast()
  const allowed = can('screening:use')
  const list = useQuery((s) => screeningApi.forApplication(applicationId, s), `coverage-${applicationId}`, allowed)
  const [picked, setPicked] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [methodology, setMethodology] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const items = list.data?.items ?? []
  const selectedId = picked && items.some((i) => i.id === picked) ? picked : (items[0]?.id ?? null)
  const detail = useQuery(
    (s) => screeningApi.get(selectedId as string, s),
    `coverage-detail-${selectedId}`,
    allowed && selectedId !== null,
  )

  if (!allowed) return null

  const latest = items[0]
  const canAssess = list.data?.readiness.can_assess ?? false
  const again = latest !== undefined

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const made = await screeningApi.create(applicationId)
      setConfirming(false)
      toast.success(made.created ? 'Requirements Coverage assessed.' : 'An identical assessment already exists, so it was not repeated.')
      setPicked(made.id)
      list.reload()
      detail.reload()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the assessment.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={PRODUCT_NAME}
        action={
          <button type="button" onClick={() => setMethodology(true)} className="inline-flex min-h-9 items-center px-1 text-xs font-medium text-lavender-700 underline">
            How is this calculated?
          </button>
        }
      />
      <div className="space-y-5 p-5 sm:p-6">
        <p className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>{ADVISORY_TEXT}</span>
        </p>

        {list.loading && !list.data ? (
          <p className="flex items-center gap-3 text-sm text-slate-500">
            <Spinner /> Loading…
          </p>
        ) : list.error && !list.data ? (
          <div role="alert" className="text-sm text-rose-600">
            Couldn't load Requirements Coverage.{' '}
            <button type="button" onClick={list.reload} className="font-medium underline">
              Retry
            </button>
          </div>
        ) : list.data ? (
          <>
            {!canAssess && list.data.readiness.blocker_text && (
              <div role="note" className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                <p>{list.data.readiness.blocker_text}</p>
                {list.data.readiness.blocker !== 'candidate_anonymized' && (
                  <Link to={`/recruitment/candidates/${candidateId}`} className="mt-1.5 inline-block font-medium text-lavender-700 underline">
                    Go to the candidate's resumes
                  </Link>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirming(true)} disabled={!canAssess}>
                {again ? 'Assess again' : `Assess ${PRODUCT_NAME}`}
              </Button>
              {again && latest.freshness === 'outdated' && (
                <span className="text-xs text-amber-800">The latest assessment is outdated.</span>
              )}
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-slate-500">
                No assessment yet. The job lists {list.data.job_requirements.required.length} required and{' '}
                {list.data.job_requirements.preferred.length} preferred skill
                {list.data.job_requirements.required.length + list.data.job_requirements.preferred.length === 1 ? '' : 's'}.
              </p>
            ) : (
              <>
                {items.length > 1 && (
                  <nav aria-label="Assessment history">
                    <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">History</p>
                    <ul className="mt-1.5 flex flex-wrap gap-2">
                      {items.map((i) => (
                        <li key={i.id}>
                          <button
                            type="button"
                            aria-pressed={i.id === selectedId}
                            onClick={() => setPicked(i.id)}
                            className={`min-h-9 rounded-lg border px-3 py-2 text-left text-xs ${
                              i.id === selectedId ? 'border-lavender-500 bg-lavender-50 text-navy-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            #{i.assessment_number} · {formatShortDate(i.created_at)}
                            {i.total_score !== null ? ` · ${formatFigure(i.total_score)}` : ' · no figure'} · {freshnessLabels[i.freshness]}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}

                {detail.loading && !detail.data ? (
                  <p className="flex items-center gap-3 text-sm text-slate-500">
                    <Spinner /> Loading the assessment…
                  </p>
                ) : detail.error && !detail.data ? (
                  <div role="alert" className="text-sm text-rose-600">
                    Couldn't load this assessment.{' '}
                    <button type="button" onClick={detail.reload} className="font-medium underline">
                      Retry
                    </button>
                  </div>
                ) : detail.data ? (
                  <>
                    <CoverageDetail assessment={detail.data} />
                    {!detail.data.scrubbed && (
                      <div className="border-t border-slate-100 pt-5">
                        <h4 className="mb-3 text-sm font-semibold text-navy-900">Add your review</h4>
                        <CoverageReviewForm key={detail.data.id} assessment={detail.data} onSaved={() => { detail.reload(); list.reload() }} />
                      </div>
                    )}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </div>

      <Modal
        open={confirming}
        onClose={() => !creating && setConfirming(false)}
        title={`Assess ${PRODUCT_NAME}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void create()} loading={creating}>
              Assess
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p>
            This compares the job's required and preferred skills with the reviewed details of the active resume and
            saves the result as a new assessment{again ? ' (earlier ones are kept)' : ''}.
          </p>
          <p>
            It is advisory, does not change the application's stage, and is recorded in the audit log.
          </p>
          {createError && <Alert>{createError}</Alert>}
        </div>
      </Modal>
      <CoverageMethodologyDialog open={methodology} onClose={() => setMethodology(false)} />
    </Card>
  )
}
