import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { candidatesApi } from '../../../api/candidates'
import { useAuth } from '../../../auth/useAuth'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { ArrowLeftIcon, InfoIcon, MailIcon, PencilIcon, PhoneIcon, TrashIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatDate, formatShortDate } from '../../../lib/format'
import { DeleteCandidateDialog } from '../components/DeleteCandidateDialog'
import { RetentionBadge } from '../components/RetentionBadge'
import { candidateSourceLabels, consentBasisLabels } from '../lib/candidateOptions'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  )
}

const notProvided = <span className="text-slate-400">Not provided</span>

export function CandidateDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: candidate, error, loading, reload } = useQuery((s) => candidatesApi.get(id, s), id)

  if (loading && !candidate)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading candidate…
      </div>
    )

  if (error && !candidate) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState
            title={notFound ? 'Candidate not found' : "Couldn't load the candidate"}
            message={notFound ? 'This candidate may have been deleted, or the link is incorrect.' : error.message}
            onRetry={notFound ? undefined : reload}
          />
        </Card>
      </>
    )
  }
  if (!candidate) return null

  const canWrite = can('recruitment:write')
  const canDelete = can('candidates:delete')
  const anonymized = candidate.anonymized_at !== null
  const role = [candidate.current_title, candidate.current_company].filter(Boolean).join(' at ')

  return (
    <>
      <BackLink />

      {anonymized && (
        <div role="status" className="mb-6 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          This candidate's personal data was anonymized. The record can no longer be edited.
        </div>
      )}

      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar initials={`${candidate.first_name[0] ?? ''}${candidate.last_name[0] ?? ''}`.toUpperCase()} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-navy-900">
                {candidate.first_name} {candidate.last_name}
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">{role || 'No current role recorded'}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">{candidateSourceLabels[candidate.source]}</span>
                <RetentionBadge retainUntil={candidate.retain_until} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {canWrite && !anonymized && (
              <Link to={`/recruitment/candidates/${candidate.id}/edit`} className={buttonClasses('secondary')}>
                <PencilIcon className="size-4" /> Edit
              </Link>
            )}
            {canDelete && (
              <Button variant="secondary" className="text-rose-600 hover:!bg-rose-50" onClick={() => setConfirmDelete(true)}>
                <TrashIcon className="size-4" /> Delete
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Contact" />
            <dl className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
              <Detail label="Email">
                <a href={`mailto:${candidate.email}`} className="inline-flex items-center gap-2 [overflow-wrap:anywhere] hover:text-lavender-600">
                  <MailIcon className="size-4 shrink-0 text-slate-400" />
                  {candidate.email}
                </a>
              </Detail>
              <Detail label="Phone">
                {candidate.phone ? (
                  <a href={`tel:${candidate.phone}`} className="inline-flex items-center gap-2 hover:text-lavender-600">
                    <PhoneIcon className="size-4 text-slate-400" />
                    {candidate.phone}
                  </a>
                ) : (
                  notProvided
                )}
              </Detail>
              <Detail label="Location">{candidate.location ?? notProvided}</Detail>
              <Detail label="Source">{candidateSourceLabels[candidate.source]}</Detail>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Current role" />
            <dl className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
              <Detail label="Job title">{candidate.current_title ?? notProvided}</Detail>
              <Detail label="Company">{candidate.current_company ?? notProvided}</Detail>
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Data basis and retention" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Basis for holding their details">
                {consentBasisLabels[candidate.consent_basis]}
                {candidate.consent_basis_note && (
                  <span className="mt-0.5 block text-xs text-slate-500 [overflow-wrap:anywhere]">{candidate.consent_basis_note}</span>
                )}
              </Detail>
              <Detail label="Basis established">{formatDate(candidate.consent_date)}</Detail>
              <Detail label="Last activity">{formatShortDate(candidate.last_activity_at)}</Detail>
              <Detail label="Retained until">
                <RetentionBadge retainUntil={candidate.retain_until} />
                <span className="mt-1.5 block text-xs text-slate-500">
                  Kept until {formatDate(candidate.retain_until)} unless there is further activity, then due for review.
                </span>
              </Detail>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Record" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Added">{formatShortDate(candidate.created_at)}</Detail>
              <Detail label="Last updated">{formatShortDate(candidate.updated_at)}</Detail>
            </dl>
          </Card>
        </div>
      </div>

      {canDelete && (
        <DeleteCandidateDialog
          candidate={confirmDelete ? candidate : null}
          onClose={() => setConfirmDelete(false)}
          onDeleted={() => {
            toast.success('Candidate deleted.')
            navigate('/recruitment/candidates')
          }}
        />
      )}
    </>
  )
}

function BackLink() {
  return (
    <Link
      to="/recruitment/candidates"
      className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-navy-900"
    >
      <ArrowLeftIcon className="size-4" /> All candidates
    </Link>
  )
}
