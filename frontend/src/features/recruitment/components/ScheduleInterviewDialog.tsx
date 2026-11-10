import { useState } from 'react'
import { applicationsApi } from '../../../api/applications'
import { interviewsApi } from '../../../api/interviews'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Input, Select } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { Interview, InterviewMode, InterviewType } from '../../../types/interview'
import {
  browserZone,
  hasErrors,
  interviewModes,
  interviewTypes,
  modeLabels,
  toCreatePayload,
  typeLabels,
  validateSchedule,
  zoneOptions,
} from '../lib/interviews'
import type { ScheduleErrors, ScheduleValues } from '../lib/interviews'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (interview: Interview) => void
  /** When set, the interview is for this application and the picker is not shown. */
  applicationId?: string
  applicationLabel?: string
}

export function ScheduleInterviewDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Schedule an interview" wide>
      {props.open && <Body {...props} />}
    </Modal>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function Body({ onClose, onCreated, applicationId, applicationLabel }: Props) {
  const toast = useToast()
  const [values, setValues] = useState<ScheduleValues>({
    application_id: applicationId ?? '',
    title: '',
    interview_type: 'technical',
    mode: 'online',
    date: '',
    start_time: '10:00',
    end_time: '11:00',
    timezone: browserZone(),
    location: '',
    meeting_url: '',
    interviewer_ids: [],
  })
  const [errors, setErrors] = useState<ScheduleErrors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const people = useQuery((s) => interviewsApi.interviewers(s), 'interviewers')
  const apps = useQuery(
    (s) => applicationsApi.list({ q: search || undefined, page_size: 8 }, s),
    `schedule-apps-${search}`,
    applicationId === undefined,
  )

  const set = <K extends keyof ScheduleValues>(key: K, value: ScheduleValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }
  const toggle = (id: string) =>
    set('interviewer_ids', values.interviewer_ids.includes(id) ? values.interviewer_ids.filter((x) => x !== id) : [...values.interviewer_ids, id])

  const submit = async () => {
    const found = validateSchedule(values, { needsApplication: applicationId === undefined })
    const clean = Object.fromEntries(Object.entries(found).filter(([, v]) => v)) as ScheduleErrors
    setErrors(clean)
    if (hasErrors(clean)) return
    setBusy(true)
    setServerError(null)
    try {
      const made = await interviewsApi.create(toCreatePayload(values))
      toast.success('Interview scheduled.')
      onCreated(made)
      onClose()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not schedule the interview.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-5"
    >
      {applicationId === undefined ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-navy-800">Application</legend>
          <Input label="Search applications" type="search" value={search} placeholder="Candidate name or job" onChange={(e) => setSearch(e.target.value)} />
          {apps.loading && !apps.data ? (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Spinner className="size-4" /> Searching…
            </p>
          ) : apps.error && !apps.data ? (
            <p role="alert" className="text-xs text-rose-600">
              Couldn't load applications.{' '}
              <button type="button" onClick={apps.reload} className="font-medium underline">
                Retry
              </button>
            </p>
          ) : (
            <ul className="max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {(apps.data?.items ?? []).map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-lavender-50/60">
                    <input
                      type="radio"
                      name="schedule-application"
                      checked={values.application_id === a.id}
                      onChange={() => set('application_id', a.id)}
                      className="size-4 accent-lavender-600"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-navy-900">
                        {a.candidate.first_name} {a.candidate.last_name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{a.job.title}</span>
                    </span>
                  </label>
                </li>
              ))}
              {(apps.data?.items.length ?? 0) === 0 && <li className="px-3 py-3 text-xs text-slate-500">No matching applications.</li>}
            </ul>
          )}
          {errors.application_id && <p className="text-xs font-medium text-rose-600">{errors.application_id}</p>}
        </fieldset>
      ) : (
        applicationLabel && <p className="text-sm text-slate-600">For: <strong className="text-navy-900">{applicationLabel}</strong></p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input label="Title" value={values.title} error={errors.title} placeholder="e.g. Technical interview" onChange={(e) => set('title', e.target.value)} required />
        </div>
        <Select label="Type" value={values.interview_type} onChange={(e) => set('interview_type', e.target.value as InterviewType)}>
          {interviewTypes.map((t) => (
            <option key={t} value={t}>{typeLabels[t]}</option>
          ))}
        </Select>
        <Select label="Mode" value={values.mode} onChange={(e) => set('mode', e.target.value as InterviewMode)}>
          {interviewModes.map((m) => (
            <option key={m} value={m}>{modeLabels[m]}</option>
          ))}
        </Select>
        <Input label="Date" type="date" min={today()} value={values.date} error={errors.date} onChange={(e) => set('date', e.target.value)} required />
        <Select label="Time zone" value={values.timezone} hint="The date and times above are in this zone." onChange={(e) => set('timezone', e.target.value)}>
          {zoneOptions(values.timezone).map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </Select>
        <Input label="Starts" type="time" value={values.start_time} error={errors.start_time} onChange={(e) => set('start_time', e.target.value)} required />
        <Input label="Ends" type="time" value={values.end_time} error={errors.end_time} onChange={(e) => set('end_time', e.target.value)} required />
        {values.mode === 'in_person' && (
          <div className="sm:col-span-2">
            <Input label="Location" value={values.location} error={errors.location} placeholder="Office, room or address" onChange={(e) => set('location', e.target.value)} required />
          </div>
        )}
        {values.mode === 'online' && (
          <div className="sm:col-span-2">
            <Input
              label="Meeting link (optional)"
              type="url"
              value={values.meeting_url}
              error={errors.meeting_url}
              hint="A plain https link. Do not include a password or token: HireFlow does not store meeting secrets."
              onChange={(e) => set('meeting_url', e.target.value)}
            />
          </div>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-navy-800">Interviewers</legend>
        {people.loading && !people.data ? (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Spinner className="size-4" /> Loading…
          </p>
        ) : people.error && !people.data ? (
          <p role="alert" className="text-xs text-rose-600">
            Couldn't load the people list.{' '}
            <button type="button" onClick={people.reload} className="font-medium underline">
              Retry
            </button>
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(people.data ?? []).map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-lavender-50/60">
                <input type="checkbox" checked={values.interviewer_ids.includes(p.id)} onChange={() => toggle(p.id)} className="size-4 accent-lavender-600" />
                <span className="min-w-0 truncate">{p.email}</span>
              </label>
            ))}
          </div>
        )}
        {errors.interviewer_ids && <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.interviewer_ids}</p>}
      </fieldset>

      {serverError && <Alert>{serverError}</Alert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Schedule interview
        </Button>
      </div>
    </form>
  )
}
