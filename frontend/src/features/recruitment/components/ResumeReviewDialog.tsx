import { useState } from 'react'
import { resumesApi } from '../../../api/resumes'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Input } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import { formatDateTime } from '../../../lib/format'
import type { Confidence, Resume, ResumeParsed } from '../../../types/resume'
import {
  confidenceLabels,
  formatMonths,
  hasReviewErrors,
  initialReviewValues,
  toReviewPayload,
  validateReview,
} from '../lib/resumes'
import type { ReviewErrors, ReviewFormValues } from '../lib/resumes'
import { SkillsInput } from './SkillsInput'

interface Props {
  resume: Resume | null
  onClose: () => void
  onSaved: () => void
}

const warningLabels: Record<string, string> = {
  text_truncated: 'This document is very long, so only the first part was read.',
  no_name: 'No name could be found.',
  no_email: 'No email address could be found.',
  no_phone: 'No phone number could be found.',
  multiple_emails: 'More than one email address was found. Check which one is right.',
  no_skills_section: 'No skills section could be found.',
  no_education_section: 'No education section could be found.',
  no_experience_section: 'No work experience section could be found.',
}
const warningText = (w: string) => warningLabels[w] ?? w.replace(/_/g, ' ')

export function ResumeReviewDialog({ resume, onClose, onSaved }: Props) {
  return (
    <Modal open={resume !== null} onClose={onClose} title="Review resume details" wide>
      {resume && <Body key={resume.id} resume={resume} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function Body({ resume, onClose, onSaved }: { resume: Resume } & Omit<Props, 'resume'>) {
  const query = useQuery((s) => resumesApi.parsed(resume.id, s), resume.id)
  if (query.loading && !query.data)
    return (
      <p className="flex items-center gap-3 py-8 text-sm text-slate-500">
        <Spinner /> Loading what was read from the file…
      </p>
    )
  if (query.error && !query.data)
    return (
      <>
        <Alert>{query.error.message}</Alert>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={query.reload}>Try again</Button>
        </div>
      </>
    )
  if (!query.data) return null
  return <ReviewForm data={query.data} onClose={onClose} onSaved={onSaved} />
}

function ConfidenceTag({ value }: { value: Confidence | null | undefined }) {
  if (!value) return null
  const tone =
    value === 'high'
      ? 'bg-emerald-50 text-emerald-700'
      : value === 'medium'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-rose-50 text-rose-700'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{confidenceLabels[value]}</span>
}

function Section({ title, tag, children }: { title: string; tag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        {tag}
      </div>
      {children}
    </section>
  )
}

function ReviewForm({ data, onClose, onSaved }: { data: ResumeParsed; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { parsed, reviewed, resume } = data
  const [values, setValues] = useState<ReviewFormValues>(() => initialReviewValues(parsed, reviewed))
  const [confirmed, setConfirmed] = useState(false)
  const [errors, setErrors] = useState<ReviewErrors>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const set = <K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setConfirmed(false) // any change must be confirmed again
  }
  const setEdu = (i: number, key: keyof ReviewFormValues['education'][number], value: string) =>
    set('education', values.education.map((e, n) => (n === i ? { ...e, [key]: value } : e)))
  const setExp = (i: number, patch: Partial<ReviewFormValues['experience'][number]>) =>
    set('experience', values.experience.map((e, n) => (n === i ? { ...e, ...patch } : e)))

  const save = async () => {
    if (!confirmed) return // belt and braces: the button is disabled, but Enter must not slip past it
    const found = validateReview(values)
    setErrors(found)
    if (hasReviewErrors(found)) return
    setBusy(true)
    setServerError(null)
    try {
      await resumesApi.review(resume.id, toReviewPayload(values))
      toast.success('Reviewed details saved.')
      onSaved()
      onClose()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save the reviewed details.')
    } finally {
      setBusy(false)
    }
  }

  const machine = !reviewed // confidence only describes what the parser found, not what a person confirmed
  const rowError = (key: string) => errors.rows?.[key]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      noValidate
      className="space-y-6"
    >
      <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
        {reviewed
          ? `These details were reviewed${resume.reviewed_at ? ` on ${formatDateTime(resume.reviewed_at)}` : ''}${resume.reviewed_by ? ` by ${resume.reviewed_by.email}` : ''}. You can correct them and save again.`
          : 'These details were read automatically from the file and may be wrong or incomplete. Check each one against the resume.'}{' '}
        Saving them does <strong>not</strong> change the candidate's profile.
      </p>

      {parsed && parsed.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
          {parsed.warnings.map((w) => (
            <li key={w}>{warningText(w)}</li>
          ))}
        </ul>
      )}

      <Section title="Contact details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input label="Name" value={values.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
            {machine && <ConfidenceTag value={parsed?.name.confidence} />}
          </div>
          <div>
            <Input label="Email" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
            {machine && <ConfidenceTag value={parsed?.email.confidence} />}
          </div>
          <div>
            <Input label="Phone" value={values.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
            {machine && <ConfidenceTag value={parsed?.phone.confidence} />}
          </div>
        </div>
      </Section>

      <Section title="Skills" tag={machine ? <ConfidenceTag value={parsed?.skills.confidence} /> : undefined}>
        <SkillsInput label="Skills" value={values.skills} onChange={(s) => set('skills', s)} />
      </Section>

      <Section title="Work experience" tag={machine ? <ConfidenceTag value={parsed?.total_experience_confidence} /> : undefined}>
        {parsed && (
          <p className="text-xs text-slate-500">
            Estimated total experience: <strong>{formatMonths(parsed.total_experience_months)}</strong> (an estimate from the dates found; it is not stored).
          </p>
        )}
        {values.experience.length === 0 && <p className="text-xs text-slate-500">No work experience entries.</p>}
        {values.experience.map((e, i) => (
          <fieldset key={i} className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 text-xs font-medium text-slate-500">Position {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Job title" value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} />
              <Input label="Company" value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} />
              <Input label="Start (YYYY or YYYY-MM)" value={e.start} onChange={(ev) => setExp(i, { start: ev.target.value })} error={rowError(`experience-${i}-start`)} />
              <Input label="End (YYYY or YYYY-MM)" value={e.current ? '' : e.end} disabled={e.current} onChange={(ev) => setExp(i, { end: ev.target.value })} error={rowError(`experience-${i}-end`)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-navy-900">
              <input type="checkbox" className="size-4 accent-lavender-600" checked={e.current} onChange={(ev) => setExp(i, { current: ev.target.checked })} />
              I currently work here
            </label>
            <Button variant="ghost" size="sm" onClick={() => set('experience', values.experience.filter((_, n) => n !== i))}>
              Remove position {i + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => set('experience', [...values.experience, { title: '', company: '', start: '', end: '', current: false }])}
        >
          Add a position
        </Button>
      </Section>

      <Section title="Education">
        {values.education.length === 0 && <p className="text-xs text-slate-500">No education entries.</p>}
        {values.education.map((e, i) => (
          <fieldset key={i} className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 text-xs font-medium text-slate-500">Education {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Institution" value={e.institution} onChange={(ev) => setEdu(i, 'institution', ev.target.value)} />
              <Input label="Degree" value={e.degree} onChange={(ev) => setEdu(i, 'degree', ev.target.value)} />
              <Input label="Field of study" value={e.field} onChange={(ev) => setEdu(i, 'field', ev.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="From (year)" value={e.start_year} inputMode="numeric" onChange={(ev) => setEdu(i, 'start_year', ev.target.value)} error={rowError(`education-${i}-start_year`)} />
                <Input label="To (year)" value={e.end_year} inputMode="numeric" onChange={(ev) => setEdu(i, 'end_year', ev.target.value)} error={rowError(`education-${i}-end_year`)} />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => set('education', values.education.filter((_, n) => n !== i))}>
              Remove education {i + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => set('education', [...values.education, { institution: '', degree: '', field: '', start_year: '', end_year: '' }])}
        >
          Add education
        </Button>
      </Section>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-navy-900">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4 accent-lavender-600"
        />
        I have checked these details against the resume.
      </label>

      {serverError && <Alert>{serverError}</Alert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!confirmed}>
          Save reviewed details
        </Button>
      </div>
    </form>
  )
}
