import { useState } from 'react'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Select } from '../../../components/ui/Field'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { roleLabels } from '../../../auth/permissions'
import type { Interview } from '../../../types/interview'

interface Props {
  interview: Interview
  canManage: boolean
  onChanged: (next: Interview) => void
}

const feedbackText = { none: 'No feedback yet', draft: 'Draft started', submitted: 'Feedback submitted' } as const

/** Who is on the interview. Only active staff can be added, nobody twice, and the last one stays. */
export function InterviewerManager({ interview, canManage, onChanged }: Props) {
  const toast = useToast()
  const people = useQuery((s) => interviewsApi.interviewers(s), 'interviewers', canManage)
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (key: string, work: () => Promise<Interview>, done: string) => {
    setBusy(key)
    setError(null)
    try {
      onChanged(await work())
      toast.success(done)
      setChosen('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const onIt = new Set(interview.interviewers.map((i) => i.id))
  const addable = (people.data ?? []).filter((p) => !onIt.has(p.id))

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-100">
        {interview.interviewers.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-navy-900">{i.email}</span>
              <span className="block text-xs text-slate-500">
                {roleLabels[i.role]} · {feedbackText[i.feedback_status]}
              </span>
            </span>
            {canManage && interview.interviewers.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                loading={busy === `remove-${i.id}`}
                aria-label={`Remove ${i.email}`}
                onClick={() => void run(`remove-${i.id}`, () => interviewsApi.removeInterviewer(interview.id, i.id), 'Interviewer removed.')}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Select label="Add an interviewer" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={people.loading && !people.data}>
              <option value="">Choose a person…</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>{p.email}</option>
              ))}
            </Select>
          </div>
          <Button
            variant="secondary"
            disabled={!chosen}
            loading={busy === 'add'}
            onClick={() => void run('add', () => interviewsApi.addInterviewer(interview.id, chosen), 'Interviewer added.')}
          >
            Add
          </Button>
        </div>
      )}
      {people.error && !people.data && canManage && (
        <p role="alert" className="text-xs text-rose-600">
          Couldn't load the people list.{' '}
          <button type="button" onClick={people.reload} className="font-medium underline">
            Retry
          </button>
        </p>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  )
}
