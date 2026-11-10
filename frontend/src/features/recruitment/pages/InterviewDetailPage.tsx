import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { ArrowLeftIcon, InfoIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import { CancelInterviewDialog } from '../components/CancelInterviewDialog'
import { FeedbackForm } from '../components/FeedbackForm'
import { FeedbackSummary } from '../components/FeedbackSummary'
import { InterviewHistory } from '../components/InterviewHistory'
import { InterviewStatusBadge } from '../components/InterviewStatusBadge'
import { InterviewerManager } from '../components/InterviewerManager'
import { RescheduleDialog } from '../components/RescheduleDialog'
import { formatRange, modeLabels, typeLabels } from '../lib/interviews'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

export function InterviewDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [refresh, setRefresh] = useState(0)
  const [rescheduling, setRescheduling] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const interview = useQuery((s) => interviewsApi.get(id, s), `interview-${id}-${refresh}`)
  const feedback = useQuery((s) => interviewsApi.feedback(id, s), `interview-feedback-${id}-${refresh}`, interview.data !== null)
  const scale = useQuery((s) => interviewsApi.ratingScale(s), 'rating-scale')
  const again = () => setRefresh((n) => n + 1)

  const i = interview.data
  if (interview.loading && !i)
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500">
        <Spinner /> Loading interview…
      </div>
    )
  if (interview.error && !i) {
    const missing = interview.error.status === 404 || interview.error.status === 422
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState
            title={missing ? 'Interview not found' : "Couldn't load the interview"}
            message={missing ? 'It may not exist, or the link is incorrect.' : interview.error.message}
            onRetry={missing ? undefined : interview.reload}
          />
        </Card>
      </>
    )
  }
  if (!i) return null

  const can = (a: string) => i.allowed_actions.includes(a)
  const mine = feedback.data?.items.find((f) => f.is_mine) ?? null
  const act = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await work()
      toast.success(done)
      again()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(null)
    }
  }
  const person = `${i.application.candidate.first_name} ${i.application.candidate.last_name}`

  return (
    <>
      <BackLink />

      {i.status === 'rescheduled' && i.rescheduled_to_id && (
        <div role="note" className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            This interview was rescheduled. It is kept here as it was.{' '}
            <Link to={`/recruitment/interviews/${i.rescheduled_to_id}`} className="font-medium underline">
              See the new interview
            </Link>
            .
          </span>
        </div>
      )}
      {i.rescheduled_from_id && (
        <p className="mb-4 text-xs text-slate-500">
          Rescheduled from an earlier time.{' '}
          <Link to={`/recruitment/interviews/${i.rescheduled_from_id}`} className="font-medium text-lavender-700 underline">
            See the original
          </Link>
        </p>
      )}
      {i.status === 'cancelled' && (
        <div role="note" className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Cancelled{i.cancelled_at ? ` on ${formatDateTime(i.cancelled_at)}` : ''}. Reason: {i.cancellation_reason}
        </div>
      )}
      {i.scrubbed && (
        <div role="note" className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          This candidate was anonymized, so the interview's notes, links and written feedback were removed. Times and ratings are kept.
        </div>
      )}

      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight break-words text-navy-900">{i.title}</h1>
              <InterviewStatusBadge status={i.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {typeLabels[i.interview_type]} · round {i.round_number} · {modeLabels[i.mode]} · {i.duration_minutes} minutes
            </p>
            <p className="mt-1 text-sm font-medium text-navy-900">{formatRange(i)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Time zone {i.timezone}. Everyone sees the same moment; the clock time above is in that zone.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('confirm') && (
              <Button variant="secondary" loading={busy === 'confirm'} onClick={() => void act('confirm', () => interviewsApi.confirm(i.id), 'Interview confirmed.')}>
                Confirm
              </Button>
            )}
            {can('complete') && (
              <Button variant="secondary" loading={busy === 'complete'} onClick={() => void act('complete', () => interviewsApi.complete(i.id), 'Marked as completed.')}>
                Mark completed
              </Button>
            )}
            {can('reschedule') && (
              <Button variant="secondary" onClick={() => setRescheduling(true)}>
                Reschedule
              </Button>
            )}
            {can('cancel') && (
              <Button variant="secondary" className="text-rose-600 hover:!bg-rose-50" onClick={() => setCancelling(true)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {mine !== null || i.my_feedback_status !== null ? (
            <Card>
              <CardHeader title="Your feedback" />
              <div className="p-5 sm:p-6">
                {feedback.loading && !feedback.data ? (
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Spinner className="size-4" /> Loading…
                  </p>
                ) : feedback.error && !feedback.data ? (
                  <p role="alert" className="text-sm text-rose-600">
                    Couldn't load your feedback.{' '}
                    <button type="button" onClick={feedback.reload} className="font-medium underline">
                      Retry
                    </button>
                  </p>
                ) : i.scrubbed ? (
                  <p className="text-sm text-slate-500">Feedback can no longer be changed.</p>
                ) : i.status === 'cancelled' || i.status === 'rescheduled' ? (
                  <p className="text-sm text-slate-500">A {i.status} interview takes no feedback.</p>
                ) : (
                  <FeedbackForm key={`${mine?.id ?? 'new'}-${mine?.version ?? 0}`} interview={i} mine={mine} onSaved={again} />
                )}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Feedback" />
            <div className="p-5 sm:p-6">
              {feedback.loading && !feedback.data ? (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner className="size-4" /> Loading…
                </p>
              ) : feedback.error && !feedback.data ? (
                <p role="alert" className="text-sm text-rose-600">
                  Couldn't load the feedback.{' '}
                  <button type="button" onClick={feedback.reload} className="font-medium underline">
                    Retry
                  </button>
                </p>
              ) : feedback.data ? (
                <FeedbackSummary overview={feedback.data} scale={scale.data} />
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-4 p-5 sm:p-6">
              <Detail label="Candidate">
                <Link to={`/recruitment/candidates/${i.application.candidate.id}`} className="hover:text-lavender-600">
                  {person}
                </Link>
              </Detail>
              <Detail label="Application">
                <Link to={`/recruitment/applications/${i.application.id}`} className="hover:text-lavender-600">
                  {i.application.job.title}
                </Link>
              </Detail>
              {i.location && <Detail label="Location">{i.location}</Detail>}
              {i.meeting_url && (
                <Detail label="Meeting link">
                  <a href={i.meeting_url} target="_blank" rel="noopener noreferrer" className="text-lavender-700 underline">
                    Open the meeting
                  </a>
                </Detail>
              )}
              {!i.location && !i.meeting_url && <Detail label="Where">Not specified</Detail>}
              <Detail label="Scheduled by">{i.created_by?.email ?? 'a former user'}</Detail>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Interviewers" />
            <div className="p-5 sm:p-6">
              <InterviewerManager interview={i} canManage={can('manage_interviewers')} onChanged={() => again()} />
            </div>
          </Card>
          <Card>
            <CardHeader title="History" />
            <InterviewHistory interviewId={i.id} refreshKey={String(refresh)} />
          </Card>
        </div>
      </div>

      <RescheduleDialog
        interview={rescheduling ? i : null}
        onClose={() => setRescheduling(false)}
        onRescheduled={(next) => navigate(`/recruitment/interviews/${next.id}`)}
      />
      <CancelInterviewDialog interview={cancelling ? i : null} onClose={() => setCancelling(false)} onCancelled={again} />
    </>
  )
}

function BackLink() {
  return (
    <Link to="/recruitment/interviews" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-navy-900">
      <ArrowLeftIcon className="size-4" /> All interviews
    </Link>
  )
}
