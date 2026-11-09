import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { candidatesApi } from '../../../api/candidates'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { Alert } from '../../../components/ui/Feedback'
import { Input, Select } from '../../../components/ui/Field'
import { InfoIcon } from '../../../components/ui/icons'
import type { CandidateSource, ConsentBasis } from '../../../types/candidate'
import {
  consentBasisHints,
  consentBasisLabels,
  consentBases,
  candidateSourceLabels,
  candidateSources,
} from '../lib/candidateOptions'
import { DUPLICATE_EMAIL_MESSAGE, mapCandidateApiError, validateCandidate } from '../lib/candidateFormValues'
import type { CandidateFieldErrors, CandidateFormValues } from '../lib/candidateFormValues'
import { todayIso } from '../lib/retention'

interface Props {
  initialValues: CandidateFormValues
  submitLabel: string
  cancelTo: string
  /** Editing an existing candidate: explains that changing the basis restarts retention. */
  editing?: boolean
  /** Must throw (ideally an ApiError) when the request fails. */
  onSubmit: (values: CandidateFormValues) => Promise<void>
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-3">
      <div>
        <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:col-span-2">{children}</div>
    </div>
  )
}

function focusFirstInvalid() {
  requestAnimationFrame(() =>
    document.getElementById('candidate-form')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  )
}

export function CandidateForm({ initialValues, submitLabel, cancelTo, editing = false, onSubmit }: Props) {
  const [values, setValues] = useState<CandidateFormValues>(initialValues)
  const [errors, setErrors] = useState<CandidateFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [existingId, setExistingId] = useState<string | null>(null)

  const set = <K extends keyof CandidateFormValues>(key: K, value: CandidateFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined })) // clear as the user fixes it
    if (key === 'email') setExistingId(null)
  }

  const text = (key: Exclude<keyof CandidateFormValues, 'source' | 'consent_basis'>) => ({
    value: values[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const clientErrors = validateCandidate(values)
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      focusFirstInvalid()
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      const { fields, general } = mapCandidateApiError(err)
      setErrors(fields)
      setFormError(general ?? (Object.keys(fields).length ? 'Please correct the highlighted fields.' : null))
      setSubmitting(false)
      focusFirstInvalid()
      if (fields.email === DUPLICATE_EMAIL_MESSAGE) {
        // Help the user find the person they were trying to add.
        candidatesApi
          .findByEmail(values.email.trim().toLowerCase())
          .then((existing) => setExistingId(existing?.id ?? null))
          .catch(() => {})
      }
    }
    // On success the page navigates away, so `submitting` is deliberately left on.
  }

  const basis = values.consent_basis
  return (
    <form id="candidate-form" onSubmit={handleSubmit} noValidate>
      <Card className="divide-y divide-slate-100">
        <div className="flex items-start gap-2.5 bg-lavender-50/70 px-5 py-4 text-sm text-lavender-700 sm:px-6">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            Only record what you need to contact and assess this person. Do not add health, family,
            ethnicity, religion, age or other sensitive details.
          </p>
        </div>

        <Section title="Personal details" description="Name and how to reach them.">
          <Input label="First name" required autoComplete="off" {...text('first_name')} />
          <Input label="Last name" required autoComplete="off" {...text('last_name')} />
          <div>
            <Input label="Email" type="email" required autoComplete="off" placeholder="name@example.com" {...text('email')} />
            {existingId && (
              <Link
                to={`/recruitment/candidates/${existingId}`}
                className="mt-1.5 inline-block text-xs font-medium text-lavender-600 hover:underline"
              >
                View the existing candidate
              </Link>
            )}
          </div>
          <Input label="Phone" type="tel" autoComplete="off" placeholder="+92 300 1234567" hint="Optional." {...text('phone')} />
          <div className="sm:col-span-2">
            <Input label="Location" autoComplete="off" placeholder="City, country" hint="Optional. City and country only, no street address." {...text('location')} />
          </div>
        </Section>

        <Section title="Current role" description="Where they work now, if known.">
          <Input label="Current job title" autoComplete="off" {...text('current_title')} />
          <Input label="Current company" autoComplete="off" {...text('current_company')} />
        </Section>

        <Section
          title="Source and data basis"
          description="Where they came from, and why you may hold their details. Choose the basis that actually applies. Consent is not always the right one."
        >
          <Select
            label="Source"
            required
            value={values.source}
            error={errors.source}
            onChange={(e) => set('source', e.target.value as CandidateSource | '')}
          >
            <option value="">Select source…</option>
            {candidateSources.map((s) => (
              <option key={s} value={s}>
                {candidateSourceLabels[s]}
              </option>
            ))}
          </Select>
          <Input
            label="Date the basis was established"
            type="date"
            required
            max={todayIso()}
            hint="For consent, the date they gave it."
            {...text('consent_date')}
          />
          <div className="sm:col-span-2">
            <Select
              label="Basis for holding their details"
              required
              value={values.consent_basis}
              error={errors.consent_basis}
              hint={basis ? consentBasisHints[basis as ConsentBasis] : 'Nothing is pre-selected. Choose deliberately.'}
              onChange={(e) => set('consent_basis', e.target.value as ConsentBasis | '')}
            >
              <option value="">Select basis…</option>
              {consentBases.map((b) => (
                <option key={b} value={b}>
                  {consentBasisLabels[b]}
                </option>
              ))}
            </Select>
          </div>
          {basis === 'other' && (
            <div className="sm:col-span-2">
              <Input
                label="Explain the basis"
                required
                maxLength={200}
                autoComplete="off"
                placeholder="e.g. referred by a partner firm who confirmed they agree"
                {...text('consent_basis_note')}
              />
            </div>
          )}
          <p className="text-xs text-slate-500 sm:col-span-2">
            {editing
              ? 'Changing the basis or its date counts as new activity and restarts the retention period.'
              : 'Their details are kept for a set period after their last activity, then flagged for review.'}
          </p>
        </Section>

        <div className="flex flex-col gap-4 bg-slate-50/60 px-5 py-4 sm:px-6">
          {formError && <Alert>{formError}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link to={cancelTo} className={buttonClasses('secondary')}>
              Cancel
            </Link>
            <Button type="submit" loading={submitting}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  )
}
