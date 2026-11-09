import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { jobsApi } from '../../../api/jobs'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { Alert } from '../../../components/ui/Feedback'
import { Input, Select, Textarea } from '../../../components/ui/Field'
import { employmentTypeLabels, employmentTypes } from '../../../lib/format'
import { ManagerPicker } from '../../employees/components/ManagerPicker'
import { mapJobApiError, validateJob } from '../lib/jobFormValues'
import type { JobFieldErrors, JobFormValues } from '../lib/jobFormValues'
import { SkillsInput } from './SkillsInput'

const COMMON_CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR', 'CAD', 'AUD']
const DESCRIPTION_LIMIT = 10_000

interface Props {
  initialValues: JobFormValues
  submitLabel: string
  cancelTo: string
  /** Must throw (ideally an ApiError) when the request fails. */
  onSubmit: (values: JobFormValues) => Promise<void>
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
    document.getElementById('job-form')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  )
}

export function JobForm({ initialValues, submitLabel, cancelTo, onSubmit }: Props) {
  const [values, setValues] = useState<JobFormValues>(initialValues)
  const [errors, setErrors] = useState<JobFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])

  // Suggestions only: the field stays free text, so a failure here is simply ignored.
  useEffect(() => {
    const controller = new AbortController()
    jobsApi
      .departments(controller.signal)
      .then(setDepartments)
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const set = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined })) // clear as the user fixes it
  }

  const bind = (key: 'title' | 'department' | 'location' | 'openings' | 'min_experience_years' | 'salary_min' | 'salary_max') => ({
    value: values[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const clientErrors = validateJob(values)
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      focusFirstInvalid()
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      const { fields, general } = mapJobApiError(err)
      setErrors(fields)
      setFormError(general ?? (Object.keys(fields).length ? 'Please correct the highlighted fields.' : null))
      setSubmitting(false)
      focusFirstInvalid()
    }
    // On success the page navigates away, so `submitting` is deliberately left on.
  }

  const currencies = COMMON_CURRENCIES.includes(values.salary_currency) || !values.salary_currency
    ? COMMON_CURRENCIES
    : [values.salary_currency, ...COMMON_CURRENCIES] // keep an uncommon saved currency selectable

  return (
    <form id="job-form" onSubmit={handleSubmit} noValidate>
      <Card className="divide-y divide-slate-100">
        <Section title="Basics" description="What the role is and where it sits.">
          <div className="sm:col-span-2">
            <Input label="Job title" required autoComplete="off" placeholder="e.g. Senior Backend Engineer" {...bind('title')} />
          </div>
          <div>
            <Input
              label="Department"
              required
              autoComplete="off"
              list="job-departments"
              placeholder="Engineering"
              {...bind('department')}
            />
            <datalist id="job-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <Input label="Location" required autoComplete="off" placeholder="Lahore, Pakistan or Remote" {...bind('location')} />
          <Select
            label="Employment type"
            required
            value={values.employment_type}
            error={errors.employment_type}
            onChange={(e) => set('employment_type', e.target.value as JobFormValues['employment_type'])}
          >
            <option value="">Select type…</option>
            {employmentTypes.map((t) => (
              <option key={t} value={t}>
                {employmentTypeLabels[t]}
              </option>
            ))}
          </Select>
          <Input label="Openings" type="number" min={1} max={500} inputMode="numeric" required {...bind('openings')} />
        </Section>

        <Section title="Description" description="Shown to your hiring team. Plain text only. Required before the job can be published.">
          <div className="sm:col-span-2">
            <Textarea
              label="Role description"
              rows={8}
              placeholder="What will this person do, and what makes the role a good one?"
              value={values.description}
              error={errors.description}
              hint={`${values.description.length.toLocaleString()} / ${DESCRIPTION_LIMIT.toLocaleString()} characters`}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </Section>

        <Section
          title="Requirements"
          description="Clear, job-related criteria. Candidates are assessed against these, so keep them specific."
        >
          <div className="sm:col-span-2">
            <SkillsInput
              label="Required skills"
              placeholder="e.g. Python, SQL"
              value={values.required_skills}
              error={errors.required_skills}
              onChange={(skills) => set('required_skills', skills)}
            />
          </div>
          <div className="sm:col-span-2">
            <SkillsInput
              label="Nice-to-have skills"
              placeholder="e.g. React, Docker"
              value={values.nice_to_have_skills}
              error={errors.nice_to_have_skills}
              onChange={(skills) => set('nice_to_have_skills', skills)}
            />
          </div>
          <Input
            label="Minimum experience (years)"
            type="number"
            min={0}
            max={50}
            inputMode="numeric"
            hint="Optional."
            {...bind('min_experience_years')}
          />
        </Section>

        <Section title="Compensation" description="Internal salary range. Optional, and only visible to your recruiting team.">
          <Input label="Minimum salary" type="number" min={0} inputMode="numeric" {...bind('salary_min')} />
          <Input label="Maximum salary" type="number" min={0} inputMode="numeric" {...bind('salary_max')} />
          <Select
            label="Currency"
            value={values.salary_currency}
            error={errors.salary_currency}
            onChange={(e) => set('salary_currency', e.target.value)}
          >
            <option value="">No salary range</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Section>

        <Section title="Hiring team" description="Who is responsible for this hire.">
          <div className="sm:col-span-2">
            <ManagerPicker
              label="Hiring manager"
              value={values.hiring_manager_id}
              onChange={(id) => set('hiring_manager_id', id)}
              error={errors.hiring_manager_id}
            />
          </div>
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
