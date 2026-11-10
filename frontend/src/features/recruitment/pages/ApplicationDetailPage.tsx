import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { applicationsApi } from '../../../api/applications'
import { useAuth } from '../../../auth/useAuth'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Textarea } from '../../../components/ui/Field'
import { ArrowLeftIcon, InfoIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { Application, StaffSummary } from '../../../types/application'
import { ApplicationTimeline } from '../components/ApplicationTimeline'
import { ReopenDialog } from '../components/ReopenDialog'
import { StageBadge } from '../components/StageBadge'
import { StageChangeDialog } from '../components/StageChangeDialog'
import { pipelineStages, stageLabels } from '../lib/applicationStages'
import { candidateSourceLabels } from '../lib/candidateOptions'
import { backLabel, fromState, safeFrom } from '../lib/navContext'
import { jobStatusLabels } from '../lib/jobStatus'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  )
}

export function ApplicationDetailPage() {
  const { id = '' } = useParams()
  const here = useLocation()
  const hereState = fromState(here.pathname + here.search)
  const { can } = useAuth()
  const [changing, setChanging] = useState(false)
  const [reopening, setReopening] = useState(false)

  const { data: app, error, loading, reload } = useQuery((s) => applicationsApi.get(id, s), id)
  const recruiters = useQuery((s) => applicationsApi.recruiters(s), 'recruiters', can('applications:assign'))

  if (loading && !app)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading application…
      </div>
    )

  if (error && !app) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState
            title={notFound ? 'Application not found' : "Couldn't load the application"}
            message={notFound ? 'This application may not exist, or the link is incorrect.' : error.message}
            onRetry={notFound ? undefined : reload}
          />
        </Card>
      </>
    )
  }
  if (!app) return null

  const canWrite = can('recruitment:write')
  const fullName = `${app.candidate.first_name} ${app.candidate.last_name}`
  const initials = `${app.candidate.first_name[0] ?? ''}${app.candidate.last_name[0] ?? ''}`.toUpperCase()
  const closedJobStillActive =
    app.job.status === 'closed' && !['hired', 'rejected', 'withdrawn'].includes(app.stage)

  return (
    <>
      <BackLink />

      {closedJobStillActive && (
        <div role="status" className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          This job is closed. The application can only be rejected or withdrawn until the job is reopened.
        </div>
      )}

      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar initials={initials} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-navy-900">{fullName}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Applied for{' '}
                <Link to={`/recruitment/jobs/${app.job.id}`} className="font-medium text-navy-900 hover:text-lavender-600">
                  {app.job.title}
                </Link>
              </p>
              <div className="mt-2.5">
                <StageBadge stage={app.stage} />
              </div>
            </div>
          </div>
          {canWrite && (app.allowed_stages.length > 0 || app.can_reopen) && (
            <div className="flex flex-wrap gap-2">
              {app.allowed_stages.length > 0 && <Button onClick={() => setChanging(true)}>Change stage</Button>}
              {app.can_reopen && (
                <Button variant="secondary" onClick={() => setReopening(true)}>
                  Reopen
                </Button>
              )}
            </div>
          )}
        </div>
        <Progress app={app} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="History" />
            <ApplicationTimeline events={app.events} />
          </Card>
          <NotesCard app={app} canWrite={canWrite} onSaved={reload} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Candidate" />
            <dl className="space-y-4 p-5 sm:p-6">
              <Detail label="Name">
                <Link to={`/recruitment/candidates/${app.candidate.id}`} state={hereState} className="font-medium hover:text-lavender-600">
                  {fullName}
                </Link>
              </Detail>
              <Detail label="Email">
                <a href={`mailto:${app.candidate.email}`} className="[overflow-wrap:anywhere] hover:text-lavender-600">
                  {app.candidate.email}
                </a>
              </Detail>
              {app.candidate.phone && <Detail label="Phone">{app.candidate.phone}</Detail>}
              {(app.candidate.current_title || app.candidate.current_company) && (
                <Detail label="Current role">
                  {[app.candidate.current_title, app.candidate.current_company].filter(Boolean).join(' at ')}
                </Detail>
              )}
              {app.candidate.location && <Detail label="Location">{app.candidate.location}</Detail>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Job" />
            <dl className="space-y-4 p-5 sm:p-6">
              <Detail label="Title">
                <Link to={`/recruitment/jobs/${app.job.id}`} className="font-medium hover:text-lavender-600">
                  {app.job.title}
                </Link>
              </Detail>
              <Detail label="Department">{app.job.department}</Detail>
              <Detail label="Location">{app.job.location}</Detail>
              <Detail label="Job status">{jobStatusLabels[app.job.status]}</Detail>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Application" />
            <dl className="space-y-4 p-5 sm:p-6">
              <Detail label="Applied">{formatDateTime(app.applied_at)}</Detail>
              <Detail label="In this stage since">{formatDateTime(app.stage_changed_at)}</Detail>
              <Detail label="Source">{candidateSourceLabels[app.source]}</Detail>
              <Detail label="Recruiter">
                <Assignment app={app} recruiters={recruiters.data ?? []} onChanged={reload} />
              </Detail>
            </dl>
          </Card>
        </div>
      </div>

      <StageChangeDialog
        application={changing ? app : null}
        onClose={() => setChanging(false)}
        onChanged={reload}
        onStale={reload}
      />
      <ReopenDialog
        application={reopening ? app : null}
        onClose={() => setReopening(false)}
        onChanged={reload}
        onStale={reload}
      />
    </>
  )
}

function BackLink() {
  // Back goes to wherever the user came from (board, filtered list, candidate), filters intact.
  const from = safeFrom(useLocation().state)
  return (
    <Link
      to={from ?? '/recruitment/applications'}
      className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-navy-900"
    >
      <ArrowLeftIcon className="size-4" /> {backLabel(from, 'All applications')}
    </Link>
  )
}

/** Where the application is in the pipeline. Rejected / withdrawn applications show a note instead. */
function Progress({ app }: { app: Application }) {
  if (app.stage === 'rejected' || app.stage === 'withdrawn') {
    return (
      <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
        This application was {app.stage}.{app.can_reopen ? ' It can be reopened.' : ''}
      </p>
    )
  }
  const current = pipelineStages.indexOf(app.stage)
  return (
    <ol aria-label="Pipeline progress" className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-6">
      {pipelineStages.map((stage, i) => (
        <li
          key={stage}
          aria-current={i === current ? 'step' : undefined}
          className={`rounded-lg px-2 py-1.5 text-center text-xs font-medium ${
            i === current
              ? 'bg-lavender-500 text-white'
              : i < current
                ? 'bg-lavender-100 text-lavender-700'
                : 'bg-slate-100 text-slate-400'
          }`}
        >
          {stageLabels[stage]}
        </li>
      ))}
    </ol>
  )
}

/**
 * HR and admins can assign anyone. A recruiter can only take an application for themselves or
 * release their own claim (the server enforces this; the UI just offers the right controls).
 */
function Assignment({
  app,
  recruiters,
  onChanged,
}: {
  app: Application
  recruiters: StaffSummary[]
  onChanged: () => void
}) {
  const { user, can } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const current = app.assigned_recruiter

  const assign = async (recruiterId: string | null) => {
    setBusy(true)
    try {
      await applicationsApi.update(app.id, { assigned_recruiter_id: recruiterId })
      toast.success(recruiterId ? 'Recruiter assigned.' : 'Recruiter removed.')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the recruiter.')
    } finally {
      setBusy(false)
    }
  }

  if (can('applications:assign')) {
    // The assigned person may no longer appear in the active list (e.g. deactivated); keep showing them.
    const options = current && !recruiters.some((r) => r.id === current.id) ? [current, ...recruiters] : recruiters
    return (
      <select
        aria-label="Assigned recruiter"
        value={current?.id ?? ''}
        disabled={busy}
        onChange={(e) => void assign(e.target.value || null)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-navy-900 shadow-sm focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none"
      >
        <option value="">Unassigned</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.email}
          </option>
        ))}
      </select>
    )
  }

  const mine = current?.id === user?.id
  return (
    <div className="space-y-2">
      <span className="block [overflow-wrap:anywhere]">{current ? current.email : <span className="text-slate-400">Unassigned</span>}</span>
      {can('recruitment:write') && user && (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void assign(mine ? null : user.id)}>
          {mine ? 'Release' : 'Assign to me'}
        </Button>
      )}
    </div>
  )
}

function NotesCard({ app, canWrite, onSaved }: { app: Application; canWrite: boolean; onSaved: () => void }) {
  const toast = useToast()
  const saved = app.internal_notes ?? ''
  const [draft, setDraft] = useState<string | null>(null) // null = unchanged since last load
  const [busy, setBusy] = useState(false)
  const text = draft ?? saved
  const dirty = draft !== null && draft.trim() !== saved

  const save = async () => {
    setBusy(true)
    try {
      await applicationsApi.update(app.id, { internal_notes: text.trim() || null })
      toast.success('Notes saved.')
      setDraft(null)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the notes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Internal notes" />
      <div className="p-5 sm:p-6">
        {canWrite ? (
          <>
            <Textarea
              label="Notes about this application"
              value={text}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              hint="Only recruiting staff can see these. Changes are logged in the history, but the text itself is not."
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
                Save notes
              </Button>
            </div>
          </>
        ) : saved ? (
          <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{saved}</p>
        ) : (
          <p className="text-sm text-slate-500">No notes.</p>
        )}
      </div>
    </Card>
  )
}
