import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { jobsApi } from '../../../api/jobs'
import { useAuth } from '../../../auth/useAuth'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { ArrowLeftIcon, PencilIcon, TrashIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { employmentTypeLabels, formatShortDate, fullName } from '../../../lib/format'
import type { Job } from '../../../types/job'
import { DeleteJobDialog } from '../components/DeleteJobDialog'
import { JobStatusActions } from '../components/JobStatusActions'
import { JobStatusBadge } from '../components/JobStatusBadge'
import { formatSalary, isDeletable, isEditable } from '../lib/jobStatus'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  )
}

function SkillChips({ skills, tone }: { skills: string[]; tone: 'required' | 'optional' }) {
  if (skills.length === 0) return <span className="text-sm text-slate-400">None listed</span>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <li
          key={skill}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
            tone === 'required'
              ? 'bg-lavender-100 text-lavender-700 ring-lavender-200'
              : 'bg-slate-50 text-slate-600 ring-slate-200'
          }`}
        >
          {skill}
        </li>
      ))}
    </ul>
  )
}

export function JobDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Status changes return the updated job, so we show it without waiting for a reload.
  const [override, setOverride] = useState<Job | null>(null)

  const { data, error, loading, reload } = useQuery((s) => jobsApi.get(id, s), id)
  const job = override && override.id === id ? override : data

  if (loading && !job)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading job…
      </div>
    )

  if (error && !job) {
    const notFound = error.status === 404 || error.status === 422
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState
            title={notFound ? 'Job not found' : "Couldn't load the job"}
            message={notFound ? 'This job may have been deleted, or the link is incorrect.' : error.message}
            onRetry={notFound ? undefined : reload}
          />
        </Card>
      </>
    )
  }
  if (!job) return null

  const canWrite = can('recruitment:write')
  const canDelete = can('recruitment:delete') && isDeletable(job)
  const salary = formatSalary(job)

  return (
    <>
      <BackLink />

      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900 [overflow-wrap:anywhere]">{job.title}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {job.department} · {job.location}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <JobStatusBadge status={job.status} />
              <span className="text-xs text-slate-500">{employmentTypeLabels[job.employment_type]}</span>
            </div>
          </div>

          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <JobStatusActions job={job} onChanged={setOverride} />
              {isEditable(job) && (
                <Link to={`/recruitment/jobs/${job.id}/edit`} className={buttonClasses('secondary')}>
                  <PencilIcon className="size-4" /> Edit
                </Link>
              )}
              {canDelete && (
                <Button variant="secondary" className="text-rose-600 hover:!bg-rose-50" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon className="size-4" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Description" />
            <div className="p-5 sm:p-6">
              {job.description ? (
                // Rendered as text (never as HTML), so any markup in it stays inert.
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 [overflow-wrap:anywhere]">
                  {job.description}
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  No description yet.
                  {canWrite && isEditable(job) && ' Add one to be able to publish this job.'}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Requirements" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Required skills">
                <SkillChips skills={job.required_skills} tone="required" />
              </Detail>
              <Detail label="Nice to have">
                <SkillChips skills={job.nice_to_have_skills} tone="optional" />
              </Detail>
              <Detail label="Minimum experience">
                {job.min_experience_years === null ? (
                  <span className="text-slate-400">Not specified</span>
                ) : (
                  `${job.min_experience_years} ${job.min_experience_years === 1 ? 'year' : 'years'}`
                )}
              </Detail>
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Openings">{job.openings}</Detail>
              <Detail label="Hiring manager">
                {job.hiring_manager ? (
                  can('employees:read') ? (
                    <Link to={`/employees/${job.hiring_manager.id}`} className="font-medium text-lavender-600 hover:underline">
                      {fullName(job.hiring_manager)}
                    </Link>
                  ) : (
                    fullName(job.hiring_manager)
                  )
                ) : (
                  <span className="text-slate-400">Not assigned</span>
                )}
              </Detail>
              <Detail label="Salary range (internal)">
                {salary ?? <span className="text-slate-400">Not set</span>}
              </Detail>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <dl className="space-y-5 p-5 sm:p-6">
              <Detail label="Created">{formatShortDate(job.created_at)}</Detail>
              <Detail label="Published">
                {job.opened_at ? formatShortDate(job.opened_at) : <span className="text-slate-400">Not yet</span>}
              </Detail>
              {job.closed_at && <Detail label="Closed">{formatShortDate(job.closed_at)}</Detail>}
              <Detail label="Last updated">{formatShortDate(job.updated_at)}</Detail>
            </dl>
          </Card>
        </div>
      </div>

      {can('recruitment:delete') && (
        <DeleteJobDialog
          job={confirmDelete ? job : null}
          onClose={() => setConfirmDelete(false)}
          onDeleted={() => {
            toast.success('Draft job deleted.')
            navigate('/recruitment/jobs')
          }}
        />
      )}
    </>
  )
}

function BackLink() {
  return (
    <Link
      to="/recruitment/jobs"
      className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-navy-900"
    >
      <ArrowLeftIcon className="size-4" /> All jobs
    </Link>
  )
}
