import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card } from '../../../components/ui/Card'
import { Alert } from '../../../components/ui/Feedback'
import { Input, Select } from '../../../components/ui/Field'
import {
  employmentStatuses,
  employmentStatusLabels,
  employmentTypeLabels,
  employmentTypes,
} from '../../../lib/format'
import {
  mapApiError,
  validate,
} from '../lib/formValues'
import type { FieldErrors, FormValues } from '../lib/formValues'
import { ManagerPicker } from './ManagerPicker'

interface Props {
  initialValues: FormValues
  submitLabel: string
  cancelTo: string
  /** Employee being edited (hides them from the manager list). */
  editingId?: string
  /** Must throw (ideally an ApiError) when the request fails. */
  onSubmit: (values: FormValues) => Promise<void>
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
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

/** Wait for React to render the errors, then jump to the first invalid input. */
function focusFirstInvalid() {
  requestAnimationFrame(() =>
    document.getElementById('employee-form')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  )
}

export function EmployeeForm({ initialValues, submitLabel, cancelTo, editingId, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>(initialValues)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined })) // clear as the user fixes it
  }

  const bind = (key: keyof FormValues) => ({
    value: values[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const clientErrors = validate(values)
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      focusFirstInvalid()
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      const { fields, general } = mapApiError(err)
      setErrors(fields)
      setFormError(general ?? (Object.keys(fields).length ? 'Please correct the highlighted fields.' : null))
      setSubmitting(false)
      focusFirstInvalid()
    }
    // On success the page navigates away, so we deliberately leave `submitting` on.
  }

  return (
    <form id="employee-form" onSubmit={handleSubmit} noValidate>
      <Card className="divide-y divide-slate-100">
        <Section title="Personal details" description="Name and work contact information.">
          <Input label="First name" required autoComplete="off" {...bind('first_name')} />
          <Input label="Last name" required autoComplete="off" {...bind('last_name')} />
          <Input label="Work email" type="email" required autoComplete="off" placeholder="name@company.com" {...bind('work_email')} />
          <Input label="Phone number" type="tel" autoComplete="off" placeholder="+92 300 1234567" hint="Optional." {...bind('phone_number')} />
        </Section>

        <Section title="Role" description="Where this person sits in the organisation.">
          <Input label="Employee ID" required autoComplete="off" placeholder="EMP-001" hint="Letters, numbers and hyphens. Must be unique." {...bind('employee_id')} />
          <Input label="Job title" required autoComplete="off" {...bind('job_title')} />
          <Input label="Department" required autoComplete="off" placeholder="Engineering" {...bind('department')} />
          <ManagerPicker
            value={values.manager_id}
            onChange={(id) => set('manager_id', id)}
            excludeId={editingId}
            error={errors.manager_id}
          />
        </Section>

        <Section title="Employment" description="Contract type, status and start date.">
          <Select label="Employment type" required {...bind('employment_type')}>
            <option value="">Select type…</option>
            {employmentTypes.map((t) => (
              <option key={t} value={t}>
                {employmentTypeLabels[t]}
              </option>
            ))}
          </Select>
          <Select label="Status" required {...bind('employment_status')}>
            {employmentStatuses.map((s) => (
              <option key={s} value={s}>
                {employmentStatusLabels[s]}
              </option>
            ))}
          </Select>
          <Input label="Date of joining" type="date" required {...bind('date_of_joining')} />
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
